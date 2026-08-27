import type { StudentDocument } from "../lib/studentvue/types";
import { icons } from "./icons";
import { cacheIsFresh } from "../lib/grades/cache-policy";
import { peekLocalDocuments, readLocalDocuments, writeLocalDocuments } from "../lib/documents-local";
import { gradebookCacheAccount, peekLocalGradebook, readLocalGradebook } from "../lib/gradebook-local";
import { categoryStyle, formatDateTitle, formatShortDate, formatUpdatedAt, parseDate } from "../lib/grades/display";
import {
	AuthExpiredError,
	clearSession,
	getSession,
	postDocumentContent,
	postDocuments,
	refreshSession,
	sendToLogin,
} from "../lib/session";
import { errorHtml, fillCourseNav, isSessionExpired, loadingHtml, spinnerHtml } from "./grades-list";
import { fileNameFromResponse, openFilePreview, type PreviewSource } from "./file-preview";

interface Bootstrap {
	documents: StudentDocument[] | null;
	fetchedAt: number;
	refresh?: boolean;
	error?: string;
}

interface DocumentsPayload {
	documents?: StudentDocument[];
	fetchedAt?: number;
	error?: string;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function documentTitle(doc: StudentDocument): string {
	return doc.comment.trim() || doc.fileName.trim() || "Untitled document";
}

function documentStamp(date: string): number {
	const parsed = parseDate(date);
	return parsed ? parsed.getTime() : 0;
}

function documentType(doc: StudentDocument): string {
	return doc.type.trim() || "Document";
}

function sortDocuments(documents: StudentDocument[]): StudentDocument[] {
	return [...documents].sort((a, b) => documentStamp(b.date) - documentStamp(a.date));
}

function documentTypes(documents: StudentDocument[]): string[] {
	const seen = new Set<string>();
	const types: string[] = [];
	for (const doc of sortDocuments(documents)) {
		const type = documentType(doc);
		if (seen.has(type)) continue;
		seen.add(type);
		types.push(type);
	}
	return types;
}

function typeBadge(type: string, types: string[]): string {
	const style = categoryStyle(type, types);
	return `<span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs ${style.badge}">${escapeHtml(type)}</span>`;
}

async function fillCachedCourses(): Promise<void> {
	const session = await getSession();
	if (!session) return;
	const account = gradebookCacheAccount(session.creds);
	const local = peekLocalGradebook(account, "") ?? readLocalGradebook(account, "");
	if (!local) return;
	const selected = local.period || local.gradebook.reportingPeriod?.index || "";
	fillCourseNav(local.gradebook.courses, selected);
}

async function parseDocumentsResponse(response: Response): Promise<DocumentsPayload> {
	let payload: DocumentsPayload = {};
	try {
		payload = (await response.json()) as DocumentsPayload;
	} catch {
		if (!response.ok) throw new Error("Could not load documents.");
	}
	if (!response.ok) {
		throw new Error(payload.error || "Could not load documents.");
	}
	return payload;
}

function expireSession(expired = false): never {
	sendToLogin(expired);
}

async function fetchDocuments(refresh = false): Promise<DocumentsPayload> {
	if (!refresh) {
		const local = peekLocalDocuments();
		if (local) return { documents: local.documents, fetchedAt: local.fetchedAt };
	}

	let session = await getSession();
	if (!session) expireSession();

	let response = await postDocuments(session, refresh);
	if (response.status === 401) {
		try {
			session = await refreshSession(session);
		} catch (error) {
			if (error instanceof AuthExpiredError) {
				await clearSession();
				expireSession(true);
			}
			throw error;
		}
		response = await postDocuments(session, refresh);
		if (response.status === 401) {
			await clearSession();
			expireSession(true);
		}
	}

	const payload = await parseDocumentsResponse(response);
	if (payload.documents) {
		writeLocalDocuments(payload.documents, payload.fetchedAt ?? Date.now());
	}
	return payload;
}

async function fetchDocumentFile(documentGU: string, fallbackName: string): Promise<PreviewSource> {
	let session = await getSession();
	if (!session) expireSession();

	let response = await postDocumentContent(session, documentGU);
	if (response.status === 401) {
		try {
			session = await refreshSession(session);
		} catch (error) {
			if (error instanceof AuthExpiredError) {
				await clearSession();
				expireSession(true);
			}
			throw error;
		}
		response = await postDocumentContent(session, documentGU);
		if (response.status === 401) {
			await clearSession();
			expireSession(true);
		}
	}

	if (!response.ok) {
		let message = "Could not open the document.";
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

function renderList(documents: StudentDocument[], fetchedAt: number, filter: string, warning = ""): string {
	const types = documentTypes(documents);
	const selected = types.includes(filter) ? filter : "all";
	const sorted = sortDocuments(documents);
	const visible = selected === "all" ? sorted : sorted.filter((doc) => documentType(doc) === selected);
	const filters =
		types.length > 1
			? `<div class="mt-4 flex max-w-full items-center gap-1 overflow-x-auto border-b border-border" role="tablist" aria-label="Document type">
			<button class="shrink-0 cursor-pointer border-b-2 px-2 py-1.5 text-sm ${selected === "all" ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}" data-filter="all" type="button">All</button>
			${types
				.map((type) => {
					const active = selected === type;
					const style = categoryStyle(type, types);
					return `<button class="inline-flex shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-2 py-1.5 text-sm whitespace-nowrap ${active ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}" data-filter="${escapeHtml(type)}" type="button"><span class="${style.dot} h-2 w-2 rounded-full"></span>${escapeHtml(type)}</button>`;
				})
				.join("")}
		</div>`
			: "";

	const body =
		documents.length === 0
			? `<p class="text-sm text-muted-foreground">No documents are available yet.</p>`
			: visible.length === 0
				? `<p class="text-sm text-muted-foreground">No documents of this type.</p>`
				: `<ol class="divide-y divide-border border-y border-border">${visible
						.map((doc) => {
							const title = documentTitle(doc);
							const type = documentType(doc);
							const dateLabel = doc.date ? formatShortDate(doc.date) : "";
							const dateTitle = doc.date ? formatDateTitle(doc.date) : "";
							return `<li>
						<button class="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3.5 text-left text-foreground hover:bg-muted/60" type="button" data-open="${escapeHtml(doc.id)}">
							<div class="min-w-0">
								<p class="font-medium">${escapeHtml(title)}</p>
								<div class="mt-1 flex flex-wrap items-center gap-1.5">
									${typeBadge(type, types)}
									${
										dateLabel
											? `<span class="text-sm text-muted-foreground" title="${escapeHtml(dateTitle)}">${escapeHtml(dateLabel)}</span>`
											: ""
									}
								</div>
							</div>
							<span class="inline-flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
								${icons.fileText("h-4 w-4")}
								View
							</span>
						</button>
					</li>`;
						})
						.join("")}</ol>`;

	return `${warning ? errorHtml(warning) : ""}
		${filters}
		<p class="mt-3 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground" data-status>
			<span class="inline-flex items-center gap-1">
				${icons.clock("h-3.5 w-3.5")}
				Updated ${escapeHtml(formatUpdatedAt(fetchedAt))}
			</span>
			<button class="cursor-pointer underline" data-refresh type="button">Refresh</button>
		</p>
		${body}`;
}

export function mountDocumentsList(root: Element, data: Bootstrap): void {
	void fillCachedCourses();
	let filter = "all";
	let current: StudentDocument[] = [];
	let fetchedAt = 0;
	let warning = "";

	function paint(documents: StudentDocument[], nextFetchedAt: number, nextWarning = "") {
		current = documents;
		fetchedAt = nextFetchedAt;
		warning = nextWarning;
		writeLocalDocuments(documents, nextFetchedAt);
		root.innerHTML = renderList(documents, nextFetchedAt, filter, nextWarning);
		bind();
	}

	function bind() {
		root.querySelector("[data-refresh]")?.addEventListener("click", () => {
			void load(true);
		});
		root.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach((button) => {
			button.addEventListener("click", () => {
				filter = button.dataset.filter ?? "all";
				root.innerHTML = renderList(current, fetchedAt, filter, warning);
				bind();
			});
		});
		root.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((button) => {
			button.addEventListener("click", () => {
				const id = button.dataset.open ?? "";
				const doc = current.find((item) => item.id === id);
				if (!id || !doc) return;
				const title = documentTitle(doc);
				openFilePreview({
					title,
					load: () => fetchDocumentFile(id, doc.fileName.trim() || title || "document.pdf"),
				});
			});
		});
	}

	async function load(refresh: boolean) {
		if (!readLocalDocuments()) {
			root.innerHTML = loadingHtml("Loading documents…");
		} else {
			const status = root.querySelector("[data-status]");
			if (status) {
				status.innerHTML = `<span class="inline-flex items-center gap-2" role="status" aria-live="polite">${spinnerHtml()} Loading documents…</span>`;
			}
		}
		try {
			const payload = await fetchDocuments(refresh);
			if (!payload.documents) {
				root.innerHTML = errorHtml(payload.error || "Could not load documents.");
				return;
			}
			paint(payload.documents, payload.fetchedAt ?? Date.now(), payload.error ?? "");
		} catch (error) {
			if (isSessionExpired(error)) return;
			root.innerHTML = errorHtml(error instanceof Error ? error.message : "Could not load documents.");
		}
	}

	if (data.documents && !data.refresh && cacheIsFresh(data.fetchedAt)) {
		paint(data.documents, data.fetchedAt, data.error ?? "");
		return;
	}

	const fresh = !data.refresh ? peekLocalDocuments() : null;
	if (fresh) {
		paint(fresh.documents, fresh.fetchedAt);
		return;
	}

	const previous = readLocalDocuments();
	if (previous) {
		paint(previous.documents, previous.fetchedAt);
		void load(Boolean(data.refresh));
		return;
	}

	void load(Boolean(data.refresh));
}
