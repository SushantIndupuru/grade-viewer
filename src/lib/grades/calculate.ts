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

function categoryKey(value: string): string {
	const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
	return normalized.endsWith("s") ? normalized.slice(0, -1) : normalized;
}

export function matchGradeCategory(
	assignmentType: string,
	categories: Pick<CategorySummary, "type">[],
): string | null {
	const exact = categories.find((category) => category.type === assignmentType);
	if (exact) return exact.type;
	return categories.find((category) => categoryKey(category.type) === categoryKey(assignmentType))?.type ?? null;
}

export function calculateCourse(
	course: Pick<Course, "categories"> & Partial<Pick<Course, "assignments">>,
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

	const grouped = new Map<string, { earned: number; possible: number }>();
	for (const assignment of graded) {
		const key = (matchGradeCategory(assignment.type || "Assignment", weights) ?? assignment.type) || "Assignment";
		const points = grouped.get(key) ?? { earned: 0, possible: 0 };
		grouped.set(key, {
			earned: points.earned + (assignment.pointsEarned ?? 0),
			possible: points.possible + possibleTowardAverage(assignment),
		});
	}

	// StudentVUE category totals may contain aggregate/hidden work that is absent
	// from the assignment list. Preserve that fixed baseline in what-if math.
	const visibleOfficial = new Map<string, { earned: number; possible: number }>();
	for (const assignment of activeAssignments(toDraft(course.assignments ?? []))) {
		const key = (matchGradeCategory(assignment.type || "Assignment", weights) ?? assignment.type) || "Assignment";
		const points = visibleOfficial.get(key) ?? { earned: 0, possible: 0 };
		visibleOfficial.set(key, {
			earned: points.earned + (assignment.pointsEarned ?? 0),
			possible: points.possible + possibleTowardAverage(assignment),
		});
	}

	const categories: CategoryResult[] = weights.map((category) => {
		const draftPoints = grouped.get(category.type) ?? { earned: 0, possible: 0 };
		const visiblePoints = visibleOfficial.get(category.type) ?? { earned: 0, possible: 0 };
		const hasAggregate = Number.isFinite(category.points) && Number.isFinite(category.pointsPossible);
		const hiddenEarned = hasAggregate ? category.points - visiblePoints.earned : 0;
		const hiddenPossible = hasAggregate ? category.pointsPossible - visiblePoints.possible : 0;
		const catEarned = draftPoints.earned + hiddenEarned;
		const catPossible = draftPoints.possible + hiddenPossible;
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

export interface AssignmentImpact {
	value: number;
	first: boolean;
}

function assignmentTime(assignment: DraftAssignment, fallback: number): number {
	const parsed = Date.parse(assignment.date);
	return Number.isFinite(parsed) ? parsed : fallback;
}

/** Overall grade after this assignment if it was first, otherwise the change from earlier work. */
export function assignmentImpacts(
	course: Pick<Course, "categories"> & Partial<Pick<Course, "assignments">>,
	assignments: DraftAssignment[],
): Map<string, AssignmentImpact> {
	const impacts = new Map<string, AssignmentImpact>();
	const graded = assignments
		.map((assignment, index) => ({ assignment, index }))
		.filter(({ assignment }) => countsTowardGrade(assignment))
		.sort((a, b) => {
			const delta = assignmentTime(a.assignment, a.index) - assignmentTime(b.assignment, b.index);
			return delta || a.index - b.index;
		});

	const included = new Set<string>();
	let previous: number | null = null;
	for (const { assignment } of graded) {
		included.add(assignment.id);
		const snapshot = assignments.map((item) =>
			included.has(item.id) ? item : { ...item, dropped: true },
		);
		const percent = calculateCourse(course, snapshot).percent;
		if (percent == null) continue;
		impacts.set(assignment.id, {
			value: previous == null ? percent : percent - previous,
			first: previous == null,
		});
		previous = percent;
	}

	return impacts;
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
