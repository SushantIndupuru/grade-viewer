import type { StudentDocument } from "./studentvue/types";
import { cacheIsFresh } from "./grades/cache-policy";

const STORAGE_KEY = "gv_documents";

export interface LocalDocuments {
	fetchedAt: number;
	documents: StudentDocument[];
}

function store(): Storage | null {
	try {
		return sessionStorage;
	} catch {
		return null;
	}
}

export function readLocalDocuments(): LocalDocuments | null {
	const storage = store();
	if (!storage) return null;
	try {
		const raw = storage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as LocalDocuments;
		if (!parsed || !Array.isArray(parsed.documents)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function peekLocalDocuments(): LocalDocuments | null {
	const cached = readLocalDocuments();
	if (!cached || !cacheIsFresh(cached.fetchedAt)) return null;
	return cached;
}

export function writeLocalDocuments(documents: StudentDocument[], fetchedAt: number): void {
	const storage = store();
	if (!storage) return;
	try {
		storage.setItem(STORAGE_KEY, JSON.stringify({ fetchedAt, documents } satisfies LocalDocuments));
	} catch {
		// Ignore quota / private-mode failures.
	}
}

export function clearLocalDocuments(): void {
	store()?.removeItem(STORAGE_KEY);
}
