import type { Credentials, StudentProfile } from "./studentvue/types";

const DB_NAME = "grade-viewer";
const DB_VERSION = 1;
const STORE = "kv";
const KEY_ID = "aes-key";
const VAULT_ID = "session";
const REMEMBER_MARKER = "gradeviewer.remembered-signin";
const SESSION_MARKER = "gradeviewer.session-signin";

export interface StoredSession {
	creds: Credentials;
	student?: StudentProfile;
}

function canUseVault(): boolean {
	return typeof window !== "undefined" && typeof indexedDB !== "undefined" && typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined";
}

function markerStorage(kind: "local" | "session"): Storage | null {
	if (typeof window === "undefined") return null;
	try {
		return kind === "local" ? window.localStorage : window.sessionStorage;
	} catch {
		return null;
	}
}

export function isRememberedVault(): boolean {
	return markerStorage("local")?.getItem(REMEMBER_MARKER) === "1";
}

function hasSessionVault(): boolean {
	return isRememberedVault() || markerStorage("session")?.getItem(SESSION_MARKER) === "1";

}

function setVaultLifetime(remember: boolean): void {
	const local = markerStorage("local");
	const session = markerStorage("session");
	if (remember) {
		local?.setItem(REMEMBER_MARKER, "1");
		session?.removeItem(SESSION_MARKER);
	} else {
		local?.removeItem(REMEMBER_MARKER);
		session?.setItem(SESSION_MARKER, "1");
	}

}

function clearVaultLifetime(): void {
	markerStorage("local")?.removeItem(REMEMBER_MARKER);
	markerStorage("session")?.removeItem(SESSION_MARKER);
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () => {
			const db = request.result;
			if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error("Could not open the login vault."));
	});
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
	return new Promise((resolve, reject) => {
		const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
		request.onsuccess = () => resolve(request.result as T | undefined);
		request.onerror = () => reject(request.error);
	});
}

function idbSet(db: IDBDatabase, key: string, value: unknown): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

function idbDel(db: IDBDatabase, key: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
	});
}

async function getOrCreateKey(db: IDBDatabase): Promise<CryptoKey> {
	const existing = await idbGet<CryptoKey>(db, KEY_ID);
	if (existing instanceof CryptoKey) return existing;
	const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
		"encrypt",
		"decrypt",
	]);
	await idbSet(db, KEY_ID, key);
	return key;
}

function asBufferSource(value: unknown): BufferSource | null {
	if (value instanceof ArrayBuffer) return value;
	if (ArrayBuffer.isView(value)) return value;
	return null;
}

function isSession(value: unknown): value is StoredSession {
	if (!value || typeof value !== "object") return false;
	const creds = (value as StoredSession).creds;
	return Boolean(creds?.username && creds.districtUrl && typeof creds.password === "string");
}

export async function readVault(): Promise<StoredSession | null> {
	if (!canUseVault()) return null;
	if (!hasSessionVault()) {
		await clearVault();
		return null;
	}
	try {
		const db = await openDb();
		const [key, packed] = await Promise.all([
			idbGet<CryptoKey>(db, KEY_ID),
			idbGet<{ iv: BufferSource; data: BufferSource }>(db, VAULT_ID),
		]);
		const iv = asBufferSource(packed?.iv);
		const data = asBufferSource(packed?.data);
		if (!(key instanceof CryptoKey) || !iv || !data) return null;
		const bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data));
		const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
		return isSession(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

export async function writeVault(session: StoredSession, remember = false): Promise<void> {
	if (!canUseVault()) {
		throw new Error("This browser cannot store an encrypted login.");
	}
	const db = await openDb();
	const key = await getOrCreateKey(db);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const data = new Uint8Array(
		await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv },
			key,
			new TextEncoder().encode(JSON.stringify(session)),
		),
	);
	await idbSet(db, VAULT_ID, { iv: iv.slice(), data });
	setVaultLifetime(remember);
}

export async function clearVault(): Promise<void> {
	clearVaultLifetime();
	if (!canUseVault()) return;
	try {
		const db = await openDb();
		await Promise.all([idbDel(db, KEY_ID), idbDel(db, VAULT_ID)]);
	} catch {
		// Ignore private-mode / blocked-storage failures.
	}
}
