export const GRADEBOOK_TTL_MS = 5 * 60 * 1000;
export const GRADEBOOK_BACKGROUND_REFRESH_MS = 60 * 1000;

export function cacheIsFresh(fetchedAt: number, now = Date.now()): boolean {
	return Number.isFinite(fetchedAt) && fetchedAt > 0 && now - fetchedAt < GRADEBOOK_TTL_MS;
}

export function gradebookNeedsBackgroundRefresh(fetchedAt: number, now = Date.now()): boolean {
	return !Number.isFinite(fetchedAt) || fetchedAt <= 0 || now - fetchedAt > GRADEBOOK_BACKGROUND_REFRESH_MS;
}

export function periodsMatch(requested: string, ...candidates: (string | null | undefined)[]): boolean {
	if (!requested) return true;
	return candidates.some((value) => Boolean(value) && value === requested);
}
