import type { StudentProfile } from "./studentvue/types";
import { clearVault, readVault, writeVault, type StoredSession } from "./auth-vault";
import { clearLocalAttendance } from "./attendance-local";
import { clearLocalDocuments } from "./documents-local";
import { clearLocalGradebook } from "./gradebook-local";
import { clearLocalMail } from "./mail-local";

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

async function postLogin(input: {
	username: string;
	password: string;
	districtUrl: string;
}): Promise<LoginResult> {
	const response = await fetch("/api/login", {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify(input),
	});
	const payload = (await response.json().catch(() => ({}))) as LoginResult;
	if (response.status === 400 || response.status === 401) {
		throw new AuthExpiredError(payload.error || "Could not sign in.");
	}
	if (!response.ok || !payload.accessToken) {
		throw new Error(payload.error || "Could not sign in.");
	}
	return payload;
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

export async function signIn(input: {
	username: string;
	password: string;
	districtUrl: string;
}): Promise<Session> {
	const result = await postLogin(input);
	const session = sessionFromLogin(input, result);
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
	try {
		await fetch("/api/logout", {
			method: "POST",
			headers: { Accept: "application/json" },
		});
	} catch {
		// Clearing leftover cookies is best-effort.
	}
}

export async function postGradebook(
	session: Session,
	period: string,
	refresh: boolean,
): Promise<Response> {
	return fetch("/api/gradebook", {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({
			period,
			refresh,
			creds: {
				username: session.creds.username,
				districtUrl: session.creds.districtUrl,
				accessToken: session.creds.accessToken,
				refreshToken: session.creds.refreshToken,
			},
		}),
	});
}

function credsBody(session: Session): Record<string, string | undefined> {
	return {
		username: session.creds.username,
		districtUrl: session.creds.districtUrl,
		accessToken: session.creds.accessToken,
		refreshToken: session.creds.refreshToken,
	};
}

export async function postDocuments(session: Session, refresh = false): Promise<Response> {
	return fetch("/api/documents", {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({ refresh, creds: credsBody(session) }),
	});
}

export async function postDocumentContent(session: Session, documentGU: string): Promise<Response> {
	return fetch("/api/documents/content", {
		method: "POST",
		headers: { Accept: "application/pdf, application/json", "Content-Type": "application/json" },
		body: JSON.stringify({ documentGU, creds: credsBody(session) }),
	});
}

export async function postMail(
	session: Session,
	folder: string,
	skip = 0,
	refresh = false,
): Promise<Response> {
	return fetch("/api/mail", {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({ folder, skip, take: 25, refresh, creds: credsBody(session) }),
	});
}

export async function postMailAttachment(session: Session, smAttachmentGU: string): Promise<Response> {
	return fetch("/api/mail/attachment", {
		method: "POST",
		headers: { Accept: "application/pdf, application/json", "Content-Type": "application/json" },
		body: JSON.stringify({ smAttachmentGU, creds: credsBody(session) }),
	});
}

export async function postMailRead(
	session: Session,
	smMessagePersonGU: string,
	messageId: string,
	folder: string,
	read = true,
): Promise<Response> {
	return fetch("/api/mail/read", {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({ smMessagePersonGU, messageId, folder, read, creds: credsBody(session) }),
	});
}

export async function postMailDelete(
	session: Session,
	smMessagePersonGU: string,
	messageId: string,
	folder: string,
): Promise<Response> {
	return fetch("/api/mail/delete", {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({ smMessagePersonGU, messageId, folder, creds: credsBody(session) }),
	});
}

export async function postMailMove(
	session: Session,
	smMessagePersonGU: string,
	messageId: string,
	fromFolder: string,
	toFolder: string,
	folderType: string,
	smFolderGU: string,
): Promise<Response> {
	return fetch("/api/mail/move", {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({
			smMessagePersonGU,
			messageId,
			fromFolder,
			toFolder,
			folderType,
			smFolderGU,
			creds: credsBody(session),
		}),
	});
}

export async function postAttendance(session: Session, refresh = false): Promise<Response> {
	return fetch("/api/attendance", {
		method: "POST",
		headers: { Accept: "application/json", "Content-Type": "application/json" },
		body: JSON.stringify({ refresh, creds: credsBody(session) }),
	});
}
