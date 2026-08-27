import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
	GRADEBOOK_STORAGE_PREFIX,
	clearLocalGradebook,
	gradebookCacheAccount,
	readLocalGradebook,
	writeLocalGradebook,
} from "../src/lib/gradebook-local.ts";
import type { Gradebook } from "../src/lib/studentvue/types.ts";

class MemoryStorage implements Storage {
	private values = new Map<string, string>();
	get length() { return this.values.size; }
	clear() { this.values.clear(); }
	getItem(key: string) { return this.values.get(key) ?? null; }
	key(index: number) { return [...this.values.keys()][index] ?? null; }
	removeItem(key: string) { this.values.delete(key); }
	setItem(key: string, value: string) { this.values.set(key, value); }
}

const storage = new MemoryStorage();
const gradebook: Gradebook = {
	reportingPeriods: [{ index: "1", gradePeriod: "Quarter 1", startDate: "", endDate: "" }],
	reportingPeriod: { index: "1", gradePeriod: "Quarter 1", startDate: "", endDate: "" },
	courses: [{
		period: "1", title: "Geometry", teacher: "Teacher", email: "", room: "12",
		officialMark: "A", officialPercent: 94, categories: [], assignments: [],
	}],
};

beforeEach(() => {
	storage.clear();
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { localStorage: storage },
	});
});

afterEach(() => {
	Reflect.deleteProperty(globalThis, "window");
});

test("persists renderable gradebooks by normalized district, account, and period", () => {
	const first = gradebookCacheAccount({ districtUrl: "https://District.Example.org/", username: " Student " });
	const same = gradebookCacheAccount({ districtUrl: "district.example.org", username: "student" });
	const other = gradebookCacheAccount({ districtUrl: "district.example.org", username: "other" });

	writeLocalGradebook(first, gradebook, 1234, "1");
	assert.deepEqual(readLocalGradebook(same, "1"), { period: "1", fetchedAt: 1234, gradebook });
	assert.equal(readLocalGradebook(same, "2"), null);
	assert.equal(readLocalGradebook(other, "1"), null);
});

test("reuses a default-term snapshot when the class page asks for that reporting period", () => {
	const account = gradebookCacheAccount({ districtUrl: "https://district.example.org", username: "student" });
	writeLocalGradebook(account, gradebook, 1234);
	assert.deepEqual(readLocalGradebook(account, "1"), { period: "1", fetchedAt: 1234, gradebook });
	assert.equal(readLocalGradebook(account, "2"), null);
});

test("never writes credentials and never replaces a valid cache with an empty gradebook", () => {
	const account = gradebookCacheAccount({ districtUrl: "https://district.example.org", username: "student" });
	writeLocalGradebook(account, gradebook, 1234);
	writeLocalGradebook(account, { ...gradebook, courses: [] }, 5678);

	const raw = storage.getItem(storage.key(0) ?? "") ?? "";
	assert.equal(raw.includes("password"), false);
	assert.equal(raw.includes("accessToken"), false);
	assert.equal(raw.includes("refreshToken"), false);
	assert.equal(readLocalGradebook(account, "")?.fetchedAt, 1234);
});

test("removes malformed caches and clears all account snapshots on logout", () => {
	const account = gradebookCacheAccount({ districtUrl: "district.example.org", username: "student" });
	storage.setItem(`${GRADEBOOK_STORAGE_PREFIX}.district.example.org.student`, "{bad json");
	assert.equal(readLocalGradebook(account, ""), null);

	writeLocalGradebook(account, gradebook, 1234);
	storage.setItem("unrelated", "keep");
	clearLocalGradebook();
	assert.equal(storage.length, 1);
	assert.equal(storage.getItem("unrelated"), "keep");
});
