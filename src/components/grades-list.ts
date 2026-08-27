import type { Course, Gradebook, ReportingPeriod } from "../lib/studentvue/types";
import { icons } from "./icons";
import { mountCourseDetail } from "./course-detail";
import { gradebookNeedsBackgroundRefresh } from "../lib/grades/cache-policy";
import {
	gradebookCacheAccount,
	peekLocalGradebook,
	readLocalGradebook,
	writeLocalGradebook,
	type GradebookCacheAccount,
} from "../lib/gradebook-local";
import { AuthExpiredError, clearSession, getSession, LoginRedirectError, postGradebook, refreshSession, sendToLogin, touchLoginActivity } from "../lib/session";
import {
	displayCourseTitle,
	displayPercent,
	formatGrade,
	officialLetter,
	progressFillClass,
} from "../lib/grades/display";

interface Bootstrap {
	gradebook: Gradebook | null;
	fetchedAt: number;
	period: string;
	refresh?: boolean;
	error?: string;
}

interface GradebookPayload {
	gradebook?: Gradebook;
	fetchedAt?: number;
	error?: string;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function spinnerHtml(className = "h-4 w-4"): string {
	return `<svg class="${className} animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
		<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
		<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
	</svg>`;
}

export function loadingHtml(message: string, showSkeleton = true): string {
	const skeleton = showSkeleton
		? `<ol class="mt-4 animate-pulse divide-y divide-border border-y border-border">${`<li class="px-4 py-3.5">
		<div class="flex items-center justify-between gap-3">
			<div class="h-4 w-48 max-w-[60%] rounded bg-muted"></div>
			<div class="h-4 w-16 rounded bg-muted"></div>
		</div>
		<div class="mt-2 h-1.5 w-36 rounded-sm bg-muted"></div>
	</li>`.repeat(6)}</ol>`
		: "";
	return `<div class="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center px-4" role="status" aria-live="polite">
		<p class="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground shadow-sm">
			${spinnerHtml()}
			${escapeHtml(message)}
		</p>
	</div>${skeleton}`;
}

export function courseLoadingHtml(course: { title: string }, period = ""): string {
	const backHref = `/grades${period ? `?period=${encodeURIComponent(period)}` : ""}`;
	return `<div class="flex flex-1 flex-col">
		<p class="mt-4 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
			<span class="inline-flex items-center gap-2" role="status" aria-live="polite">
				${spinnerHtml()}
				Loading grades…
			</span>
		</p>
		<div class="bg-background sticky top-0 z-10 border-b border-border py-3">
			<div class="flex items-center justify-between gap-3">
				<div class="flex min-w-0 items-center gap-1">
					<a
						class="inline-flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground no-underline hover:bg-muted hover:text-foreground"
						href="${backHref}"
						aria-label="Back to grades"
					>
						${icons.chevronLeft("h-5 w-5")}
					</a>
					<h1 class="min-w-0 truncate text-lg font-medium">${escapeHtml(displayCourseTitle(course.title))}</h1>
				</div>
				<p class="inline-flex shrink-0 items-center text-muted-foreground" aria-hidden="true">
					${spinnerHtml()}
				</p>
			</div>
		</div>
		<div class="mt-6 h-52 animate-pulse rounded bg-muted/60"></div>
		<div class="mt-4 space-y-3">
			${`<div class="h-12 animate-pulse rounded bg-muted/60"></div>`.repeat(4)}
		</div>
	</div>`;
}

export function errorHtml(message: string): string {
	return `<p class="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">${escapeHtml(message)}</p>`;
}

export class SessionExpiredError extends Error {
	constructor() {
		super("Your session expired. Please sign in again.");
		this.name = "SessionExpiredError";
	}
}

export function isSessionExpired(error: unknown): boolean {
	return error instanceof SessionExpiredError || error instanceof LoginRedirectError;
}

function redirectToLogin(expired = false): never {
	sendToLogin(expired);
}

async function parseGradebookResponse(response: Response): Promise<GradebookPayload> {
	let payload: GradebookPayload = {};
	try {
		payload = (await response.json()) as GradebookPayload;
	} catch {
		if (!response.ok) throw new Error("Could not load the gradebook.");
	}
	if (!response.ok) {
		throw new Error(payload.error || "Could not load the gradebook.");
	}
	return payload;
}

export async function fetchGradebook(period: string, refresh = false): Promise<GradebookPayload> {
	let session = await getSession();
	if (!session) redirectToLogin();
	const account = gradebookCacheAccount(session.creds);
	if (!refresh) {
		const local = peekLocalGradebook(account, period);
		if (local) {
			return { gradebook: local.gradebook, fetchedAt: local.fetchedAt };
		}
	}

	let response = await postGradebook(session, period, refresh);
	if (response.status === 401) {
		try {
			session = await refreshSession(session);
		} catch (error) {
			if (error instanceof AuthExpiredError) {
				await clearSession();
				redirectToLogin(true);
			}
			throw error;
		}
		response = await postGradebook(session, period, refresh);
		if (response.status === 401) {
			await clearSession();
			redirectToLogin(true);
		}
	}

	const payload = await parseGradebookResponse(response);
	if (payload.gradebook?.courses.length) {
		writeLocalGradebook(
			account,
			payload.gradebook,
			payload.fetchedAt ?? Date.now(),
			period || payload.gradebook.reportingPeriod?.index || "",
		);
		touchLoginActivity(session);
	}
	return payload;
}

export function fillPeriodSelect(periods: ReportingPeriod[], selectedPeriod: string): void {
	const host = document.querySelector("#period-host");
	if (!host) return;
	if (periods.length === 0) {
		host.innerHTML = "";
		return;
	}
	host.innerHTML = `<form>
		<label class="sr-only" for="period">Term</label>
		<select id="period" name="period" class="h-8 rounded border border-border bg-background px-2 text-sm" onchange="this.form.submit()">
			${periods
				.map(
					(item) =>
						`<option value="${escapeHtml(item.index)}" ${item.index === selectedPeriod ? "selected" : ""}>${escapeHtml(item.gradePeriod)}</option>`,
				)
				.join("")}
		</select>
	</form>`;
}

export function fillCourseNav(
	courses: { title: string }[],
	period: string,
	activeIndex?: number,
	loading = false,
): void {
	const nav = document.querySelector("#course-nav");
	if (!nav) return;
	const periodQuery = period ? `?period=${encodeURIComponent(period)}` : "";
	document.querySelectorAll<HTMLAnchorElement>("[data-grades-home]").forEach((home) => {
		home.href = `/grades${periodQuery}`;
	});
	nav.setAttribute("aria-busy", loading ? "true" : "false");
	nav.innerHTML = `<ul class="flex flex-col gap-px">${courses
		.map((course, index) => {
			const title = displayCourseTitle(course.title);
			const active = index === activeIndex;
			return `<li class="min-w-0">
				<a href="/grades/${index}${periodQuery}" class="flex min-h-11 items-center truncate rounded-lg px-3 py-2.5 text-base no-underline md:min-h-0 md:rounded-md md:px-2 md:py-1.5 md:text-sm ${
					active
						? "bg-muted font-medium text-foreground"
						: "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
				}"${active ? ' aria-current="page"' : ""} title="${escapeHtml(title)}">${escapeHtml(title)}</a>
			</li>`;
		})
		.join("")}</ul>`;
}

export function fillGradebookChrome(
	gradebook: Gradebook,
	period: string,
	activeIndex?: number,
	loading = false,
): string {
	const selected = period || gradebook.reportingPeriod?.index || "";
	fillCourseNav(gradebook.courses, selected, activeIndex, loading);
	const title = document.querySelector<HTMLElement>("[data-page-title]");
	const grade = document.querySelector<HTMLElement>("[data-page-grade]");
	const actions = document.querySelector<HTMLElement>("[data-header-actions]");
	if (title) title.textContent = activeIndex == null ? "Grades" : displayCourseTitle(gradebook.courses[activeIndex]?.title ?? "Grades");
	if (grade) {
		const course = activeIndex == null ? null : gradebook.courses[activeIndex];
		grade.textContent = course ? `${formatGrade(displayPercent(course))}${officialLetter(course) ? ` (${officialLetter(course)})` : ""}` : "";
		grade.toggleAttribute("hidden", !course);
	}
	if (actions) actions.classList.toggle("hidden", activeIndex != null);
	fillCommandSearch(gradebook, selected, activeIndex);
	const home = document.querySelector<HTMLAnchorElement>("header a[href^='/grades']");
	if (home) home.href = selected ? `/grades?period=${encodeURIComponent(selected)}` : "/grades";
	return selected;
}

function fillCommandSearch(gradebook: Gradebook, period: string, activeIndex?: number): void {
	const trigger = document.querySelector<HTMLButtonElement>("[data-command-trigger]");
	const dialog = document.querySelector<HTMLElement>("[data-command-dialog]");
	const input = document.querySelector<HTMLInputElement>("[data-command-input]");
	const results = document.querySelector<HTMLElement>("[data-command-results]");
	if (!trigger || !dialog || !input || !results) return;
	trigger.classList.toggle("hidden", activeIndex != null);
	trigger.classList.toggle("flex", activeIndex == null);
	const queryString = period ? `?period=${encodeURIComponent(period)}` : "";

	const render = () => {
		const query = input.value.trim().toLowerCase();
		const courses = gradebook.courses
			.map((course, index) => ({ course, index, name: displayCourseTitle(course.title) }))
			.filter(({ name }) => !query || name.toLowerCase().includes(query));
		const assignments = gradebook.courses
			.flatMap((course, courseIndex) => course.assignments.map((assignment) => ({ assignment, courseIndex, courseName: displayCourseTitle(course.title) })))
			.filter(({ assignment, courseName }) => !query || assignment.name.toLowerCase().includes(query) || courseName.toLowerCase().includes(query))
			.slice(0, 12);
		results.innerHTML = `${courses.length ? `<p class="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">Courses</p>${courses.map(({ index, name }) => `<a class="flex w-full items-center rounded-md px-3 py-2 text-left text-sm no-underline hover:bg-accent" href="/grades/${index}${queryString}">${escapeHtml(name)}</a>`).join("")}` : ""}${assignments.length ? `<p class="px-2 pb-1 pt-3 text-xs font-medium text-muted-foreground">Assignments</p>${assignments.map(({ assignment, courseIndex, courseName }) => `<a class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm no-underline hover:bg-accent" href="/grades/${courseIndex}${queryString}#assignment-${encodeURIComponent(assignment.id)}"><span class="min-w-0 flex-1 truncate">${escapeHtml(assignment.name)}</span><span class="max-w-[42%] truncate text-xs text-muted-foreground">${escapeHtml(courseName)}</span></a>`).join("")}` : ""}${courses.length === 0 && assignments.length === 0 ? `<p class="px-3 py-8 text-center text-sm text-muted-foreground">No results found.</p>` : ""}`;
	};
	const close = () => { dialog.classList.add("hidden"); dialog.classList.remove("flex"); input.value = ""; };
	trigger.onclick = () => { dialog.classList.remove("hidden"); dialog.classList.add("flex"); render(); queueMicrotask(() => input.focus()); };
	dialog.querySelector<HTMLButtonElement>("[data-command-close]")!.onclick = close;
	input.oninput = render;
	input.onkeydown = (event) => { if (event.key === "Escape") close(); };
	if (!document.documentElement.dataset.commandShortcut) {
		document.documentElement.dataset.commandShortcut = "bound";
		window.addEventListener("keydown", (event) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				document.querySelector<HTMLButtonElement>("[data-command-trigger]:not(.hidden)")?.click();
			}
		});
	}
}

function courseGradeHtml(course: Course): string {
	const percent = displayPercent(course);
	const letter = officialLetter(course);
	const unavailable = course.officialMark.trim().toUpperCase() === "N/A";
	return `<div class="shrink-0 text-right">
		<p class="text-xl font-semibold tabular-nums text-foreground sm:text-2xl">
			${escapeHtml(formatGrade(percent))}${unavailable ? ` <span class="text-muted-foreground">(N/A)</span>` : letter ? ` <span class="text-muted-foreground">(${escapeHtml(letter)})</span>` : ""}
		</p>
	</div>`;
}

function sourceUpdatedAt(fetchedAt: number): string {
	if (!fetchedAt) return "just now";
	return new Date(fetchedAt).toLocaleString([], {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function renderList(
	gradebook: Gradebook,
	fetchedAt: number,
	period: string,
	warning = "",
	loading = false,
): string {
	const selectedPeriod = period || gradebook.reportingPeriod?.index || "";
	const periodQuery = selectedPeriod ? `?period=${encodeURIComponent(selectedPeriod)}` : "";
	const selected = selectedPeriod || gradebook.reportingPeriods[0]?.index || "";
	const selectedPeriodLabel = gradebook.reportingPeriods.find((item) => item.index === selected)?.gradePeriod ?? "Select period";
	const periodSelector = gradebook.reportingPeriods.length
		? `<div class="flex justify-center">
			<details class="group/period relative w-60" data-period-select>
				<summary class="flex h-10 w-full cursor-pointer list-none items-center justify-between rounded-md border border-input bg-card px-3 py-2 text-sm font-medium text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 dark:border-transparent ${loading ? "pointer-events-none opacity-50" : ""}" aria-label="Reporting period" ${loading ? 'aria-disabled="true"' : ""}>
					<span class="truncate">${escapeHtml(selectedPeriodLabel)}</span>${icons.chevronDown("size-4 shrink-0 text-muted-foreground opacity-50 transition-transform group-open/period:rotate-180")}
				</summary>
				<div class="absolute left-0 top-[calc(100%+0.25rem)] z-40 w-full overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md dark:border-transparent">
					${gradebook.reportingPeriods.map((item) => `<a class="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm no-underline outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground" href="?period=${encodeURIComponent(item.index)}"><span class="absolute left-2 flex size-3.5 items-center justify-center">${item.index === selected ? icons.check("size-4") : ""}</span><span class="truncate">${escapeHtml(item.gradePeriod)}</span></a>`).join("")}
				</div>
			</details>
		</div>`
		: "";
	const status = `${loading ? `<div class="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center" role="status" aria-label="Updating grades"><div class="rounded-full border border-border bg-card p-2 text-muted-foreground shadow-sm">${spinnerHtml()}</div></div>` : ""}${warning ? errorHtml(warning) : ""}<div class="flex flex-col gap-2 py-3"><div class="flex justify-center"><div class="inline-flex items-center gap-1.5 rounded-full border border-transparent bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">${icons.clock("size-3.5")}<span>Updated ${escapeHtml(sourceUpdatedAt(fetchedAt))}</span><button type="button" class="ml-1 text-foreground underline decoration-foreground/60 underline-offset-2 transition-colors hover:text-foreground/80 disabled:cursor-not-allowed disabled:opacity-50" data-refresh ${loading ? "disabled" : ""}>Refresh</button></div></div>${periodSelector}</div>`;

	const courses =
		gradebook.courses.length === 0
			? `<p class="text-sm text-muted-foreground">No courses in this term yet.</p>`
			: `<ol class="space-y-4"${loading ? ' aria-busy="true"' : ""}>${gradebook.courses
					.map((course, index) => {
						const percent = course.officialMark.trim().toUpperCase() === "N/A" ? null : displayPercent(course);
						const missing = course.assignments.filter((assignment) => assignment.notes.trim().toLowerCase() === "missing").length;
						const progress = Math.min(Math.max(percent ?? 0, 0), 100);
						const progressColor = progressFillClass(percent);
						return `<li><div class="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
							<a class="flex min-h-24 items-center gap-5 p-5 text-foreground no-underline outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" href="/grades/${index}${periodQuery}">
								<div class="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xl font-semibold text-primary">${escapeHtml(course.period)}</div>
								<div class="min-w-0 flex-1"><p class="truncate text-lg font-semibold text-foreground sm:text-xl">${escapeHtml(displayCourseTitle(course.title))}</p>${course.teacher || course.room ? `<p class="mt-1 flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">${icons.user("size-3.5 shrink-0")}<span class="truncate">${escapeHtml(course.teacher)}${course.teacher && course.room ? " • " : ""}${course.room ? `Room ${escapeHtml(course.room)}` : ""}</span></p>` : ""}</div>
								<div class="hidden min-w-28 flex-1 px-1 sm:block" aria-label="Course grade progress"><div class="relative h-2.5 overflow-hidden rounded-full border border-border bg-muted" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}"><div class="h-full ${progressColor} transition-all" style="width:${progress}%"></div></div></div>
								<div class="shrink-0 text-right">${courseGradeHtml(course)}<p class="mt-1 text-xs ${missing > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}">${missing} missing assignment${missing === 1 ? "" : "s"}</p></div>
							</a></div></li>`;
					})
					.join("")}</ol>`;

	return `<div class="min-h-[calc(100vh-53px)] bg-background px-5 pb-5 md:px-9 md:pb-9 ${!loading ? "grade-cache-reveal" : ""}">${status}${courses}</div>`;
}

function courseIndexFromPath(pathname: string): number | null {
	const match = pathname.match(/^\/grades\/(\d+)\/?$/);
	if (!match) return null;
	const index = Number(match[1]);
	return Number.isInteger(index) && index >= 0 ? index : null;
}

function isGradesListPath(pathname: string): boolean {
	return pathname === "/grades" || pathname === "/grades/";
}

export function mountGradesList(root: Element, data: Bootstrap): void {
	const period = data.period;
	let account: GradebookCacheAccount | null = null;
	let currentGradebook: Gradebook | null = null;
	let currentFetchedAt = 0;
	let currentPeriod = period;
	let currentIndex: number | null = null;
	let destroyCourseDetail: (() => void) | null = null;

	function loadedPeriod(gradebook = currentGradebook): string {
		return currentPeriod || gradebook?.reportingPeriod?.index || "";
	}

	function sameTerm(url: URL, gradebook = currentGradebook): boolean {
		const requested = url.searchParams.get("period") ?? "";
		if (!requested) return true;
		const loaded = loadedPeriod(gradebook);
		return !loaded || requested === loaded;
	}

	function closeCommandDialog(): void {
		const dialog = document.querySelector<HTMLElement>("[data-command-dialog]");
		const input = document.querySelector<HTMLInputElement>("[data-command-input]");
		dialog?.classList.add("hidden");
		dialog?.classList.remove("flex");
		if (input) input.value = "";
	}

	function showCourse(index: number, gradebook: Gradebook, fetchedAt: number, push = false): boolean {
		const course = gradebook.courses[index];
		if (!course) return false;
		closeCommandDialog();
		destroyCourseDetail?.();
		currentGradebook = gradebook;
		currentFetchedAt = fetchedAt;
		currentIndex = index;
		currentPeriod = loadedPeriod(gradebook);
		fillGradebookChrome(gradebook, currentPeriod, index);
		destroyCourseDetail = mountCourseDetail(root, {
			course,
			index,
			period: currentPeriod,
			fetchedAt,
		});
		root.classList.remove("course-content-enter");
		void (root as HTMLElement).offsetWidth;
		root.classList.add("course-content-enter");
		document.title = `${course.title} · Grade Viewer`;
		if (push) {
			const query = currentPeriod ? `?period=${encodeURIComponent(currentPeriod)}` : "";
			history.pushState({ courseIndex: index }, "", `/grades/${index}${query}`);
		}
		return true;
	}

	function showList(gradebook: Gradebook, fetchedAt: number, warning = "", loading = false, push = false): void {
		closeCommandDialog();
		destroyCourseDetail?.();
		destroyCourseDetail = null;
		currentGradebook = gradebook;
		currentFetchedAt = fetchedAt;
		currentIndex = null;
		currentPeriod = loadedPeriod(gradebook);
		fillGradebookChrome(gradebook, currentPeriod, undefined, loading);
		root.innerHTML = renderList(gradebook, fetchedAt, currentPeriod, warning, loading);
		root.querySelector("[data-refresh]")?.addEventListener("click", () => void load(true, true));
		document.title = "Grades · Grade Viewer";
		if (push) {
			const query = currentPeriod ? `?period=${encodeURIComponent(currentPeriod)}` : "";
			history.pushState({}, "", `/grades${query}`);
		}
	}

	function paint(gradebook: Gradebook, fetchedAt: number, warning = "", loading = false) {
		if (account && gradebook.courses.length) writeLocalGradebook(account, gradebook, fetchedAt, period || loadedPeriod(gradebook));
		if (currentIndex != null && gradebook.courses[currentIndex]) {
			showCourse(currentIndex, gradebook, fetchedAt);
			return;
		}
		showList(gradebook, fetchedAt, warning, loading);
	}

	function handleGradesNavigation(event: MouseEvent): boolean {
		if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
		const target = event.target;
		if (!(target instanceof Element)) return false;
		const link = target.closest("a");
		if (!(link instanceof HTMLAnchorElement) || !currentGradebook) return false;
		if (link.target && link.target !== "_self") return false;
		const url = new URL(link.href, location.href);
		if (url.origin !== location.origin || !sameTerm(url)) return false;
		const index = courseIndexFromPath(url.pathname);
		if (index != null) {
			if (!currentGradebook.courses[index]) return false;
			event.preventDefault();
			if (index !== currentIndex) showCourse(index, currentGradebook, currentFetchedAt, true);
			else closeCommandDialog();
			return true;
		}
		if (isGradesListPath(url.pathname) && currentIndex != null) {
			event.preventDefault();
			showList(currentGradebook, currentFetchedAt, "", false, true);
			return true;
		}
		return false;
	}

	async function load(refresh: boolean, fromCache: boolean) {
		if (!fromCache && currentIndex == null) {
			root.innerHTML = loadingHtml("Loading grades…");
		} else if (fromCache && account && currentIndex == null) {
			const previous = readLocalGradebook(account, period);
			if (previous) paint(previous.gradebook, previous.fetchedAt, "", true);
		}
		try {
			const payload = await fetchGradebook(period, refresh);
			if (!payload.gradebook?.courses.length) {
				const message = payload.error || "Could not load the gradebook.";
				const previous = account ? readLocalGradebook(account, period) : null;
				if (previous) paint(previous.gradebook, previous.fetchedAt, message);
				else if (currentIndex == null) root.innerHTML = errorHtml(message);
				return;
			}
			if (refresh) {
				const url = new URL(location.href);
				url.searchParams.delete("refresh");
				history.replaceState(null, "", `${url.pathname}${url.search}`);
			}
			paint(payload.gradebook, payload.fetchedAt ?? Date.now(), payload.error ?? "");
		} catch (error) {
			if (isSessionExpired(error)) return;
			const message = error instanceof Error ? error.message : "Could not load the gradebook.";
			const previous = account ? readLocalGradebook(account, period) : null;
			if (previous) paint(previous.gradebook, previous.fetchedAt, message);
			else if (currentIndex == null) root.innerHTML = errorHtml(message);
		}
	}

	async function start() {
		const session = await getSession();
		if (!session) redirectToLogin();
		account = gradebookCacheAccount(session.creds);
		document.addEventListener("click", handleGradesNavigation);
		window.addEventListener("popstate", () => {
			if (!currentGradebook) return;
			const index = courseIndexFromPath(location.pathname);
			if (index != null) showCourse(index, currentGradebook, currentFetchedAt);
			else if (isGradesListPath(location.pathname)) showList(currentGradebook, currentFetchedAt);
			else location.reload();
		});
		const previous = readLocalGradebook(account, period);
		if (previous) {
			paint(previous.gradebook, previous.fetchedAt);
			if (data.refresh || gradebookNeedsBackgroundRefresh(previous.fetchedAt)) void load(true, true);
			return;
		}
		void load(Boolean(data.refresh), false);
	}

	void start();
}
