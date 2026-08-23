import type { Gradebook } from "./studentvue/types";
import { cacheIsFresh, periodsMatch } from "./grades/cache-policy";

const STORAGE_KEY = "gv_gradebook";

export interface LocalGradebook {
	period: string;
	fetchedAt: number;
	gradebook: Gradebook;
}

function store(): Storage | null {
	try {
		return sessionStorage;
	} catch {
		return null;
	}
}

export function readLocalGradebook(period: string): LocalGradebook | null {
	const storage = store();
	if (!storage) return null;
	try {
		const raw = storage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as LocalGradebook;
		if (!parsed?.gradebook || !Array.isArray(parsed.gradebook.courses)) return null;
		if (!periodsMatch(period, parsed.period, parsed.gradebook.reportingPeriod?.index)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function peekLocalGradebook(period: string): LocalGradebook | null {
	const cached = readLocalGradebook(period);
	if (!cached || !cacheIsFresh(cached.fetchedAt)) return null;
	return cached;
}

export function writeLocalGradebook(gradebook: Gradebook, fetchedAt: number, period = ""): void {
	const storage = store();
	if (!storage) return;
	const resolved = period || gradebook.reportingPeriod?.index || "";
	try {
		storage.setItem(
			STORAGE_KEY,
			JSON.stringify({ period: resolved, fetchedAt, gradebook } satisfies LocalGradebook),
		);
	} catch {
		// Ignore quota / private-mode failures.
	}
}

export function clearLocalGradebook(): void {
	store()?.removeItem(STORAGE_KEY);
}
