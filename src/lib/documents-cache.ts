import type { Credentials, StudentDocument } from "./studentvue/types";
import { getDocuments, StudentVueError } from "./studentvue";
import { cacheIsFresh } from "./grades/cache-policy";

interface DocumentsCache {
	fetchedAt: number;
	documents: StudentDocument[];
}

const memory = new Map<string, DocumentsCache>();

function cacheKey(username: string): string {
	return username.trim().toLowerCase();
}

export async function loadCachedDocuments(
	creds: Credentials,
	refresh = false,
): Promise<{ documents: StudentDocument[] | null; fetchedAt: number; error: string; unauthorized?: boolean }> {
	const cached = memory.get(cacheKey(creds.username));
	if (!refresh && cached && cacheIsFresh(cached.fetchedAt)) {
		return { documents: cached.documents, fetchedAt: cached.fetchedAt, error: "" };
	}

	try {
		const documents = await getDocuments(creds);
		const fetchedAt = Date.now();
		memory.set(cacheKey(creds.username), { fetchedAt, documents });
		return { documents, fetchedAt, error: "" };
	} catch (err) {
		if (err instanceof StudentVueError && err.unauthorized) {
			return { documents: null, fetchedAt: 0, error: err.message, unauthorized: true };
		}
		const message = err instanceof StudentVueError ? err.message : "Could not load documents.";
		if (cached) {
			return { documents: cached.documents, fetchedAt: cached.fetchedAt, error: message };
		}
		return { documents: null, fetchedAt: 0, error: message };
	}
}
