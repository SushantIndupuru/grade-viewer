import type { Credentials, Mailbox } from "./studentvue/types";
import { getMail, StudentVueError } from "./studentvue";
import { cacheIsFresh } from "./grades/cache-policy";

interface MailCache {
	folder: string;
	fetchedAt: number;
	mailbox: Mailbox;
	hasMore: boolean;
}

const memory = new Map<string, MailCache>();

function cacheKey(username: string, folder: string): string {
	return `${username.trim().toLowerCase()}:${folder.trim().toLowerCase()}`;
}

export async function loadCachedMail(
	creds: Credentials,
	folder: string,
	skip: number,
	take: number,
	refresh = false,
): Promise<{ mailbox: Mailbox | null; hasMore: boolean; fetchedAt: number; error: string; unauthorized?: boolean }> {
	const key = cacheKey(creds.username, folder);
	const cached = skip === 0 ? memory.get(key) : undefined;
	if (!refresh && skip === 0 && cached && cacheIsFresh(cached.fetchedAt)) {
		return { mailbox: cached.mailbox, hasMore: cached.hasMore, fetchedAt: cached.fetchedAt, error: "" };
	}

	try {
		const mailbox = await getMail(creds, folder, skip, take);
		const fetchedAt = Date.now();
		const hasMore = mailbox.messages.length >= take;
		if (skip === 0) {
			memory.set(key, { folder, fetchedAt, mailbox, hasMore });
			return { mailbox, hasMore, fetchedAt, error: "" };
		}
		const previous = memory.get(key);
		if (previous) {
			const merged: Mailbox = {
				folders: mailbox.folders.length ? mailbox.folders : previous.mailbox.folders,
				messages: [...previous.mailbox.messages, ...mailbox.messages],
			};
			memory.set(key, { folder, fetchedAt: previous.fetchedAt, mailbox: merged, hasMore });
			return { mailbox: merged, hasMore, fetchedAt: previous.fetchedAt, error: "" };
		}
		return { mailbox, hasMore, fetchedAt, error: "" };
	} catch (err) {
		if (err instanceof StudentVueError && err.unauthorized) {
			return { mailbox: null, hasMore: false, fetchedAt: 0, error: err.message, unauthorized: true };
		}
		const message = err instanceof StudentVueError ? err.message : "Could not load mail.";
		if (cached) {
			return {
				mailbox: cached.mailbox,
				hasMore: cached.hasMore,
				fetchedAt: cached.fetchedAt,
				error: message,
			};
		}
		return { mailbox: null, hasMore: false, fetchedAt: 0, error: message };
	}
}

export function markCachedMailRead(username: string, folder: string, messageId: string, read = true): void {
	const key = cacheKey(username, folder);
	const cached = memory.get(key);
	if (!cached) return;
	const message = cached.mailbox.messages.find((item) => item.id === messageId);
	if (!message || message.read === read) return;
	memory.set(key, {
		...cached,
		mailbox: {
			folders: cached.mailbox.folders.map((item) => {
				if (item.name.toLowerCase() !== folder.trim().toLowerCase()) return item;
				return { ...item, unread: Math.max(0, item.unread + (read ? -1 : 1)) };
			}),
			messages: cached.mailbox.messages.map((item) => (item.id === messageId ? { ...item, read } : item)),
		},
	});
}

export function removeCachedMail(username: string, folder: string, messageId: string): void {
	const key = cacheKey(username, folder);
	const cached = memory.get(key);
	if (!cached) return;
	const message = cached.mailbox.messages.find((item) => item.id === messageId);
	if (!message) return;
	memory.set(key, {
		...cached,
		mailbox: {
			folders: cached.mailbox.folders.map((item) => {
				if (item.name.toLowerCase() !== folder.trim().toLowerCase()) return item;
				return { ...item, unread: Math.max(0, item.unread - (message.read ? 0 : 1)) };
			}),
			messages: cached.mailbox.messages.filter((item) => item.id !== messageId),
		},
	});
}

export function moveCachedMail(username: string, fromFolder: string, toFolder: string, messageId: string): void {
	const fromKey = cacheKey(username, fromFolder);
	const source = memory.get(fromKey);
	const message = source?.mailbox.messages.find((item) => item.id === messageId);
	removeCachedMail(username, fromFolder, messageId);
	if (source) {
		const after = memory.get(fromKey);
		if (after) {
			memory.set(fromKey, {
				...after,
				mailbox: {
					...after.mailbox,
					folders: after.mailbox.folders.map((item) => {
						if (item.name.toLowerCase() !== toFolder.trim().toLowerCase()) return item;
						return { ...item, unread: Math.max(0, item.unread + (message && !message.read ? 1 : 0)) };
					}),
				},
			});
		}
	}
	if (!message) return;
	const toKey = cacheKey(username, toFolder);
	const dest = memory.get(toKey);
	if (!dest || dest.mailbox.messages.some((item) => item.id === messageId)) return;
	memory.set(toKey, {
		...dest,
		mailbox: {
			folders: dest.mailbox.folders.map((item) => {
				if (item.name.toLowerCase() !== toFolder.trim().toLowerCase()) return item;
				return { ...item, unread: Math.max(0, item.unread + (message.read ? 0 : 1)) };
			}),
			messages: [message, ...dest.mailbox.messages],
		},
	});
}
