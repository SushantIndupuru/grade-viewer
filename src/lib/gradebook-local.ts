import type { Credentials, Gradebook } from "./studentvue/types.ts";
import { cacheIsFresh } from "./grades/cache-policy.ts";

export const GRADEBOOK_STORAGE_PREFIX = "gradeviewer.studentvue.gradebook.v2";
const CACHE_VERSION = 1;

export interface GradebookCacheAccount {
	district: string;
	username: string;
}

export interface LocalGradebook {
	period: string;
	fetchedAt: number;
	gradebook: Gradebook;
}

interface PersistedGradebookCache {
	version: typeof CACHE_VERSION;
	account: GradebookCacheAccount;
	periods: Record<string, LocalGradebook>;
}

function normalizeDistrict(value: string): string {
	try {
		return new URL(value).hostname.toLowerCase();
	} catch {
		return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
	}
}

function normalizeUsername(value: string): string {
	return value.trim().toLowerCase();
}

export function gradebookCacheAccount(
	credentials: Pick<Credentials, "districtUrl" | "username">,
): GradebookCacheAccount {
	return {
		district: normalizeDistrict(credentials.districtUrl),
		username: normalizeUsername(credentials.username),
	};
}

function cacheKey(account: GradebookCacheAccount): string {
	return `${GRADEBOOK_STORAGE_PREFIX}.${encodeURIComponent(account.district)}.${encodeURIComponent(account.username)}`;
}

function periodKey(period: string): string {
	return period || "default";
}

function store(): Storage | null {
	if (typeof window === "undefined") return null;
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function isRenderableGradebook(value: unknown): value is Gradebook {
	return Boolean(
		value &&
			typeof value === "object" &&
			Array.isArray((value as { courses?: unknown }).courses) &&
			(value as { courses: unknown[] }).courses.length > 0,
	);
}

function validSnapshot(value: unknown): LocalGradebook | null {
	if (!value || typeof value !== "object") return null;
	const snapshot = value as LocalGradebook;
	if (
		!Number.isFinite(snapshot.fetchedAt) ||
		snapshot.fetchedAt <= 0 ||
		!isRenderableGradebook(snapshot.gradebook)
	) {
		return null;
	}
	return snapshot;
}

function snapshotMatchesPeriod(snapshot: LocalGradebook, period: string): boolean {
	if (!period) return true;
	return snapshot.period === period || snapshot.gradebook.reportingPeriod?.index === period;
}

function isCacheForAccount(
	value: unknown,
	account: GradebookCacheAccount,
): value is PersistedGradebookCache {
	if (!value || typeof value !== "object") return false;
	const cache = value as Partial<PersistedGradebookCache>;
	return (
		cache.version === CACHE_VERSION &&
		cache.account?.district === account.district &&
		cache.account?.username === account.username &&
		Boolean(cache.periods) &&
		typeof cache.periods === "object"
	);
}

function removeAccountCache(account: GradebookCacheAccount): void {
	try {
		store()?.removeItem(cacheKey(account));
	} catch {
		// Storage is optional; StudentVUE loading can continue without it.
	}
}

function readAccountCache(account: GradebookCacheAccount): PersistedGradebookCache | null {
	const storage = store();
	if (!storage) return null;
	try {
		const parsed: unknown = JSON.parse(storage.getItem(cacheKey(account)) ?? "null");
		if (parsed === null) return null;
		if (isCacheForAccount(parsed, account)) return parsed;
		removeAccountCache(account);
	} catch {
		removeAccountCache(account);
	}
	return null;
}

export function readLocalGradebook(
	account: GradebookCacheAccount,
	period: string,
): LocalGradebook | null {
	const cache = readAccountCache(account);
	if (!cache) return null;
	const exact = cache.periods[periodKey(period)];
	if (exact) {
		const snapshot = validSnapshot(exact);
		if (snapshot) return snapshot;
		removeAccountCache(account);
		return null;
	}
	for (const candidate of Object.values(cache.periods)) {
		const snapshot = validSnapshot(candidate);
		if (snapshot && snapshotMatchesPeriod(snapshot, period)) return snapshot;
	}
	return null;
}

export function peekLocalGradebook(
	account: GradebookCacheAccount,
	period: string,
): LocalGradebook | null {
	const cached = readLocalGradebook(account, period);
	return cached && cacheIsFresh(cached.fetchedAt) ? cached : null;
}

export function writeLocalGradebook(
	account: GradebookCacheAccount,
	gradebook: Gradebook,
	fetchedAt: number,
	period = "",
): void {
	const storage = store();
	if (!storage || !isRenderableGradebook(gradebook) || !Number.isFinite(fetchedAt)) return;
	const existing = readAccountCache(account);
	const snapshot: LocalGradebook = {
		period: period || gradebook.reportingPeriod?.index || "",
		fetchedAt,
		gradebook,
	};
	const cache: PersistedGradebookCache = {
		version: CACHE_VERSION,
		account,
		periods: {
			...(existing?.periods ?? {}),
			[periodKey(period)]: snapshot,
		},
	};
	try {
		storage.setItem(cacheKey(account), JSON.stringify(cache));
	} catch {
		// Ignore quota and private-mode failures.
	}
}

/** Logout uses the stronger shared-device rule: remove every saved grade snapshot. */
export function clearLocalGradebook(): void {
	const storage = store();
	if (!storage) return;
	try {
		for (let index = storage.length - 1; index >= 0; index -= 1) {
			const key = storage.key(index);
			if (key === GRADEBOOK_STORAGE_PREFIX || key?.startsWith(`${GRADEBOOK_STORAGE_PREFIX}.`)) {
				storage.removeItem(key);
			}
		}
	} catch {
		// Storage may be disabled.
	}
}
