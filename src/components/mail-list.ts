import type { Mailbox, MailFolder, MailMessage } from "../lib/studentvue/types";
import { icons } from "./icons";
import { cacheIsFresh } from "../lib/grades/cache-policy";
import { peekLocalMail, readLocalMail, writeLocalMail } from "../lib/mail-local";
import { peekLocalGradebook, readLocalGradebook } from "../lib/gradebook-local";
import { formatDateTitle, formatShortDate, formatUpdatedAt } from "../lib/grades/display";
import { DEFAULT_FOLDERS, folderLabel, folderTypeForName, isTrashFolder, TRASH_FOLDER } from "../lib/mail-folders";
import {
	AuthExpiredError,
	clearSession,
	getSession,
	postMail,
	postMailAttachment,
	postMailDelete,
	postMailMove,
	postMailRead,
	refreshSession,
	type Session,
} from "../lib/session";
import { errorHtml, fillCourseNav, isSessionExpired, loadingHtml, SessionExpiredError, spinnerHtml } from "./grades-list";
import { fileNameFromResponse, openFilePreview, type PreviewSource } from "./file-preview";

interface Bootstrap {
	mailbox: Mailbox | null;
	fetchedAt: number;
	hasMore?: boolean;
	folder?: string;
	refresh?: boolean;
	error?: string;
}

interface MailPayload {
	mailbox?: Mailbox;
	fetchedAt?: number;
	hasMore?: boolean;
	error?: string;
}

const DROP_TAGS = new Set([
	"SCRIPT",
	"STYLE",
	"LINK",
	"META",
	"IFRAME",
	"OBJECT",
	"EMBED",
	"FORM",
	"BASE",
	"TEXTAREA",
	"INPUT",
	"BUTTON",
	"SVG",
	"MATH",
]);

const ALLOWED_TAGS = new Set([
	"A",
	"ABBR",
	"B",
	"BLOCKQUOTE",
	"BR",
	"CAPTION",
	"CITE",
	"CODE",
	"DIV",
	"EM",
	"H1",
	"H2",
	"H3",
	"H4",
	"H5",
	"H6",
	"HR",
	"I",
	"IMG",
	"LI",
	"OL",
	"P",
	"PRE",
	"SPAN",
	"STRONG",
	"SUB",
	"SUP",
	"TABLE",
	"TBODY",
	"TD",
	"TFOOT",
	"TH",
	"THEAD",
	"TR",
	"U",
	"UL",
]);

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function isSafeUrl(value: string, attr: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return false;
	if (trimmed.startsWith("#")) return true;
	if (attr === "href") return /^(https?:|mailto:)/i.test(trimmed);
	return /^https?:/i.test(trimmed);
}

function sanitizeMailHtml(html: string): string {
	const doc = new DOMParser().parseFromString(html, "text/html");
	for (const node of [...doc.body.querySelectorAll("*")]) {
		if (!node.isConnected) continue;
		if (DROP_TAGS.has(node.tagName)) {
			node.remove();
			continue;
		}
		if (!ALLOWED_TAGS.has(node.tagName)) {
			node.replaceWith(...node.childNodes);
			continue;
		}
		for (const attr of [...node.attributes]) {
			const name = attr.name.toLowerCase();
			if (name.startsWith("on") || name === "srcdoc" || name === "style" || name.startsWith("xmlns")) {
				node.removeAttribute(attr.name);
				continue;
			}
			if (name === "href" || name === "src") {
				if (!isSafeUrl(attr.value, name)) node.removeAttribute(attr.name);
				continue;
			}
			if ((node.tagName === "TD" || node.tagName === "TH") && (name === "colspan" || name === "rowspan")) {
				continue;
			}
			if (node.tagName === "IMG" && (name === "alt" || name === "width" || name === "height")) continue;
			if (name === "title") continue;
			node.removeAttribute(attr.name);
		}
		if (node.tagName === "A") {
			node.setAttribute("target", "_blank");
			node.setAttribute("rel", "noopener noreferrer");
		}
	}
	return doc.body.innerHTML;
}

function wrapMailBody(html: string): string {
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>
		html,body{margin:0;padding:0;font:14px/1.5 ui-sans-serif,system-ui,sans-serif;color:CanvasText;background:transparent}
		a{color:#2563eb} img{max-width:100%;height:auto} table{max-width:100%;border-collapse:collapse}
	</style></head><body>${html}</body></html>`;
}

function fillCachedCourses(): void {
	const local = peekLocalGradebook("") ?? readLocalGradebook("");
	if (!local) return;
	const selected = local.period || local.gradebook.reportingPeriod?.index || "";
	fillCourseNav(local.gradebook.courses, selected);
}

function expireSession(): never {
	location.replace("/?error=Your session expired. Please sign in again.");
	throw new SessionExpiredError();
}

async function parseMailResponse(response: Response): Promise<MailPayload> {
	let payload: MailPayload = {};
	try {
		payload = (await response.json()) as MailPayload;
	} catch {
		if (!response.ok) throw new Error("Could not load mail.");
	}
	if (!response.ok) {
		throw new Error(payload.error || "Could not load mail.");
	}
	return payload;
}

function mergeMailbox(previous: Mailbox | null, incoming: Mailbox, skip: number): Mailbox {
	if (!previous || skip === 0) return incoming;
	const seen = new Set(previous.messages.map((message) => message.id));
	return {
		folders: incoming.folders.length ? incoming.folders : previous.folders,
		messages: [...previous.messages, ...incoming.messages.filter((message) => !seen.has(message.id))],
	};
}

async function fetchMail(folder: string, skip: number, refresh: boolean): Promise<MailPayload> {
	if (!refresh && skip === 0) {
		const local = peekLocalMail(folder);
		if (local) {
			return { mailbox: local.mailbox, fetchedAt: local.fetchedAt, hasMore: local.hasMore };
		}
	}

	let session = await getSession();
	if (!session) expireSession();

	let response = await postMail(session, folder, skip, refresh);
	if (response.status === 401) {
		try {
			session = await refreshSession(session);
		} catch (error) {
			if (error instanceof AuthExpiredError) {
				await clearSession();
				expireSession();
			}
			throw error;
		}
		response = await postMail(session, folder, skip, refresh);
		if (response.status === 401) {
			await clearSession();
			expireSession();
		}
	}

	const payload = await parseMailResponse(response);
	if (payload.mailbox) {
		const local = skip > 0 ? readLocalMail(folder) : null;
		const mailbox = mergeMailbox(local?.mailbox ?? null, payload.mailbox, skip);
		writeLocalMail(folder, mailbox, payload.fetchedAt ?? Date.now(), Boolean(payload.hasMore));
		return { ...payload, mailbox };
	}
	return payload;
}

async function fetchAttachmentFile(smAttachmentGU: string, fallbackName: string): Promise<PreviewSource> {
	let session = await getSession();
	if (!session) expireSession();

	let response = await postMailAttachment(session, smAttachmentGU);
	if (response.status === 401) {
		try {
			session = await refreshSession(session);
		} catch (error) {
			if (error instanceof AuthExpiredError) {
				await clearSession();
				expireSession();
			}
			throw error;
		}
		response = await postMailAttachment(session, smAttachmentGU);
		if (response.status === 401) {
			await clearSession();
			expireSession();
		}
	}

	if (!response.ok) {
		let message = "Could not open the attachment.";
		try {
			const payload = (await response.json()) as { error?: string };
			if (payload.error) message = payload.error;
		} catch {
			// Keep the default message when the body is not JSON.
		}
		throw new Error(message);
	}

	const blob = await response.blob();
	return {
		blob,
		fileName: fileNameFromResponse(response, fallbackName),
		mimeType: blob.type || "application/pdf",
	};
}

function markMailboxRead(mailbox: Mailbox, folder: string, messageId: string, read = true): Mailbox {
	const message = mailbox.messages.find((item) => item.id === messageId);
	if (!message || message.read === read) return mailbox;
	return {
		folders: mailbox.folders.map((item) => {
			if (item.name.toLowerCase() !== folder.toLowerCase()) return item;
			return { ...item, unread: Math.max(0, item.unread + (read ? -1 : 1)) };
		}),
		messages: mailbox.messages.map((item) => (item.id === messageId ? { ...item, read } : item)),
	};
}

function removeMailboxMessage(mailbox: Mailbox, folder: string, messageId: string): Mailbox {
	const message = mailbox.messages.find((item) => item.id === messageId);
	if (!message) return mailbox;
	return {
		folders: mailbox.folders.map((item) => {
			if (item.name.toLowerCase() !== folder.toLowerCase()) return item;
			return { ...item, unread: Math.max(0, item.unread - (message.read ? 0 : 1)) };
		}),
		messages: mailbox.messages.filter((item) => item.id !== messageId),
	};
}

function prependMailboxMessage(mailbox: Mailbox, folder: string, message: MailMessage): Mailbox {
	if (mailbox.messages.some((item) => item.id === message.id)) return mailbox;
	return {
		folders: mailbox.folders.map((item) => {
			if (item.name.toLowerCase() !== folder.toLowerCase()) return item;
			return { ...item, unread: Math.max(0, item.unread + (message.read ? 0 : 1)) };
		}),
		messages: [message, ...mailbox.messages],
	};
}

function bumpFolderUnread(mailbox: Mailbox, folder: string, delta: number): Mailbox {
	if (!delta) return mailbox;
	return {
		...mailbox,
		folders: mailbox.folders.map((item) => {
			if (item.name.toLowerCase() !== folder.toLowerCase()) return item;
			return { ...item, unread: Math.max(0, item.unread + delta) };
		}),
	};
}

async function withMailSessionRetry(send: (session: Session) => Promise<Response>): Promise<Response> {
	let session = await getSession();
	if (!session) expireSession();

	let response = await send(session);
	if (response.status === 401) {
		try {
			session = await refreshSession(session);
		} catch (error) {
			if (error instanceof AuthExpiredError) {
				await clearSession();
				expireSession();
			}
			throw error;
		}
		response = await send(session);
		if (response.status === 401) {
			await clearSession();
			expireSession();
		}
	}
	return response;
}

async function notifyMailRead(message: MailMessage, folder: string, read = true): Promise<void> {
	if (!message.personId) return;
	const response = await withMailSessionRetry((session) =>
		postMailRead(session, message.personId, message.id, folder, read),
	);
	if (!response.ok) {
		throw new Error(read ? "Could not mark the message as read." : "Could not mark the message as unread.");
	}
}

async function notifyMailDelete(message: MailMessage, folder: string): Promise<void> {
	if (!message.personId) return;
	const response = await withMailSessionRetry((session) =>
		postMailDelete(session, message.personId, message.id, folder),
	);
	if (!response.ok) {
		throw new Error("Could not delete the message.");
	}
}

async function notifyMailMove(
	message: MailMessage,
	fromFolder: string,
	toFolder: string,
	folderType: string,
	smFolderGU: string,
): Promise<void> {
	if (!message.personId) return;
	const response = await withMailSessionRetry((session) =>
		postMailMove(session, message.personId, message.id, fromFolder, toFolder, folderType, smFolderGU),
	);
	if (!response.ok) {
		throw new Error("Could not move the message.");
	}
}

function folderMoveTarget(folder: MailFolder): { folderType: string; folderId: string } {
	return {
		folderType: folder.folderType || folderTypeForName(folder.name),
		folderId: folder.folderId || "",
	};
}

function orderedFolders(folders: MailFolder[]): MailFolder[] {
	const byName = new Map(folders.map((folder) => [folder.name.trim().toLowerCase(), folder]));
	const result: MailFolder[] = [];
	for (const name of DEFAULT_FOLDERS) {
		result.push(byName.get(name.toLowerCase()) ?? { name, unread: 0, folderType: folderTypeForName(name), folderId: "" });
		byName.delete(name.toLowerCase());
	}
	for (const folder of folders) {
		const key = folder.name.trim().toLowerCase();
		if (!DEFAULT_FOLDERS.some((name) => name.toLowerCase() === key)) result.push(folder);
	}
	return result;
}

function fromLine(message: MailMessage): string {
	if (!message.from.length) return "Unknown sender";
	return message.from.map((person) => (person.role ? `${person.name} · ${person.role}` : person.name)).join(", ");
}

function messageDate(message: MailMessage): { label: string; title: string } {
	const label = message.dateLabel.trim() || (message.date ? formatShortDate(message.date) : "");
	const title = message.date ? formatDateTitle(message.date) : label;
	return { label, title };
}

function renderFolders(folders: MailFolder[], selected: string): string {
	const items = orderedFolders(folders);
	return `<div class="mt-4 flex max-w-full items-center gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Mail folder">
		${items
			.map((folder) => {
				const active = folder.name.toLowerCase() === selected.toLowerCase();
				const unread =
					folder.unread > 0
						? `<span class="rounded-full bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">${folder.unread}</span>`
						: "";
				return `<button class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-2 py-1.5 text-sm whitespace-nowrap ${active ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}" data-folder="${escapeHtml(folder.name)}" type="button">${escapeHtml(folderLabel(folder.name))}${unread}</button>`;
			})
			.join("")}
	</div>`;
}

function renderList(mailbox: Mailbox, folder: string, fetchedAt: number, hasMore: boolean, warning = ""): string {
	const body =
		mailbox.messages.length === 0
			? `<p class="text-sm text-muted-foreground">No messages in ${escapeHtml(folderLabel(folder))}.</p>`
			: `<ol class="divide-y divide-border border-y border-border">${mailbox.messages
					.map((message) => {
						const date = messageDate(message);
						const unread = !message.read;
						return `<li>
						<button class="flex w-full cursor-pointer items-start justify-between gap-3 px-4 py-3.5 text-left text-foreground hover:bg-muted/60" type="button" data-open="${escapeHtml(message.id)}">
							<div class="min-w-0">
								<p class="flex items-center gap-2 ${unread ? "font-medium" : ""}">
									${unread ? `<span class="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-label="Unread"></span>` : ""}
									<span class="truncate">${escapeHtml(message.subject)}</span>
								</p>
								<p class="mt-1 truncate text-sm text-muted-foreground">${escapeHtml(fromLine(message))}</p>
							</div>
							<div class="flex shrink-0 flex-col items-end gap-1 text-sm text-muted-foreground">
								${date.label ? `<span title="${escapeHtml(date.title)}">${escapeHtml(date.label)}</span>` : ""}
								${message.attachments.length ? `<span class="inline-flex items-center gap-1">${icons.paperclip("h-3.5 w-3.5")}<span class="sr-only">Has attachments</span></span>` : ""}
							</div>
						</button>
					</li>`;
					})
					.join("")}</ol>`;

	const more = hasMore
		? `<p class="mt-4"><button class="h-8 cursor-pointer rounded border border-border px-2.5 text-sm hover:bg-muted" data-more type="button">Load more</button></p>`
		: "";

	return `${warning ? errorHtml(warning) : ""}
		${renderFolders(mailbox.folders, folder)}
		<p class="mt-3 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground" data-status>
			<span class="inline-flex items-center gap-1">
				${icons.clock("h-3.5 w-3.5")}
				Updated ${escapeHtml(formatUpdatedAt(fetchedAt))}
			</span>
			<button class="cursor-pointer underline" data-refresh type="button">Refresh</button>
		</p>
		${body}
		${more}`;
}

function renderMoveSelect(folders: MailFolder[], current: string): string {
	const targets = orderedFolders(folders).filter((item) => {
		if (item.name.toLowerCase() === current.toLowerCase()) return false;
		const dest = folderMoveTarget(item);
		return Boolean(dest.folderType || dest.folderId);
	});
	if (!targets.length) return "";
	return `<details class="relative inline-block" data-move>
		<summary class="inline-flex cursor-pointer list-none items-center gap-1 text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden [&::marker]:hidden">
			${icons.folderInput("h-4 w-4")}
			Move to
			${icons.chevronDown("h-3.5 w-3.5")}
		</summary>
		<div class="absolute right-0 z-20 mt-1 min-w-36 rounded border border-border bg-card py-1 text-foreground shadow-sm">
			${targets
				.map((item) => {
					const dest = folderMoveTarget(item);
					return `<button class="block w-full cursor-pointer px-3 py-1.5 text-left text-sm text-foreground hover:bg-muted" data-move-to="${escapeHtml(item.name)}" data-type="${escapeHtml(dest.folderType)}" data-gu="${escapeHtml(dest.folderId)}" type="button">${escapeHtml(folderLabel(item.name))}</button>`;
				})
				.join("")}
		</div>
	</details>`;
}

function renderDetail(message: MailMessage, folder: string, folders: MailFolder[]): string {
	const date = messageDate(message);
	const attachments = message.attachments.length
		? `<ul class="mt-3 space-y-1">
			${message.attachments
				.map((file) => {
					if (!file.id) {
						return `<li class="inline-flex items-center gap-1.5 text-sm text-muted-foreground">${icons.paperclip("h-3.5 w-3.5")}${escapeHtml(file.name)}</li>`;
					}
					return `<li>
						<button class="flex w-full cursor-pointer items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-foreground hover:bg-muted/60" type="button" data-attachment="${escapeHtml(file.id)}">
							<span class="inline-flex min-w-0 items-center gap-1.5">
								${icons.paperclip("h-3.5 w-3.5 shrink-0")}
								<span class="truncate">${escapeHtml(file.name)}</span>
							</span>
							<span class="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
								${icons.fileText("h-4 w-4")}
								View
							</span>
						</button>
					</li>`;
				})
				.join("")}
		</ul>`
		: "";

	const actions = message.personId
		? `<span class="ml-auto flex shrink-0 items-center gap-3">
			<button class="inline-flex cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-read-toggle type="button">${icons.mail("h-4 w-4")}${message.read ? "Mark as unread" : "Mark as read"}</button>
			${renderMoveSelect(folders, folder)}
			<button class="inline-flex cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-delete type="button">${icons.trash("h-4 w-4")}${isTrashFolder(folder) ? "Delete forever" : "Delete"}</button>
		</span>`
		: "";

	return `<div class="mt-4">
		<p class="mb-3 flex flex-wrap items-center gap-3">
			<button class="inline-flex cursor-pointer items-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-back type="button">
				${icons.chevronLeft("h-4 w-4")}
				${escapeHtml(folderLabel(folder))}
			</button>
			${actions}
		</p>
		<h1 class="text-lg font-medium">${escapeHtml(message.subject)}</h1>
		<p class="mt-2 text-sm text-muted-foreground">${escapeHtml(fromLine(message))}</p>
		${date.label ? `<p class="mt-1 text-sm text-muted-foreground" title="${escapeHtml(date.title)}">${escapeHtml(date.title || date.label)}</p>` : ""}
		<div class="mt-4 min-h-48 rounded border border-border bg-card p-3" data-mail-body></div>
		${attachments ? `<div class="mt-4">${attachments}</div>` : ""}
	</div>`;
}

function mountMailBody(host: Element, html: string): void {
	const sanitized = sanitizeMailHtml(html);
	if (!sanitized.trim()) {
		host.innerHTML = `<p class="text-sm text-muted-foreground">This message has no body.</p>`;
		return;
	}
	const iframe = document.createElement("iframe");
	iframe.setAttribute("sandbox", "allow-same-origin allow-popups allow-popups-to-escape-sandbox");
	iframe.setAttribute("title", "Message");
	iframe.className = "block w-full border-0";
	iframe.srcdoc = wrapMailBody(sanitized);
	iframe.addEventListener("load", () => {
		const doc = iframe.contentDocument;
		if (!doc) return;
		iframe.style.height = `${Math.max(doc.documentElement.scrollHeight, 160)}px`;
	});
	host.replaceChildren(iframe);
}

export function mountMailList(root: Element, data: Bootstrap): void {
	fillCachedCourses();
	let folder = data.folder?.trim() || "Inbox";
	let mailbox: Mailbox = { folders: [], messages: [] };
	let fetchedAt = 0;
	let hasMore = false;
	let warning = "";
	let selectedId = "";

	function selectedMessage(): MailMessage | null {
		return mailbox.messages.find((message) => message.id === selectedId) ?? null;
	}

	function applyLocalMove(message: MailMessage, toFolder: string): void {
		mailbox = removeMailboxMessage(mailbox, folder, message.id);
		mailbox = bumpFolderUnread(mailbox, toFolder, message.read ? 0 : 1);
		writeLocalMail(folder, mailbox, fetchedAt, hasMore);
		const dest = readLocalMail(toFolder);
		if (dest) {
			writeLocalMail(
				toFolder,
				prependMailboxMessage(dest.mailbox, toFolder, message),
				dest.fetchedAt,
				dest.hasMore,
			);
		}
	}

	function paint() {
		const message = selectedMessage();
		if (message) {
			root.innerHTML = renderDetail(message, folder, mailbox.folders);
			const host = root.querySelector("[data-mail-body]");
			if (host) mountMailBody(host, message.html);
		} else {
			root.innerHTML = renderList(mailbox, folder, fetchedAt, hasMore, warning);
		}
		bind();
	}

	function bind() {
		root.querySelector("[data-refresh]")?.addEventListener("click", () => {
			void load(folder, 0, true);
		});
		root.querySelector("[data-more]")?.addEventListener("click", (event) => {
			const button = event.currentTarget as HTMLButtonElement;
			button.disabled = true;
			button.textContent = "Loading…";
			void load(folder, mailbox.messages.length, false);
		});
		root.querySelector("[data-back]")?.addEventListener("click", () => {
			selectedId = "";
			paint();
		});
		root.querySelector("[data-read-toggle]")?.addEventListener("click", () => {
			const message = selectedMessage();
			if (!message) return;
			const read = !message.read;
			mailbox = markMailboxRead(mailbox, folder, message.id, read);
			writeLocalMail(folder, mailbox, fetchedAt, hasMore);
			void notifyMailRead(message, folder, read).catch((error) => {
				if (isSessionExpired(error)) return;
			});
			paint();
		});
		root.querySelector("[data-delete]")?.addEventListener("click", () => {
			const message = selectedMessage();
			if (!message?.personId) return;
			const permanent = isTrashFolder(folder);
			if (!confirm(permanent ? "Permanently delete this message?" : "Move this message to Trash?")) return;
			if (permanent) {
				mailbox = removeMailboxMessage(mailbox, folder, message.id);
				writeLocalMail(folder, mailbox, fetchedAt, hasMore);
			} else {
				applyLocalMove(message, TRASH_FOLDER);
			}
			selectedId = "";
			void notifyMailDelete(message, folder).catch((error) => {
				if (isSessionExpired(error)) return;
			});
			paint();
		});
		root.querySelectorAll<HTMLButtonElement>("[data-move-to]").forEach((button) => {
			button.addEventListener("click", () => {
				const toFolder = button.dataset.moveTo?.trim() ?? "";
				const message = selectedMessage();
				if (!toFolder || !message?.personId) return;
				applyLocalMove(message, toFolder);
				selectedId = "";
				void notifyMailMove(
					message,
					folder,
					toFolder,
					button.dataset.type ?? "",
					button.dataset.gu ?? "",
				).catch((error) => {
					if (isSessionExpired(error)) return;
				});
				paint();
			});
		});
		root.querySelectorAll<HTMLButtonElement>("[data-folder]").forEach((button) => {
			button.addEventListener("click", () => {
				const next = button.dataset.folder ?? "Inbox";
				if (next.toLowerCase() === folder.toLowerCase()) return;
				folder = next;
				selectedId = "";
				const local = peekLocalMail(folder) ?? readLocalMail(folder);
				if (local) {
					mailbox = local.mailbox;
					fetchedAt = local.fetchedAt;
					hasMore = local.hasMore;
					warning = "";
					writeLocalMail(folder, mailbox, fetchedAt, hasMore);
					paint();
					if (!peekLocalMail(folder)) void load(folder, 0, false);
					return;
				}
				void load(folder, 0, false);
			});
		});
		root.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((button) => {
			button.addEventListener("click", () => {
				selectedId = button.dataset.open ?? "";
				const message = mailbox.messages.find((item) => item.id === selectedId);
				if (message && !message.read) {
					mailbox = markMailboxRead(mailbox, folder, message.id);
					writeLocalMail(folder, mailbox, fetchedAt, hasMore);
					void notifyMailRead(message, folder).catch((error) => {
						if (isSessionExpired(error)) return;
					});
				}
				paint();
			});
		});
		root.querySelectorAll<HTMLButtonElement>("[data-attachment]").forEach((button) => {
			button.addEventListener("click", () => {
				const id = button.dataset.attachment ?? "";
				if (!id) return;
				const message = selectedMessage();
				const file = message?.attachments.find((item) => item.id === id);
				const title = file?.name.trim() || "Attachment";
				openFilePreview({
					title,
					load: () => fetchAttachmentFile(id, title),
				});
			});
		});
	}

	async function load(nextFolder: string, skip: number, refresh: boolean) {
		folder = nextFolder;
		if (!readLocalMail(folder) && skip === 0) {
			root.innerHTML = loadingHtml("Loading mail…");
		} else if (skip === 0) {
			const status = root.querySelector("[data-status]");
			if (status) {
				status.innerHTML = `<span class="inline-flex items-center gap-2" role="status" aria-live="polite">${spinnerHtml()} Loading mail…</span>`;
			}
		}
		try {
			const payload = await fetchMail(folder, skip, refresh);
			if (!payload.mailbox) {
				root.innerHTML = errorHtml(payload.error || "Could not load mail.");
				return;
			}
			mailbox = mergeMailbox(skip > 0 ? mailbox : null, payload.mailbox, skip);
			fetchedAt = payload.fetchedAt ?? Date.now();
			hasMore = Boolean(payload.hasMore);
			warning = payload.error ?? "";
			writeLocalMail(folder, mailbox, fetchedAt, hasMore);
			paint();
		} catch (error) {
			if (isSessionExpired(error)) return;
			root.innerHTML = errorHtml(error instanceof Error ? error.message : "Could not load mail.");
		}
	}

	if (data.mailbox && !data.refresh && cacheIsFresh(data.fetchedAt)) {
		mailbox = data.mailbox;
		fetchedAt = data.fetchedAt;
		hasMore = Boolean(data.hasMore);
		warning = data.error ?? "";
		writeLocalMail(folder, mailbox, fetchedAt, hasMore);
		paint();
		return;
	}

	const fresh = !data.refresh ? peekLocalMail(folder) : null;
	if (fresh) {
		mailbox = fresh.mailbox;
		fetchedAt = fresh.fetchedAt;
		hasMore = fresh.hasMore;
		paint();
		return;
	}

	const previous = readLocalMail(folder);
	if (previous) {
		mailbox = previous.mailbox;
		fetchedAt = previous.fetchedAt;
		hasMore = previous.hasMore;
		paint();
		void load(folder, 0, Boolean(data.refresh));
		return;
	}

	void load(folder, 0, Boolean(data.refresh));
}
