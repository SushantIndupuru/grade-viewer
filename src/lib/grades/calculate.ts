import type { Assignment, CategorySummary, Course } from "../studentvue/types";

export interface DraftAssignment extends Assignment {
	dropped: boolean;
	added: boolean;
}

export interface CategoryResult {
	type: string;
	weight: number;
	earned: number;
	possible: number;
	percent: number | null;
	counted: boolean;
}

export interface CourseResult {
	percent: number | null;
	mode: "weighted" | "total-points";
	categories: CategoryResult[];
	earned: number;
	possible: number;
}

export function isSummaryCategory(type: string): boolean {
	return type.trim().toLowerCase() === "total";
}

export function toDraft(assignments: Assignment[]): DraftAssignment[] {
	return assignments.map((assignment) => ({
		...assignment,
		dropped: false,
		added: false,
	}));
}

export function isExtraCredit(
	assignment: Pick<Assignment, "name" | "pointsPossible" | "ungraded" | "pointsEarned">,
): boolean {
	if (assignment.ungraded || assignment.pointsEarned == null) return false;
	if (/extra\s*credit/i.test(assignment.name)) return true;
	return assignment.pointsPossible === 0;
}

function countsTowardGrade(assignment: DraftAssignment): boolean {
	if (assignment.dropped || assignment.ungraded || assignment.pointsEarned == null) return false;
	if (assignment.pointsPossible == null) return false;
	return isExtraCredit(assignment) || assignment.pointsPossible > 0;
}

function possibleTowardAverage(assignment: DraftAssignment): number {
	if (isExtraCredit(assignment)) return 0;
	return assignment.pointsPossible ?? 0;
}

function activeAssignments(assignments: DraftAssignment[]): DraftAssignment[] {
	return assignments.filter(countsTowardGrade);
}

export function calculateCourse(
	course: Pick<Course, "categories">,
	assignments: DraftAssignment[],
): CourseResult {
	const graded = activeAssignments(assignments);
	const earned = graded.reduce((sum, assignment) => sum + (assignment.pointsEarned ?? 0), 0);
	const possible = graded.reduce((sum, assignment) => sum + possibleTowardAverage(assignment), 0);

	const weights = course.categories.filter(
		(category) => category.weight > 0 && !isSummaryCategory(category.type),
	);
	if (weights.length === 0) {
		const percent = possible > 0 ? (earned / possible) * 100 : null;
		return {
			percent,
			mode: "total-points",
			categories: [],
			earned,
			possible,
		};
	}

	const grouped = new Map<string, DraftAssignment[]>();
	for (const assignment of graded) {
		const key = assignment.type || "Assignment";
		const list = grouped.get(key) ?? [];
		list.push(assignment);
		grouped.set(key, list);
	}

	const categories: CategoryResult[] = weights.map((category) => {
		const items = grouped.get(category.type) ?? [];
		const catEarned = items.reduce((sum, assignment) => sum + (assignment.pointsEarned ?? 0), 0);
		const catPossible = items.reduce((sum, assignment) => sum + possibleTowardAverage(assignment), 0);
		const counted = catPossible > 0;
		return {
			type: category.type,
			weight: category.weight,
			earned: catEarned,
			possible: catPossible,
			percent: counted ? (catEarned / catPossible) * 100 : null,
			counted,
		};
	});

	const activeWeight = categories.reduce(
		(sum, category) => sum + (category.counted ? category.weight : 0),
		0,
	);
	const weighted = categories.reduce((sum, category) => {
		if (!category.counted || category.percent == null) return sum;
		return sum + category.percent * category.weight;
	}, 0);
	const percent = activeWeight > 0 ? weighted / activeWeight : null;

	return {
		percent,
		mode: "weighted",
		categories,
		earned,
		possible,
	};
}

export function scoreNeeded(
	course: Pick<Course, "categories">,
	assignments: DraftAssignment[],
	targetId: string,
	targetPercent: number,
): number | null {
	const target = assignments.find((assignment) => assignment.id === targetId);
	if (!target || target.pointsPossible == null || target.pointsPossible <= 0) return null;

	const withZero: DraftAssignment[] = assignments.map((assignment) =>
		assignment.id === targetId
			? { ...assignment, ungraded: false, dropped: false, pointsEarned: 0 }
			: assignment,
	);
	const withFull: DraftAssignment[] = assignments.map((assignment) =>
		assignment.id === targetId
			? {
					...assignment,
					ungraded: false,
					dropped: false,
					pointsEarned: assignment.pointsPossible,
				}
			: assignment,
	);

	const low = calculateCourse(course, withZero).percent;
	const high = calculateCourse(course, withFull).percent;
	if (low == null || high == null || Math.abs(high - low) < 1e-9) return null;

	const neededRatio = (targetPercent - low) / (high - low);
	return neededRatio * target.pointsPossible;
}

export function formatPercent(value: number | null, digits = 2): string {
	if (value == null || Number.isNaN(value)) return "N/A";
	return `${value.toFixed(digits)}%`;
}

function localISODate(date = new Date()): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

export function emptyAssignment(type = "Assignment"): DraftAssignment {
	const today = localISODate();
	return {
		id: `whatif-${crypto.randomUUID()}`,
		name: "What-if assignment",
		type,
		date: today,
		dueDate: today,
		score: "",
		displayScore: "",
		scoreType: "Raw Score",
		pointsEarned: null,
		pointsPossible: 100,
		notes: "",
		ungraded: true,
		dropped: false,
		added: true,
	};
}

export function categoryTypes(course: Pick<Course, "categories" | "assignments">): string[] {
	const types = new Set<string>();
	for (const category of course.categories as CategorySummary[]) {
		if (category.type && !isSummaryCategory(category.type)) types.add(category.type);
	}
	for (const assignment of course.assignments) {
		if (assignment.type && !isSummaryCategory(assignment.type)) types.add(assignment.type);
	}
	if (types.size === 0) types.add("Assignment");
	return [...types];
}
