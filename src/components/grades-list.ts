import type { Course, Gradebook, ReportingPeriod } from "../lib/studentvue/types";
import { icons } from "./icons";
import { cacheIsFresh } from "../lib/grades/cache-policy";
import { peekLocalGradebook, readLocalGradebook, writeLocalGradebook } from "../lib/gradebook-local";
import { AuthExpiredError, clearSession, getSession, LoginRedirectError, postGradebook, refreshSession, sendToLogin } from "../lib/session";
import {
	displayCourseTitle,
	displayPercent,
	formatGrade,
	formatUpdatedAt,
	officialLetter,
	progressFillClass,
	progressTranslate,
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
	return `<div class="mt-8" role="status" aria-live="polite">
		<p class="inline-flex items-center gap-2 text-sm text-muted-foreground">
			${spinnerHtml()}
			${escapeHtml(message)}
		</p>
		${skeleton}
	</div>`;
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
	if (!refresh) {
		const local = peekLocalGradebook(period);
		if (local) {
			return { gradebook: local.gradebook, fetchedAt: local.fetchedAt };
		}
	}

	let session = await getSession();
	if (!session) redirectToLogin();

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
	if (payload.gradebook) {
		writeLocalGradebook(payload.gradebook, payload.fetchedAt ?? Date.now(), period);
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
				<a href="/grades/${index}${periodQuery}" class="block truncate rounded-md px-2 py-1.5 text-sm no-underline ${
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
	fillPeriodSelect(gradebook.reportingPeriods, selected);
	fillCourseNav(gradebook.courses, selected, activeIndex, loading);
	const home = document.querySelector<HTMLAnchorElement>("header a[href^='/grades']");
	if (home) home.href = selected ? `/grades?period=${encodeURIComponent(selected)}` : "/grades";
	return selected;
}

function courseGradeHtml(course: Course, loading: boolean): string {
	if (loading) {
		return `<div class="flex items-center justify-end sm:min-w-[9rem]">
			<span class="inline-flex items-center text-muted-foreground" aria-hidden="true">
				${spinnerHtml()}
			</span>
		</div>`;
	}
	const percent = displayPercent(course);
	const letter = officialLetter(course);
	const fill = progressFillClass(percent);
	return `<div class="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1.5">
		<p class="tabular-nums">
			${letter ? `<span class="text-muted-foreground">${escapeHtml(letter)}</span> ` : ""}${escapeHtml(formatGrade(percent))}
		</p>
		<div class="relative h-1.5 w-36 overflow-hidden rounded-sm bg-foreground/10" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent ?? 0}">
			<div class="h-full w-full transition-all ${fill}" style="transform: ${progressTranslate(percent)};"></div>
		</div>
	</div>`;
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
	const refreshHref = selectedPeriod ? `${periodQuery}&refresh=1` : "?refresh=1";

	const status = loading
		? `<p class="mt-4 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
			<span class="inline-flex items-center gap-2" role="status" aria-live="polite">
				${spinnerHtml()}
				Loading grades…
			</span>
		</p>`
		: `${warning ? errorHtml(warning) : ""}
		<p class="mt-4 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
			<span class="inline-flex items-center gap-1">
				${icons.clock("h-3.5 w-3.5")}
				Updated ${escapeHtml(formatUpdatedAt(fetchedAt))}
			</span>
			<a class="text-inherit underline" href="${refreshHref}">Refresh</a>
		</p>`;

	const courses =
		gradebook.courses.length === 0
			? `<p class="text-sm text-muted-foreground">No courses in this term yet.</p>`
			: `<ol class="divide-y divide-border border-y border-border"${loading ? ' aria-busy="true"' : ""}>${gradebook.courses
					.map((course, index) => {
						const meta = [
							course.period && `Period ${course.period}`,
							course.room,
							course.teacher,
						].filter(Boolean);
						return `<li>
							<a class="flex flex-col gap-2 px-4 py-3.5 text-foreground no-underline hover:bg-muted/60 sm:flex-row sm:items-center sm:justify-between" href="/grades/${index}${periodQuery}">
								<div class="min-w-0">
									<p class="font-medium">${escapeHtml(displayCourseTitle(course.title))}</p>
									${meta.length > 0 ? `<p class="mt-0.5 text-sm text-muted-foreground">${escapeHtml(meta.join(" · "))}</p>` : ""}
								</div>
								${courseGradeHtml(course, loading)}
							</a>
						</li>`;
					})
					.join("")}</ol>`;

	return `${status}
		${courses}`;
}

export function mountGradesList(root: Element, data: Bootstrap): void {
	const period = data.period;

	function paint(gradebook: Gradebook, fetchedAt: number, warning = "") {
		writeLocalGradebook(gradebook, fetchedAt, period);
		fillGradebookChrome(gradebook, period);
		root.innerHTML = renderList(gradebook, fetchedAt, period, warning);
	}

	function paintLoadingFromCache(gradebook: Gradebook) {
		fillGradebookChrome(gradebook, period, undefined, true);
		root.innerHTML = renderList(gradebook, 0, period, "", true);
	}

	async function load(refresh: boolean, fromCache: boolean) {
		if (!fromCache) {
			root.innerHTML = loadingHtml("Loading grades…");
		}
		try {
			const payload = await fetchGradebook(period, refresh);
			if (!payload.gradebook) {
				root.innerHTML = errorHtml(payload.error || "Could not load the gradebook.");
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
			root.innerHTML = errorHtml(error instanceof Error ? error.message : "Could not load the gradebook.");
		}
	}

	if (data.gradebook && !data.refresh && cacheIsFresh(data.fetchedAt)) {
		paint(data.gradebook, data.fetchedAt, data.error ?? "");
		return;
	}

	const fresh = !data.refresh ? peekLocalGradebook(period) : null;
	if (fresh) {
		paint(fresh.gradebook, fresh.fetchedAt);
		return;
	}

	const previous = readLocalGradebook(period);
	if (previous) {
		paintLoadingFromCache(previous.gradebook);
		void load(Boolean(data.refresh), true);
		return;
	}

	void load(Boolean(data.refresh), false);
}
