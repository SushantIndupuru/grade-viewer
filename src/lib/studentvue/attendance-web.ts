import { normalizeDistrictUrl, studentVueFetch, StudentVueError } from "./client";
import { generateAuthToken } from "./mobile";
import type {
	Attendance,
	AttendanceDay,
	AttendanceKind,
	AttendancePeriod,
	AttendancePeriodTotal,
	Credentials,
} from "./types";

const PAGE_UA =
	"Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

const SKIP_TYPES = new Set([4, 5, 11]);

function kindFromType(type: number, reason = ""): AttendanceKind | null {
	if (SKIP_TYPES.has(type)) return null;
	if (type === 2 || type === 3) return "tardy";
	if (type === 7) return "activity";
	if (type === 0 || type === 1 || type === 9) return "unexcused";
	if (type === 6 || type === 8) return "excused";
	if (type === 10) return "other";
	const value = reason.toLowerCase();
	if (/\btardy\b|\blate\b/.test(value)) return "tardy";
	if (/unexcused|truant|\bcut\b|unverify/.test(value)) return "unexcused";
	if (/activit|field\s*trip/.test(value)) return "activity";
	if (reason.trim()) return "excused";
	return "other";
}

function mergeCookies(previous: string, response: Response): string {
	const jar = new Map<string, string>();
	for (const part of previous.split(";")) {
		const trimmed = part.trim();
		const eq = trimmed.indexOf("=");
		if (eq > 0) jar.set(trimmed.slice(0, eq), trimmed.slice(eq + 1));
	}
	const header = response.headers as Headers & { getSetCookie?: () => string[] };
	const setCookies = header.getSetCookie?.() ?? [];
	if (!setCookies.length) {
		const single = response.headers.get("set-cookie");
		if (single) setCookies.push(single);
	}
	for (const cookie of setCookies) {
		const pair = cookie.split(";")[0];
		const eq = pair.indexOf("=");
		if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
	}
	return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function extractAssign(html: string, name: string): Record<string, unknown> | null {
	const marker = html.indexOf(name);
	if (marker < 0) return null;
	const start = html.indexOf("{", marker);
	if (start < 0) return null;
	let depth = 0;
	let inString = false;
	let escape = false;
	for (let i = start; i < html.length; i += 1) {
		const ch = html[i];
		if (inString) {
			if (escape) escape = false;
			else if (ch === "\\") escape = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === "{") depth += 1;
		else if (ch === "}") {
			depth -= 1;
			if (depth === 0) {
				try {
					return JSON.parse(html.slice(start, i + 1)) as Record<string, unknown>;
				} catch {
					return null;
				}
			}
		}
	}
	return null;
}

function parseUsDate(value: string): Date | null {
	const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (!match) return null;
	return new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]));
}

function formatUsDate(date: Date): string {
	return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}`;
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
	if (value == null) return [];
	return Array.isArray(value) ? value : [value];
}

interface MarkedDay {
	date: string;
	type: number;
	reason: string;
}

function markedDaysFromPage(html: string): MarkedDay[] {
	const root = extractAssign(html, "PXP.StudentAttendanceData");
	if (!root) throw new StudentVueError("Attendance page did not include calendar data");
	const attendanceData = record(root.attendanceData) ?? root;
	const calendar = record(attendanceData.Calendar) ?? record(attendanceData.calendar);
	if (!calendar) throw new StudentVueError("Attendance page did not include a calendar");
	const start = parseUsDate(String(calendar.startDate ?? calendar.StartDate ?? ""));
	if (!start) throw new StudentVueError("Attendance calendar is missing a start date");
	const attData = asArray(
		(calendar.attData ?? calendar.AttData ?? []) as Record<string, unknown>[],
	);
	const days: MarkedDay[] = [];
	attData.forEach((entry, index) => {
		const type = Number(entry.Type ?? entry.type ?? 11);
		const reason = String(entry.Reason ?? entry.reason ?? "");
		if (kindFromType(type, reason) == null) return;
		days.push({ date: formatUsDate(addDays(start, index)), type, reason });
	});
	return days;
}

function parseCalendarDay(payload: unknown, fallback: MarkedDay): AttendanceDay {
	const root = record(payload) ?? {};
	const envelope = record(root.d) ?? root;
	const data = record(envelope.Data) ?? envelope;
	const periods: AttendancePeriod[] = [];
	const periodSummary = record(data.PeriodSummary) ?? record(data.periodSummary);
	for (const school of asArray(periodSummary?.Schools as Record<string, unknown>[] | undefined)) {
		for (const term of asArray(record(school)?.Terms as Record<string, unknown>[] | undefined)) {
			for (const row of asArray(record(term)?.Rows as Record<string, unknown>[] | undefined)) {
				const number = String(row.Period ?? row.period ?? "");
				for (const section of asArray(row.Sections as Record<string, unknown>[] | undefined)) {
					const type = Number(section.ReasonType ?? section.reasonType ?? fallback.type);
					const reason = String(section.Reason ?? section.reason ?? fallback.reason);
					const kind = kindFromType(type, reason);
					if (!kind) continue;
					periods.push({
						number,
						name: number,
						course: String(section.Course ?? section.course ?? ""),
						staff: String(section.Teacher ?? section.staff ?? ""),
						reason,
						kind,
					});
				}
			}
		}
	}
	if (!periods.length) {
		const daily = record(data.PeriodDailySummary) ?? record(data.periodDailySummary);
		for (const school of asArray(daily?.Schools as Record<string, unknown>[] | undefined)) {
			for (const term of asArray(record(school)?.Terms as Record<string, unknown>[] | undefined)) {
				for (const row of asArray(record(term)?.Rows as Record<string, unknown>[] | undefined)) {
					const reason = String(row.Reason ?? row.reason ?? fallback.reason);
					const type = Number(row.ReasonType ?? row.reasonType ?? fallback.type);
					const kind = kindFromType(type, reason);
					if (!kind) continue;
					periods.push({
						number: "",
						name: "",
						course: "",
						staff: String(row.Teacher ?? ""),
						reason,
						kind,
					});
				}
			}
		}
	}
	const kind =
		periods.reduce<AttendanceKind | null>((worst, period) => {
			if (!worst) return period.kind;
			const rank: AttendanceKind[] = ["unexcused", "tardy", "activity", "excused", "holiday", "other"];
			return rank.indexOf(period.kind) <= rank.indexOf(worst) ? period.kind : worst;
		}, null) ??
		kindFromType(fallback.type, fallback.reason) ??
		"other";
	return {
		date: fallback.date,
		reason: fallback.reason || periods[0]?.reason || "",
		note: "",
		kind,
		periods,
	};
}

function emptyDay(mark: MarkedDay): AttendanceDay {
	return {
		date: mark.date,
		reason: mark.reason,
		note: "",
		kind: kindFromType(mark.type, mark.reason) ?? "other",
		periods: [],
	};
}

function periodTotals(days: AttendanceDay[]): AttendancePeriodTotal[] {
	const totals = new Map<string, AttendancePeriodTotal>();
	for (const day of days) {
		for (const period of day.periods) {
			if (!period.number) continue;
			if (period.kind !== "excused" && period.kind !== "tardy" && period.kind !== "unexcused" && period.kind !== "activity") {
				continue;
			}
			const current = totals.get(period.number) ?? {
				period: period.number,
				excused: 0,
				tardy: 0,
				unexcused: 0,
				activity: 0,
			};
			current[period.kind] += 1;
			totals.set(period.number, current);
		}
	}
	return [...totals.values()].sort((a, b) => Number(a.period) - Number(b.period));
}

async function fetchCalendarDay(
	base: string,
	cookies: string,
	referer: string,
	date: string,
): Promise<unknown> {
	const response = await studentVueFetch(`${base}/service/PXP2Communication.asmx/AttGetCalendarDay`, {
		method: "POST",
		headers: {
			Accept: "application/json, text/javascript, */*; q=0.01",
			"Content-Type": "application/json; charset=utf-8",
			"User-Agent": PAGE_UA,
			"X-Requested-With": "XMLHttpRequest",
			...(cookies ? { Cookie: cookies } : {}),
			Referer: referer,
			AGU: "0",
		},
		body: JSON.stringify({ agu: 0, date }),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new StudentVueError(`Attendance day request failed (${response.status})`, response.status);
	}
	try {
		return JSON.parse(text) as unknown;
	} catch {
		throw new StudentVueError("Attendance day request returned invalid JSON");
	}
}

export async function getWebAttendance(creds: Credentials): Promise<Attendance> {
	const token = await generateAuthToken(creds);
	const base = normalizeDistrictUrl(creds.districtUrl);
	const pagePath = `/PXP2_Attendance.aspx?VDT=0&token=${encodeURIComponent(token)}&AGU=0&LNG=98&regenerateSessionId=True&mobile=true&advancedSession=true&THEME=1&fontScalar=1`;
	const pageUrl = `${base}${pagePath}`;
	const page = await studentVueFetch(pageUrl, {
		method: "GET",
		headers: {
			Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			"User-Agent": PAGE_UA,
		},
		redirect: "follow",
	});
	const html = await page.text();
	if (!page.ok) {
		throw new StudentVueError(`Attendance page returned HTTP ${page.status}`, page.status);
	}
	const cookies = mergeCookies("", page);
	const marked = markedDaysFromPage(html);
	console.log("attendance.web", {
		page: page.status,
		html: html.length,
		calendar: html.includes("StudentAttendanceData"),
		marked: marked.length,
	});
	const absences: AttendanceDay[] = [];
	for (let i = 0; i < marked.length; i += 4) {
		const chunk = marked.slice(i, i + 4);
		const days = await Promise.all(
			chunk.map(async (mark) => {
				try {
					const payload = await fetchCalendarDay(base, cookies, pageUrl, mark.date);
					return parseCalendarDay(payload, mark);
				} catch {
					return emptyDay(mark);
				}
			}),
		);
		absences.push(...days);
	}
	return {
		type: "Period",
		absences,
		periodTotals: periodTotals(absences),
	};
}