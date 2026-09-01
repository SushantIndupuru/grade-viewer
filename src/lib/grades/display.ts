import type { Assignment, Course } from "../studentvue/types";
import {
	calculateCourse,
	isExtraCredit,
	isSummaryCategory,
	toDraft,
	type AssignmentImpact,
	type DraftAssignment,
} from "./calculate";

export const CATEGORY_PALETTE = [
	{ dot: "bg-red-500", badge: "bg-red-100 text-red-900 dark:bg-red-900/50 dark:text-red-100" },
	{ dot: "bg-amber-500", badge: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100" },
	{ dot: "bg-sky-500", badge: "bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100" },
	{ dot: "bg-violet-500", badge: "bg-violet-100 text-violet-900 dark:bg-violet-900/50 dark:text-violet-100" },
	{ dot: "bg-rose-500", badge: "bg-rose-100 text-rose-900 dark:bg-rose-900/50 dark:text-rose-100" },
	{ dot: "bg-amber-500", badge: "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100" },
	{ dot: "bg-teal-600", badge: "bg-teal-100 text-teal-900 dark:bg-teal-900/50 dark:text-teal-100" },
	{ dot: "bg-fuchsia-500", badge: "bg-fuchsia-100 text-fuchsia-900 dark:bg-fuchsia-900/50 dark:text-fuchsia-100" },
] as const;

export function officialLetter(course: Pick<Course, "officialMark">): string | null {
	const mark = course.officialMark.trim();
	if (!mark || mark.toUpperCase() === "N/A") return null;
	return mark;
}

export function displayCourseTitle(title: string): string {
	const cleaned = title.replace(/\s*\(\s*\d{4,}\s*\)\s*$/, "").trim();
	return cleaned || title;
}

export function parseDate(value: string): Date | null {
	if (!value) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatShortDate(value: string): string {
	const date = parseDate(value);
	if (!date) return value;
	return `${date.getMonth() + 1}/${date.getDate()}/${String(date.getFullYear()).slice(-2)}`;
}

export function formatDateTitle(value: string): string {
	const date = parseDate(value);
	if (!date) return value;
	return date.toLocaleDateString("en-US", {
		weekday: "long",
		month: "long",
		day: "numeric",
		year: "numeric",
	});
}

export function formatGrade(value: number | null, digits = 2): string {
	if (value == null || Number.isNaN(value)) return "N/A";
	return `${Number(value.toFixed(digits))}%`;
}

export function displayPercent(course: Course): number | null {
	if (Number.isFinite(course.officialPercent)) return course.officialPercent;
	return calculateCourse(course, toDraft(course.assignments)).percent;
}

export function letterFromPercent(percent: number | null): string | null {
	if (percent == null || Number.isNaN(percent)) return null;
	if (percent >= 90) return "A";
	if (percent >= 80) return "B";
	if (percent >= 70) return "C";
	if (percent >= 60) return "D";
	return "F";
}

export function letterBand(letter: string | null | undefined): "A" | "B" | "C" | "D" | "F" | null {
	const mark = letter?.trim().toUpperCase();
	if (!mark || mark === "N/A") return null;
	const band = mark.charAt(0);
	if (band === "A" || band === "P") return "A";
	if (band === "B") return "B";
	if (band === "C") return "C";
	if (band === "D") return "D";
	if (band === "F" || band === "E") return "F";
	return null;
}

export function progressFillClass(percent: number | null, extraCredit = false, letter?: string | null): string {
	if (extraCredit) return "bg-indigo-700 dark:bg-indigo-600";
	const band = letterBand(letter ?? letterFromPercent(percent));
	if (band === "A") return "bg-emerald-700 dark:bg-emerald-600";
	if (band === "B") return "bg-amber-600 dark:bg-amber-500";
	if (band === "C") return "bg-orange-500 dark:bg-orange-400";
	if (band === "D") return "bg-orange-800 dark:bg-orange-600";
	if (band === "F") return "bg-rose-700 dark:bg-rose-600";
	return "bg-neutral-500";
}

export function progressTranslate(percent: number | null): string {
	if (percent == null || Number.isNaN(percent)) return "translateX(-100%)";
	const clamped = Math.min(Math.max(percent, 0), 100);
	return `translateX(-${(100 - clamped).toFixed(4)}%)`;
}

export function assignmentPercent(assignment: Pick<Assignment, "pointsEarned" | "pointsPossible" | "ungraded">): number | null {
	if (assignment.ungraded || assignment.pointsEarned == null || assignment.pointsPossible == null) {
		return null;
	}
	if (assignment.pointsPossible === 0) return assignment.pointsEarned > 0 ? 100 : 0;
	return (assignment.pointsEarned / assignment.pointsPossible) * 100;
}

export function uniqueCategories(
	assignments: { type: string }[],
	extra: string[] = [],
): string[] {
	const types = new Set<string>();
	for (const type of extra) if (type) types.add(type);
	for (const assignment of assignments) if (assignment.type) types.add(assignment.type);
	return [...types].filter((type) => !isSummaryCategory(type)).sort((a, b) => a.localeCompare(b));
}

export function formatCategoryWeight(
	type: string,
	categories: { type: string; weight: number }[],
): string | null {
	const usable = categories.filter((category) => !isSummaryCategory(category.type) && category.weight > 0);
	if (usable.length === 0) return null;
	const match = usable.find((category) => category.type === type);
	if (!match) return null;
	const max = Math.max(...usable.map((category) => category.weight));
	const percent = max <= 1 + 1e-9 ? match.weight * 100 : match.weight;
	const rounded =
		Math.abs(percent - Math.round(percent)) < 0.05 ? Math.round(percent) : Number(percent.toFixed(1));
	return `${rounded}%`;
}

export function categoryStyle(type: string, types: string[]) {
	const index = Math.max(0, types.indexOf(type));
	return CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
}

export function assignmentTimestamp(assignment: Pick<DraftAssignment, "date">, now = Date.now()): number {
	return parseDate(assignment.date)?.getTime() ?? now;
}

function isGraded(assignment: DraftAssignment): boolean {
	return (
		!assignment.dropped &&
		!assignment.ungraded &&
		assignment.pointsEarned != null &&
		assignment.pointsPossible != null &&
		(isExtraCredit(assignment) || assignment.pointsPossible > 0)
	);
}

function chronologicalGraded(
	assignments: DraftAssignment[],
	now = Date.now(),
): DraftAssignment[] {
	return assignments
		.map((assignment, index) => ({ assignment, index }))
		.filter(({ assignment }) => isGraded(assignment))
		.sort((a, b) => {
			const delta = assignmentTimestamp(a.assignment, now) - assignmentTimestamp(b.assignment, now);
			return delta || a.index - b.index;
		})
		.map(({ assignment }) => assignment);
}

export { assignmentImpacts, type AssignmentImpact } from "./calculate";

export function impactDisplay(impact: AssignmentImpact | null): { text: string; className: string } {
	if (impact == null || Number.isNaN(impact.value)) {
		return { text: "", className: "hidden" };
	}
	const rounded = Number(impact.value.toFixed(2));
	const text = impact.first
		? `${Number(rounded.toFixed(2))}%`
		: `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`;
	const tone = impact.first
		? rounded >= 90
			? "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-100"
			: rounded >= 80
				? "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100"
				: "border-transparent bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-100"
		: rounded > 0
			? "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-100"
			: rounded < 0
				? "border-transparent bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-100"
				: "border-transparent bg-secondary text-secondary-foreground";
	return {
		text,
		className: `inline-flex shrink-0 select-none items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold tabular-nums ${tone}`,
	};
}

export function gradeHistory(
	course: Pick<Course, "categories">,
	assignments: DraftAssignment[],
): { date: Date; percent: number }[] {
	const now = Date.now();
	const graded = chronologicalGraded(assignments, now);
	const points: { date: Date; percent: number }[] = [];
	const included = new Set<string>();
	let lastTime = -Infinity;
	for (const assignment of graded) {
		included.add(assignment.id);
		const snapshot = assignments.map((item) =>
			included.has(item.id) ? item : { ...item, dropped: true },
		);
		const result = calculateCourse(course, snapshot);
		let date = parseDate(assignment.date) ?? new Date(now);
		if (date.getTime() <= lastTime) date = new Date(lastTime + 60_000);
		lastTime = date.getTime();
		if (result.percent != null) points.push({ date, percent: result.percent });
	}
	return points;
}

export function formatUpdatedAt(fetchedAt: number): string {
	if (!fetchedAt) return "unknown";
	const delta = Date.now() - fetchedAt;
	if (delta < 15_000) return "now";
	if (delta < 60_000) return `${Math.max(1, Math.floor(delta / 1000))}s ago`;
	if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))}m ago`;
	if (delta < 86_400_000) return `${Math.max(1, Math.floor(delta / 3_600_000))}h ago`;
	return new Date(fetchedAt).toLocaleString();
}
