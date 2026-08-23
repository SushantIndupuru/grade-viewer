import type { Attendance, AttendanceDay, AttendanceKind } from "../lib/studentvue/types";
import { icons } from "./icons";
import { cacheIsFresh } from "../lib/grades/cache-policy";
import { peekLocalAttendance, readLocalAttendance, writeLocalAttendance } from "../lib/attendance-local";
import { peekLocalGradebook, readLocalGradebook } from "../lib/gradebook-local";
import { formatUpdatedAt } from "../lib/grades/display";
import {
	AuthExpiredError,
	clearSession,
	getSession,
	postAttendance,
	refreshSession,
} from "../lib/session";
import { errorHtml, fillCourseNav, isSessionExpired, loadingHtml, SessionExpiredError, spinnerHtml } from "./grades-list";

interface Bootstrap {
	attendance: Attendance | null;
	fetchedAt: number;
	refresh?: boolean;
	error?: string;
}

interface AttendancePayload {
	attendance?: Attendance;
	fetchedAt?: number;
	error?: string;
}

type Tab = "calendar" | "list";
type KindFilter = AttendanceKind | "all";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

const SUMMARY_KINDS = ["excused", "tardy", "unexcused", "activity"] as const;

const KIND_LABEL: Record<AttendanceKind, string> = {
	excused: "Excused",
	tardy: "Tardy",
	unexcused: "Unexcused",
	activity: "Activity",
	holiday: "Not scheduled",
	other: "Other",
};

const KIND_DOT: Record<AttendanceKind, string> = {
	excused: "bg-sky-500",
	tardy: "bg-amber-500",
	unexcused: "bg-rose-500",
	activity: "bg-violet-500",
	holiday: "bg-muted-foreground/40",
	other: "bg-muted-foreground/50",
};

const KIND_TINT: Record<AttendanceKind, string> = {
	excused: "bg-sky-500/15 text-sky-950 dark:text-sky-100",
	tardy: "bg-amber-500/15 text-amber-950 dark:text-amber-100",
	unexcused: "bg-rose-500/15 text-rose-950 dark:text-rose-100",
	activity: "bg-violet-500/15 text-violet-950 dark:text-violet-100",
	holiday: "bg-muted text-muted-foreground",
	other: "bg-muted text-muted-foreground",
};

const KIND_BADGE: Record<AttendanceKind, string> = {
	excused: "bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100",
	tardy: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
	unexcused: "bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-100",
	activity: "bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-100",
	holiday: "bg-muted text-muted-foreground",
	other: "bg-muted text-muted-foreground",
};

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function fillCachedCourses(): void {
	const local = peekLocalGradebook("") ?? readLocalGradebook("");
	if (!local) return;
	const selected = local.period || local.gradebook.reportingPeriod?.index || "";
	fillCourseNav(local.gradebook.courses, selected);
}

function expireSession(): never {
	location.replace("/?error=Your session expired. Please sign in again.");
	throw new SessionExpiredError();
}

async function parseAttendanceResponse(response: Response): Promise<AttendancePayload> {
	let payload: AttendancePayload = {};
	try {
		payload = (await response.json()) as AttendancePayload;
	} catch {
		if (!response.ok) throw new Error("Could not load attendance.");
	}
	if (!response.ok) {
		throw new Error(payload.error || "Could not load attendance.");
	}
	return payload;
}

async function fetchAttendance(refresh = false): Promise<AttendancePayload> {
	if (!refresh) {
		const local = peekLocalAttendance();
		if (local) return { attendance: local.attendance, fetchedAt: local.fetchedAt };
	}

	let session = await getSession();
	if (!session) expireSession();

	let response = await postAttendance(session, refresh);
	if (response.status === 401) {
		try {
			session = await refreshSession(session);
		} catch (error) {
			if (error instanceof AuthExpiredError) {
				await clearSession();
				expireSession();
			}
			throw error;
		}
		response = await postAttendance(session, refresh);
		if (response.status === 401) {
			await clearSession();
			expireSession();
		}
	}

	const payload = await parseAttendanceResponse(response);
	if (payload.attendance) {
		writeLocalAttendance(payload.attendance, payload.fetchedAt ?? Date.now());
	}
	return payload;
}

function dateKey(value: string | Date): string {
	if (typeof value === "string") {
		const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
		const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
		if (us) {
			const year = us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]);
			return `${year}-${String(Number(us[1])).padStart(2, "0")}-${String(Number(us[2])).padStart(2, "0")}`;
		}
	}
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return "";
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthFromKey(key: string): { year: number; month: number } | null {
	const match = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!match) return null;
	return { year: Number(match[1]), month: Number(match[2]) - 1 };
}

function localDateFromKey(key: string): Date | null {
	const parts = monthFromKey(key);
	if (!parts) return null;
	return new Date(parts.year, parts.month, Number(key.slice(8, 10)));
}

function formatKeyTitle(key: string, fallback = ""): string {
	const date = localDateFromKey(key);
	if (!date) return fallback;
	return date.toLocaleDateString("en-US", {
		weekday: "long",
		month: "long",
		day: "numeric",
		year: "numeric",
	});
}

function formatKeyShort(key: string, fallback = ""): string {
	const date = localDateFromKey(key);
	if (!date) return fallback;
	return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function kindBadge(kind: AttendanceKind): string {
	return `<span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs ${KIND_BADGE[kind]}">${escapeHtml(KIND_LABEL[kind])}</span>`;
}

function emptyCounts(): Record<AttendanceKind, number> {
	return { excused: 0, tardy: 0, unexcused: 0, activity: 0, holiday: 0, other: 0 };
}

function countsFor(days: AttendanceDay[]): Record<AttendanceKind, number> {
	const counts = emptyCounts();
	for (const day of days) counts[day.kind] += 1;
	return counts;
}

function markedDays(days: AttendanceDay[]): AttendanceDay[] {
	return days.filter((day) => day.kind !== "holiday");
}

function daysInMonth(attendance: Attendance, year: number, month: number): AttendanceDay[] {
	const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
	return attendance.absences.filter((day) => dateKey(day.date).startsWith(prefix));
}

function sortAbsences(days: AttendanceDay[]): AttendanceDay[] {
	return [...days].sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)));
}

function courseTotals(days: AttendanceDay[]) {
	const byCourse = new Map<
		string,
		{ course: string; excused: number; tardy: number; unexcused: number; activity: number }
	>();
	for (const day of days) {
		for (const period of day.periods) {
			const course = period.course.trim() || period.name.trim() || (period.number ? `Period ${period.number}` : "");
			if (!course) continue;
			const current = byCourse.get(course) ?? { course, excused: 0, tardy: 0, unexcused: 0, activity: 0 };
			if (period.kind === "excused" || period.kind === "tardy" || period.kind === "unexcused" || period.kind === "activity") {
				current[period.kind] += 1;
			}
			byCourse.set(course, current);
		}
	}
	return [...byCourse.values()]
		.filter((row) => row.excused + row.tardy + row.unexcused + row.activity > 0)
		.sort((a, b) => a.course.localeCompare(b.course));
}

function countLine(row: { excused: number; tardy: number; unexcused: number; activity: number }): string {
	return SUMMARY_KINDS.filter((kind) => row[kind] > 0)
		.map((kind) => `${row[kind]} ${KIND_LABEL[kind].toLowerCase()}`)
		.join(" · ");
}

function monthCells(year: number, month: number): Date[] {
	const start = new Date(year, month, 1).getDay();
	const lastDate = new Date(year, month + 1, 0).getDate();
	const cells: Date[] = [];
	for (let i = 0; i < start; i += 1) cells.push(new Date(NaN));
	for (let day = 1; day <= lastDate; day += 1) cells.push(new Date(year, month, day));
	while (cells.length % 7 !== 0) cells.push(new Date(NaN));
	return cells;
}

function renderTabs(tab: Tab): string {
	const item = (id: Tab, label: string) => {
		const active = tab === id;
		return `<button class="shrink-0 cursor-pointer border-b-2 px-2 py-1.5 text-sm ${active ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}" data-tab="${id}" type="button" role="tab" aria-selected="${active ? "true" : "false"}">${label}</button>`;
	};
	return `<div class="mt-4 flex max-w-full items-center gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Attendance view">
		${item("calendar", "Calendar")}
		${item("list", "Absences")}
	</div>`;
}

function renderStatus(fetchedAt: number): string {
	return `<p class="mt-3 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground" data-status>
		<span class="inline-flex items-center gap-1">
			${icons.clock("h-3.5 w-3.5")}
			Updated ${escapeHtml(formatUpdatedAt(fetchedAt))}
		</span>
		<button class="cursor-pointer underline" data-refresh type="button">Refresh</button>
	</p>`;
}

function renderCounts(days: AttendanceDay[]): string {
	const relevant = markedDays(days);
	if (relevant.length === 0) return "";
	const counts = countsFor(relevant);
	return `<ul class="mb-5 flex flex-wrap gap-x-6 gap-y-2">
		${SUMMARY_KINDS.map(
			(kind) => `<li>
				<p class="text-xl font-medium tabular-nums">${counts[kind]}</p>
				<p class="mt-0.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
					<span class="h-1.5 w-1.5 rounded-full ${KIND_DOT[kind]}"></span>${KIND_LABEL[kind]}
				</p>
			</li>`,
		).join("")}
	</ul>`;
}

function renderCalendar(attendance: Attendance, year: number, month: number, selectedKey: string): string {
	const byDate = new Map(attendance.absences.map((day) => [dateKey(day.date), day]));
	const todayKey = dateKey(new Date());
	const now = new Date();
	const onThisMonth = year === now.getFullYear() && month === now.getMonth();
	const monthDays = markedDays(daysInMonth(attendance, year, month));
	const monthLabel =
		monthDays.length === 0
			? "No absences this month"
			: `${monthDays.length} ${monthDays.length === 1 ? "day" : "days"} this month`;
	return `<div>
		<div class="flex items-center justify-between gap-3">
			<button class="inline-flex size-8 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" type="button" data-month="-1" aria-label="Previous month">${icons.chevronLeft("h-4 w-4")}</button>
			<div class="min-w-0 text-center">
				<h2 class="text-base font-medium">${MONTHS[month]} ${year}</h2>
				<p class="mt-0.5 text-xs text-muted-foreground">${monthLabel}</p>
			</div>
			<div class="flex items-center gap-1">
				${
					onThisMonth
						? ""
						: `<button class="h-8 cursor-pointer rounded px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground" type="button" data-today>Today</button>`
				}
				<button class="inline-flex size-8 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" type="button" data-month="1" aria-label="Next month">${icons.chevronRight("h-4 w-4")}</button>
			</div>
		</div>
		<div class="mt-4 grid grid-cols-7 text-center text-xs text-muted-foreground">
			${WEEKDAYS.map((day) => `<div class="py-1">${day}</div>`).join("")}
		</div>
		<div class="grid grid-cols-7 gap-1">
			${monthCells(year, month)
				.map((date) => {
					if (Number.isNaN(date.getTime())) return `<div></div>`;
					const key = dateKey(date);
					const absence = byDate.get(key);
					const selected = key === selectedKey;
					const today = key === todayKey;
					const weekend = date.getDay() === 0 || date.getDay() === 6;
					const label = [formatKeyTitle(key), absence ? KIND_LABEL[absence.kind] : today ? "Today" : ""]
						.filter(Boolean)
						.join(", ");
					const classes = selected
						? "bg-foreground font-medium text-background"
						: [
								absence ? KIND_TINT[absence.kind] : "hover:bg-muted/60",
								today ? "font-medium ring-1 ring-inset ring-foreground" : "",
								!absence && weekend ? "text-muted-foreground" : "",
							].join(" ");
					return `<button class="relative flex h-11 cursor-pointer flex-col items-center justify-center rounded-md text-sm sm:h-12 ${classes}" type="button" data-date="${key}" aria-label="${escapeHtml(label)}" aria-pressed="${selected ? "true" : "false"}"${today ? ' aria-current="date"' : ""}>
						<span>${date.getDate()}</span>
					</button>`;
				})
				.join("")}
		</div>
	</div>`;
}

function renderDayContent(day: AttendanceDay): string {
	const key = dateKey(day.date);
	const title = formatKeyTitle(key, day.date);
	const periods =
		day.periods.length === 0
			? `<p class="mt-2 text-sm text-muted-foreground">${escapeHtml(day.reason || "Absence recorded for this day.")}</p>`
			: `<ol class="mt-3 divide-y divide-border border-y border-border">${day.periods
					.map((period) => {
						const heading = period.course || period.name || (period.number ? `Period ${period.number}` : "Period");
						const meta = [period.number && `Period ${period.number}`, period.staff].filter(Boolean).join(" · ");
						return `<li class="flex items-start justify-between gap-3 px-4 py-3.5">
							<div class="min-w-0">
								<p class="font-medium">${escapeHtml(heading)}</p>
								${meta ? `<p class="mt-0.5 text-sm text-muted-foreground">${escapeHtml(meta)}</p>` : ""}
								${period.reason ? `<p class="mt-0.5 text-sm text-muted-foreground">${escapeHtml(period.reason)}</p>` : ""}
							</div>
							${kindBadge(period.kind)}
						</li>`;
					})
					.join("")}</ol>`;
	return `<div class="flex flex-wrap items-center justify-between gap-2">
			<h2 class="text-base font-medium">${escapeHtml(title)}</h2>
			${kindBadge(day.kind)}
		</div>
		${day.reason ? `<p class="mt-1 text-sm text-muted-foreground">${escapeHtml(day.reason)}</p>` : ""}
		${day.note ? `<p class="mt-1 text-sm text-muted-foreground">${escapeHtml(day.note)}</p>` : ""}
		${periods}`;
}

function renderSelectedDay(day: AttendanceDay | null, selectedKey: string): string {
	if (day) return `<div class="mt-6">${renderDayContent(day)}</div>`;
	const title = formatKeyTitle(selectedKey, selectedKey);
	return `<div class="mt-6">
		<h2 class="text-base font-medium">${escapeHtml(title || "This day")}</h2>
		<p class="mt-2 text-sm text-muted-foreground">No attendance events on this day.</p>
	</div>`;
}

function renderDayPage(day: AttendanceDay): string {
	return `<div class="mt-4">
		<p class="mb-3">
			<button class="inline-flex cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-back type="button">
				${icons.chevronLeft("h-4 w-4")}
				Absences
			</button>
		</p>
		${renderDayContent(day)}
	</div>`;
}

function renderTotals(attendance: Attendance): string {
	const courses = courseTotals(attendance.absences);
	const periods = attendance.periodTotals.filter(
		(row) => row.excused + row.tardy + row.unexcused + row.activity > 0,
	);
	const list = (title: string, rows: { label: string; counts: string }[]) =>
		rows.length === 0
			? ""
			: `<div class="mt-8">
			<h2 class="text-base font-medium">${title}</h2>
			<ol class="mt-3 divide-y divide-border border-y border-border">${rows
				.map(
					(row) => `<li class="flex items-start justify-between gap-3 px-4 py-3">
					<p class="min-w-0 font-medium">${escapeHtml(row.label)}</p>
					<p class="shrink-0 text-right text-sm text-muted-foreground">${escapeHtml(row.counts)}</p>
				</li>`,
				)
				.join("")}</ol>
		</div>`;
	return `${list(
		"By course",
		courses.map((row) => ({ label: row.course, counts: countLine(row) })),
	)}${list(
		"By period",
		periods.map((row) => ({ label: `Period ${row.period}`, counts: countLine(row) })),
	)}`;
}

function renderAbsenceList(attendance: Attendance, filter: KindFilter): string {
	const days = sortAbsences(markedDays(attendance.absences));
	if (days.length === 0) {
		return `<p class="text-sm text-muted-foreground">No absences are recorded yet.</p>`;
	}
	const kinds = SUMMARY_KINDS.filter((kind) => days.some((day) => day.kind === kind));
	const selected = kinds.includes(filter as (typeof SUMMARY_KINDS)[number]) ? filter : "all";
	const visible = selected === "all" ? days : days.filter((day) => day.kind === selected);
	const filters =
		kinds.length > 1
			? `<div class="mb-3 flex max-w-full items-center gap-1 overflow-x-auto" role="tablist" aria-label="Absence type">
			<button class="shrink-0 cursor-pointer rounded px-2 py-1 text-sm ${selected === "all" ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}" data-filter="all" type="button">All</button>
			${kinds
				.map((kind) => {
					const active = selected === kind;
					return `<button class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-sm ${active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}" data-filter="${kind}" type="button"><span class="h-1.5 w-1.5 rounded-full ${KIND_DOT[kind]}"></span>${KIND_LABEL[kind]}</button>`;
				})
				.join("")}
		</div>`
			: "";
	const emptyLabel = selected === "all" ? "matching" : KIND_LABEL[selected].toLowerCase();
	const body =
		visible.length === 0
			? `<p class="text-sm text-muted-foreground">No ${escapeHtml(emptyLabel)} days.</p>`
			: `<ol class="divide-y divide-border border-y border-border">${visible
					.map((day) => {
						const key = dateKey(day.date);
						const stamp = formatKeyShort(key, day.date);
						const detail =
							day.reason ||
							(day.periods.length
								? `${day.periods.length} ${day.periods.length === 1 ? "period" : "periods"}`
								: KIND_LABEL[day.kind]);
						return `<li>
					<button class="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3.5 text-left text-foreground hover:bg-muted/60" type="button" data-open="${key}">
						<div class="min-w-0">
							<p class="font-medium">${escapeHtml(stamp)}</p>
							<p class="mt-0.5 truncate text-sm text-muted-foreground">${escapeHtml(detail)}</p>
						</div>
						${kindBadge(day.kind)}
					</button>
				</li>`;
					})
					.join("")}</ol>`;
	return `${filters}${body}${renderTotals(attendance)}`;
}

function renderView(
	attendance: Attendance,
	fetchedAt: number,
	tab: Tab,
	year: number,
	month: number,
	selectedKey: string,
	filter: KindFilter,
	peeking: boolean,
	warning = "",
): string {
	const selected = attendance.absences.find((day) => dateKey(day.date) === selectedKey) ?? null;
	if (peeking && selected) {
		return `${warning ? errorHtml(warning) : ""}${renderDayPage(selected)}`;
	}
	return `${warning ? errorHtml(warning) : ""}
		${renderTabs(tab)}
		${renderStatus(fetchedAt)}
		${renderCounts(attendance.absences)}
		${tab === "calendar" ? `${renderCalendar(attendance, year, month, selectedKey)}${renderSelectedDay(selected, selectedKey)}` : renderAbsenceList(attendance, filter)}`;
}

export function mountAttendanceList(root: Element, data: Bootstrap): void {
	fillCachedCourses();
	let current: Attendance | null = data.attendance;
	let fetchedAt = data.fetchedAt;
	let warning = data.error ?? "";
	const now = new Date();
	let tab: Tab = "calendar";
	let year = now.getFullYear();
	let month = now.getMonth();
	let selectedKey = dateKey(now);
	let filter: KindFilter = "all";
	let peeking = false;

	function paint() {
		if (!current) return;
		writeLocalAttendance(current, fetchedAt);
		root.innerHTML = renderView(current, fetchedAt, tab, year, month, selectedKey, filter, peeking, warning);
		bind();
	}

	function goToDate(key: string) {
		selectedKey = key;
		const selected = monthFromKey(key);
		if (selected) {
			year = selected.year;
			month = selected.month;
		}
	}

	function bind() {
		root.querySelector("[data-refresh]")?.addEventListener("click", () => {
			void load(true);
		});
		root.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
			button.addEventListener("click", () => {
				tab = button.dataset.tab === "list" ? "list" : "calendar";
				peeking = false;
				paint();
			});
		});
		root.querySelector("[data-today]")?.addEventListener("click", () => {
			const today = new Date();
			year = today.getFullYear();
			month = today.getMonth();
			selectedKey = dateKey(today);
			paint();
		});
		root.querySelector("[data-back]")?.addEventListener("click", () => {
			peeking = false;
			paint();
		});
		root.querySelectorAll<HTMLButtonElement>("[data-month]").forEach((button) => {
			button.addEventListener("click", () => {
				const delta = Number(button.dataset.month) || 0;
				const next = new Date(year, month + delta, 1);
				year = next.getFullYear();
				month = next.getMonth();
				paint();
			});
		});
		root.querySelectorAll<HTMLButtonElement>("[data-date]").forEach((button) => {
			button.addEventListener("click", () => {
				goToDate(button.dataset.date ?? selectedKey);
				paint();
			});
		});
		root.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => {
			button.addEventListener("click", () => {
				filter = (button.dataset.filter as KindFilter) || "all";
				paint();
			});
		});
		root.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((button) => {
			button.addEventListener("click", () => {
				goToDate(button.dataset.open ?? selectedKey);
				peeking = true;
				paint();
			});
		});
	}

	async function load(refresh: boolean) {
		if (!readLocalAttendance()) {
			root.innerHTML = loadingHtml("Loading attendance…");
		} else {
			const status = root.querySelector("[data-status]");
			if (status) {
				status.innerHTML = `<span class="inline-flex items-center gap-2" role="status" aria-live="polite">${spinnerHtml()} Loading attendance…</span>`;
			}
		}
		try {
			const payload = await fetchAttendance(refresh);
			if (!payload.attendance) {
				root.innerHTML = errorHtml(payload.error || "Could not load attendance.");
				return;
			}
			current = payload.attendance;
			fetchedAt = payload.fetchedAt ?? Date.now();
			warning = payload.error ?? "";
			paint();
		} catch (error) {
			if (isSessionExpired(error)) return;
			root.innerHTML = errorHtml(error instanceof Error ? error.message : "Could not load attendance.");
		}
	}

	if (data.attendance && !data.refresh && cacheIsFresh(data.fetchedAt)) {
		paint();
		return;
	}

	const fresh = !data.refresh ? peekLocalAttendance() : null;
	if (fresh) {
		current = fresh.attendance;
		fetchedAt = fresh.fetchedAt;
		warning = "";
		paint();
		return;
	}

	const previous = readLocalAttendance();
	if (previous) {
		current = previous.attendance;
		fetchedAt = previous.fetchedAt;
		paint();
		void load(Boolean(data.refresh));
		return;
	}

	void load(Boolean(data.refresh));
}
