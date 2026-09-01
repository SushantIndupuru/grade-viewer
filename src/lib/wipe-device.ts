const DB_NAME = "grade-viewer";
const GRADEBOOK_PREFIX = "gradeviewer.studentvue.gradebook.v2";
const LOCAL_KEYS = ["gradeviewer.remembered-signin"] as const;
const SESSION_KEYS = ["gradeviewer.session-signin", "gv_mail", "gv_documents", "gv_attendance"] as const;

function storage(kind: "local" | "session"): Storage | null {
	if (typeof window === "undefined") return null;
	try {
		return kind === "local" ? window.localStorage : window.sessionStorage;
	} catch {
		return null;
	}
}

function removeKeys(store: Storage | null, keys: readonly string[], prefix?: string): void {
	if (!store) return;
	try {
		for (const key of keys) store.removeItem(key);
		if (!prefix) return;
		for (let index = store.length - 1; index >= 0; index -= 1) {
			const key = store.key(index);
			if (key === prefix || key?.startsWith(`${prefix}.`)) store.removeItem(key);
		}
	} catch {
		// Storage may be disabled.
	}
}

function deleteDatabase(name: string): Promise<void> {
	if (typeof indexedDB === "undefined") return Promise.resolve();
	return new Promise((resolve) => {
		const request = indexedDB.deleteDatabase(name);
		request.onsuccess = () => resolve();
		request.onerror = () => resolve();
		request.onblocked = () => resolve();
	});
}

/** Deletes leftover logins and local copies from when the app still ran. */
export async function wipeDeviceData(): Promise<void> {
	removeKeys(storage("local"), LOCAL_KEYS, GRADEBOOK_PREFIX);
	removeKeys(storage("session"), SESSION_KEYS);
	await deleteDatabase(DB_NAME);
}
