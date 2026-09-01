import assert from "node:assert/strict";
import test from "node:test";
import { assignmentImpacts, calculateCourse, toDraft } from "../src/lib/grades/calculate.ts";
import type { Assignment, Course } from "../src/lib/studentvue/types.ts";

function assignment(id: string, type: string, earned: number | null, possible: number | null): Assignment {
	return { id, name: id, type, date: "2026-01-01", dueDate: "", score: "", displayScore: "", scoreType: "", pointsEarned: earned, pointsPossible: possible, notes: "", ungraded: earned == null };
}

function course(assignments: Assignment[]): Course {
	return {
		period: "1", title: "Course", teacher: "", email: "", room: "", officialMark: "A", officialPercent: 90,
		categories: [
			{ type: "Tests", weight: 60, points: 18, pointsPossible: 20, weightedPct: null, calculatedMark: "" },
			{ type: "Homework", weight: 40, points: 8, pointsPossible: 10, weightedPct: null, calculatedMark: "" },
		],
		assignments,
	};
}

test("calculates weighted categories and singular/plural matches", () => {
	const record = course([assignment("test", "Test", 8, 10), assignment("home", "Homework", 8, 10)]);
	assert.equal(calculateCourse(record, toDraft(record.assignments)).percent, 86);
});

test("moved assignments retain StudentVUE hidden aggregate points", () => {
	const record = course([assignment("test", "Test", 8, 10), assignment("home", "Homework", 8, 10)]);
	const draft = toDraft(record.assignments);
	draft[1].type = "Tests";
	assert.equal(calculateCourse(record, draft).percent, 86.66666666666667);
});

test("blank scores and no graded items produce no projection", () => {
	const record = course([assignment("blank", "Tests", null, 10)]);
	record.categories = record.categories.map((category) => ({ ...category, points: 0, pointsPossible: 0 }));
	assert.equal(calculateCourse(record, toDraft(record.assignments)).percent, null);
});

test("explicit zero-possible extra credit is included without inflating possible points", () => {
	const record = course([assignment("regular", "Tests", 8, 10), assignment("extra credit", "Tests", 2, 0)]);
	record.categories = [{ type: "Tests", weight: 100, points: 10, pointsPossible: 10, weightedPct: null, calculatedMark: "" }];
	assert.equal(calculateCourse(record, toDraft(record.assignments)).percent, 100);
});

test("hidden category totals remain in a hypothetical score edit", () => {
	const record = course([assignment("test", "Tests", 8, 10), assignment("home", "Homework", 8, 10)]);
	const draft = toDraft(record.assignments);
	draft[0].pointsEarned = 10;
	assert.equal(calculateCourse(record, draft).percent, 92);
});

test("assignment impact is the overall grade change when that score was added", () => {
	const record = course([assignment("test", "Tests", 8, 10), assignment("home", "Homework", 10, 10)]);
	record.categories = [
		{ type: "Tests", weight: 60, points: 8, pointsPossible: 10, weightedPct: null, calculatedMark: "" },
		{ type: "Homework", weight: 40, points: 10, pointsPossible: 10, weightedPct: null, calculatedMark: "" },
	];
	const impacts = assignmentImpacts(record, toDraft(record.assignments));
	assert.equal(calculateCourse(record, toDraft(record.assignments)).percent, 88);
	assert.deepEqual(impacts.get("test"), { value: 80, first: true });
	assert.deepEqual(impacts.get("home"), { value: 8, first: false });
});

test("ungraded assignments have no impact and extra credit raises the overall grade", () => {
	const record = course([
		assignment("quiz", "Tests", 8, 10),
		assignment("exam", "Tests", 8, 10),
		assignment("blank", "Tests", null, 10),
		{ ...assignment("bonus", "Tests", 2, 0), name: "extra credit" },
	]);
	record.categories = [
		{ type: "Tests", weight: 100, points: 18, pointsPossible: 20, weightedPct: null, calculatedMark: "" },
	];
	const impacts = assignmentImpacts(record, toDraft(record.assignments));
	assert.deepEqual(impacts.get("quiz"), { value: 80, first: true });
	assert.deepEqual(impacts.get("exam"), { value: 0, first: false });
	assert.equal(impacts.has("blank"), false);
	assert.deepEqual(impacts.get("bonus"), { value: 10, first: false });
});

test("a lone graded assignment still shows an overall impact", () => {
	const record = course([assignment("only", "Tests", 9, 10)]);
	record.categories = [
		{ type: "Tests", weight: 100, points: 9, pointsPossible: 10, weightedPct: null, calculatedMark: "" },
	];
	const impacts = assignmentImpacts(record, toDraft(record.assignments));
	assert.deepEqual(impacts.get("only"), { value: 90, first: true });
});
