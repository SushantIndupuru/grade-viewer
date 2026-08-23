import type { Credentials, Gradebook } from "./studentvue/types";
import { getGradebook, StudentVueError } from "./studentvue";
import { cacheIsFresh, periodsMatch } from "./grades/cache-policy";

export interface GradebookCache {
	period: string;
	fetchedAt: number;
	gradebook: Gradebook;
}

const memory = new Map<string, GradebookCache>();

function cacheKey(username: string): string {
	return username.trim().toLowerCase();
}

function matchesPeriod(requested: string, cache: GradebookCache): boolean {
	return periodsMatch(requested, cache.period, cache.gradebook.reportingPeriod?.index);
}

export function peekCachedGradebook(creds: Credentials, period: string): GradebookCache | null {
	const cached = memory.get(cacheKey(creds.username));
	if (!cached || !matchesPeriod(period, cached) || !cacheIsFresh(cached.fetchedAt)) return null;
	return cached;
}

export async function loadCachedGradebook(
	creds: Credentials,
	period: string,
	refresh = false,
): Promise<{ gradebook: Gradebook | null; fetchedAt: number; error: string; unauthorized?: boolean }> {
	const cached = memory.get(cacheKey(creds.username));
	if (!refresh && cached && matchesPeriod(period, cached) && cacheIsFresh(cached.fetchedAt)) {
		return { gradebook: cached.gradebook, fetchedAt: cached.fetchedAt, error: "" };
	}

	try {
		const gradebook = await getGradebook(creds, period || undefined);
		const fetchedAt = Date.now();
		const next: GradebookCache = {
			period: period || gradebook.reportingPeriod?.index || "",
			fetchedAt,
			gradebook,
		};
		memory.set(cacheKey(creds.username), next);
		return { gradebook, fetchedAt, error: "" };
	} catch (err) {
		if (err instanceof StudentVueError && err.unauthorized) {
			return { gradebook: null, fetchedAt: 0, error: err.message, unauthorized: true };
		}
		const message =
			err instanceof StudentVueError ? err.message : "Could not load the gradebook.";
		if (cached && matchesPeriod(period, cached)) {
			return { gradebook: cached.gradebook, fetchedAt: cached.fetchedAt, error: message };
		}
		return { gradebook: null, fetchedAt: 0, error: message };
	}
}
