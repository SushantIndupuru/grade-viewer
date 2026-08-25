import { clearLocalAttendance } from "./attendance-local";
import { clearVault, readVault, writeVault, type StoredSession } from "./auth-vault";
import { clearLocalDocuments } from "./documents-local";
import { clearLocalGradebook } from "./gradebook-local";
import { hashLoginEmail } from "./login-hash";
import { folderTypeForName, isTrashFolder } from "./mail-folders";
import { clearLocalMail } from "./mail-local";
import type { DocumentFile, StudentProfile } from "./studentvue/types";

export type Session = StoredSession;

let memory: Session | null | undefined;

export async function getSession(): Promise<Session | null> {
	if (memory !== undefined) return memory;
	memory = await readVault();
	return memory;
}

export async function saveSession(session: Session): Promise<void> {
	memory = session;
	await writeVault(session);
}

export async function clearSession(): Promise<void> {
	memory = null;
	const { closeStudentVueTransport } = await import("./studentvue/transport");
	closeStudentVueTransport();
	await Promise.all([
		clearVault(),
		Promise.resolve(clearLocalGradebook()),
		Promise.resolve(clearLocalDocuments()),
		Promise.resolve(clearLocalMail()),
		Promise.resolve(clearLocalAttendance()),
	]);
}

const LOGIN_EXPIRED_MESSAGE = "Your session expired. Please sign in again.";

export function isSafeLoginNext(path: string | null | undefined): path is string {
	if (!path) return false;
	if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) return false;
	if (path === "/login" || path.startsWith("/login?") || path.startsWith("/login/")) return false;
	if (path === "/signup" || path.startsWith("/signup?")) return false;
	if (path === "/") return false;
	return true;
}

export function safeLoginNext(path: string | null | undefined): string {
	return isSafeLoginNext(path) ? path : "/grades";
}

function returnPath(): string | undefined {
	if (typeof location === "undefined") return undefined;
	const path = `${location.pathname}${location.search}`;
	return isSafeLoginNext(path) ? path : undefined;
}

export function loginHref(error?: string): string {
	const params = new URLSearchParams();
	if (error) params.set("error", error);
	const next = returnPath();
	if (next) params.set("next", next);
	const query = params.toString();
	return query ? `/login?${query}` : "/login";
}

export class LoginRedirectError extends Error {
	constructor() {
		super("Redirecting to sign in.");
		this.name = "LoginRedirectError";
	}
}

export function sendToLogin(expired = false): never {
	location.replace(loginHref(expired ? LOGIN_EXPIRED_MESSAGE : undefined));
	throw new LoginRedirectError();
}

export async function requireSession(): Promise<Session | null> {
	const session = await getSession();
	if (session) return session;
	location.replace(loginHref());
	return null;
}

export function applyStudentHeader(session: Session): void {
	const line = document.querySelector("[data-student-line]");
	if (!line) return;
	const name = session.student?.name || session.creds.username;
	const school = session.student?.school;
	line.textContent = school ? `${name} · ${school}` : name;
}

export class AuthExpiredError extends Error {
	constructor(message = "Your saved sign-in is no longer valid.") {
		super(message);
		this.name = "AuthExpiredError";
	}
}

interface LoginResult {
	student?: StudentProfile;
	districtUrl?: string;
	accessToken?: string;
	refreshToken?: string;
	error?: string;
}

async function studentVue() {
	return import("./studentvue");
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function downloadName(fileName: string): string {
	const base = fileName.replace(/["\\]/g, "").replace(/[^\w.\- ()]+/g, "_").trim() || "document.pdf";
	return base;
}

function fileResponse(file: DocumentFile): Response {
	return new Response(file.bytes, {
		headers: {
			"Content-Type": file.mimeType || "application/octet-stream",
			"Content-Disposition": `inline; filename="${downloadName(file.fileName)}"`,
			"Cache-Control": "no-store",
		},
	});
}

function studentVueHttpError(
	error: unknown,
	fallback: string,
	Unauthorized: typeof import("./studentvue").StudentVueError,
): Response {
	if (error instanceof Unauthorized && error.unauthorized) {
		return json({ error: "Session expired" }, 401);
	}
	const message = error instanceof Error ? error.message : fallback;
	return json({ error: message }, error instanceof Unauthorized ? 502 : 500);
}

async function postLogin(input: {
	username: string;
	password: string;
	districtUrl: string;
}): Promise<LoginResult> {
	const { login, normalizeDistrictUrl, StudentVueError } = await studentVue();
	try {
		const districtUrl = normalizeDistrictUrl(input.districtUrl);
		const { student, creds } = await login({
			username: input.username,
			password: input.password,
			districtUrl,
		});
		if (!creds.accessToken) throw new Error("Could not sign in.");
		return {
			student,
			districtUrl,
			accessToken: creds.accessToken,
			refreshToken: creds.refreshToken,
		};
	} catch (error) {
		if (error instanceof StudentVueError && error.unauthorized) {
			throw new AuthExpiredError(error.message || "Could not sign in.");
		}
		throw error instanceof Error ? error : new Error("Could not sign in.");
	}
}

function sessionFromLogin(
	input: { username: string; password: string; districtUrl: string },
	result: LoginResult,
	previous?: Session,
): Session {
	return {
		creds: {
			username: input.username,
			password: input.password,
			districtUrl: result.districtUrl || input.districtUrl,
			accessToken: result.accessToken,
			refreshToken: result.refreshToken,
		},
		student: result.student ?? previous?.student,
	};
}

export async function reportLoginEvent(email: string): Promise<void> {
	const emailHash = await hashLoginEmail(email);
	const response = await fetch("/api/login-event", {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({ emailHash }),
	});
	if (!response.ok) {
		let message = "Could not finish sign-in.";
		try {
			const payload = (await response.json()) as { error?: string };
			if (payload.error) message = payload.error;
		} catch {
			// Keep the default message.
		}
		throw new Error(message);
	}
}

function sessionEmail(session: Session): string {
	if (session.student?.email?.includes("@")) return session.student.email;
	if (session.creds.username.includes("@")) return session.creds.username;
	return "";
}

/** Updates last-seen usage time; failures are ignored so grade loads still succeed. */
export function touchLoginActivity(session: Session): void {
	const email = sessionEmail(session);
	if (!email) return;
	void reportLoginEvent(email).catch(() => {
		// Usage tracking must not block grade refreshes.
	});
}

export async function signIn(input: {
	username: string;
	password: string;
	districtUrl: string;
}): Promise<Session> {
	const result = await postLogin(input);
	const session = sessionFromLogin(input, result);
	const email = sessionEmail(session);
	await reportLoginEvent(email);
	await saveSession(session);
	return session;
}

export async function refreshSession(session: Session): Promise<Session> {
	if (!session.creds.password) {
		throw new AuthExpiredError();
	}
	const result = await postLogin({
		username: session.creds.username,
		password: session.creds.password,
		districtUrl: session.creds.districtUrl,
	});
	const next = sessionFromLogin(session.creds, result, session);
	await saveSession(next);
	return next;
}

export async function signOut(): Promise<void> {
	await clearSession();
}

export async function postGradebook(
	session: Session,
	_period: string,
	_refresh: boolean,
): Promise<Response> {
	const { getGradebook, StudentVueError } = await studentVue();
	try {
		if (!session.creds.accessToken) return json({ error: "Session expired" }, 401);
		const gradebook = await getGradebook(session.creds, _period || undefined);
		return json({ gradebook, fetchedAt: Date.now() });
	} catch (error) {
		return studentVueHttpError(error, "Could not load the gradebook.", StudentVueError);
	}
}

export async function postDocuments(session: Session, _refresh = false): Promise<Response> {
	const { getDocuments, StudentVueError } = await studentVue();
	try {
		if (!session.creds.accessToken) return json({ error: "Session expired" }, 401);
		const documents = await getDocuments(session.creds);
		return json({ documents, fetchedAt: Date.now() });
	} catch (error) {
		return studentVueHttpError(error, "Could not load documents.", StudentVueError);
	}
}

export async function postDocumentContent(session: Session, documentGU: string): Promise<Response> {
	const { getDocumentContent, StudentVueError } = await studentVue();
	try {
		if (!session.creds.accessToken) return json({ error: "Session expired" }, 401);
		if (!documentGU) return json({ error: "Document is required." }, 400);
		return fileResponse(await getDocumentContent(session.creds, documentGU));
	} catch (error) {
		return studentVueHttpError(error, "Could not load the document.", StudentVueError);
	}
}

export async function postMail(
	session: Session,
	folder: string,
	skip = 0,
	_refresh = false,
): Promise<Response> {
	const { getMail, StudentVueError } = await studentVue();
	try {
		if (!session.creds.accessToken) return json({ error: "Session expired" }, 401);
		const take = 25;
		const mailbox = await getMail(session.creds, folder, skip, take);
		return json({
			mailbox,
			hasMore: mailbox.messages.length >= take,
			fetchedAt: Date.now(),
		});
	} catch (error) {
		return studentVueHttpError(error, "Could not load mail.", StudentVueError);
	}
}

export async function postMailAttachment(session: Session, smAttachmentGU: string): Promise<Response> {
	const { getMailAttachment, StudentVueError } = await studentVue();
	try {
		if (!session.creds.accessToken) return json({ error: "Session expired" }, 401);
		if (!smAttachmentGU) return json({ error: "Attachment is required." }, 400);
		return fileResponse(await getMailAttachment(session.creds, smAttachmentGU));
	} catch (error) {
		return studentVueHttpError(error, "Could not load the attachment.", StudentVueError);
	}
}

export async function postMailRead(
	session: Session,
	smMessagePersonGU: string,
	_messageId: string,
	_folder: string,
	read = true,
): Promise<Response> {
	const { markMailRead, StudentVueError } = await studentVue();
	try {
		if (!session.creds.accessToken) return json({ error: "Session expired" }, 401);
		if (!smMessagePersonGU) return json({ error: "Message is required." }, 400);
		await markMailRead(session.creds, smMessagePersonGU, read);
		return json({ ok: true });
	} catch (error) {
		return studentVueHttpError(error, "Could not mark the message as read.", StudentVueError);
	}
}

export async function postMailDelete(
	session: Session,
	smMessagePersonGU: string,
	_messageId: string,
	folder: string,
): Promise<Response> {
	const { markMailDeleted, moveMailToTrash, StudentVueError } = await studentVue();
	try {
		if (!session.creds.accessToken) return json({ error: "Session expired" }, 401);
		if (!smMessagePersonGU) return json({ error: "Message is required." }, 400);
		if (isTrashFolder(folder)) await markMailDeleted(session.creds, smMessagePersonGU);
		else await moveMailToTrash(session.creds, smMessagePersonGU);
		return json({ ok: true });
	} catch (error) {
		return studentVueHttpError(error, "Could not delete the message.", StudentVueError);
	}
}

export async function postMailMove(
	session: Session,
	smMessagePersonGU: string,
	_messageId: string,
	_fromFolder: string,
	toFolder: string,
	folderType: string,
	smFolderGU: string,
): Promise<Response> {
	const { moveMail, StudentVueError } = await studentVue();
	try {
		if (!session.creds.accessToken) return json({ error: "Session expired" }, 401);
		if (!smMessagePersonGU) return json({ error: "Message is required." }, 400);
		if (!toFolder) return json({ error: "Folder is required." }, 400);
		const type = folderType || folderTypeForName(toFolder);
		if (!type && !smFolderGU) return json({ error: "Unknown mail folder." }, 400);
		await moveMail(session.creds, smMessagePersonGU, { folderType: type || "0", smFolderGU });
		return json({ ok: true });
	} catch (error) {
		return studentVueHttpError(error, "Could not move the message.", StudentVueError);
	}
}

export async function postAttendance(session: Session, _refresh = false): Promise<Response> {
	const { getAttendance, StudentVueError } = await studentVue();
	try {
		if (!session.creds.accessToken) return json({ error: "Session expired" }, 401);
		const attendance = await getAttendance(session.creds);
		return json({ attendance, fetchedAt: Date.now() });
	} catch (error) {
		return studentVueHttpError(error, "Could not load attendance.", StudentVueError);
	}
}
