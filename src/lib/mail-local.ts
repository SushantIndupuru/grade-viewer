import type { Mailbox } from "./studentvue/types";
import { cacheIsFresh } from "./grades/cache-policy";

const STORAGE_KEY = "gv_mail";

export interface LocalMail {
	folder: string;
	fetchedAt: number;
	hasMore: boolean;
	mailbox: Mailbox;
}

function store(): Storage | null {
	try {
		return sessionStorage;
	} catch {
		return null;
	}
}

function readAll(): Record<string, LocalMail> {
	const storage = store();
	if (!storage) return {};
	try {
		const raw = storage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as Record<string, LocalMail>;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

export function readLocalMail(folder: string): LocalMail | null {
	const entry = readAll()[folder.trim().toLowerCase()];
	if (!entry?.mailbox || !Array.isArray(entry.mailbox.messages)) return null;
	return entry;
}

export function peekLocalMail(folder: string): LocalMail | null {
	const cached = readLocalMail(folder);
	if (!cached || !cacheIsFresh(cached.fetchedAt)) return null;
	return cached;
}

export function writeLocalMail(folder: string, mailbox: Mailbox, fetchedAt: number, hasMore: boolean): void {
	const storage = store();
	if (!storage) return;
	const all = readAll();
	all[folder.trim().toLowerCase()] = { folder, fetchedAt, hasMore, mailbox };
	try {
		storage.setItem(STORAGE_KEY, JSON.stringify(all));
	} catch {
		// Ignore quota / private-mode failures.
	}
}

export function clearLocalMail(): void {
	store()?.removeItem(STORAGE_KEY);
}
