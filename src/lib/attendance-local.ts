import type { Attendance } from "./studentvue/types";
import { cacheIsFresh } from "./grades/cache-policy";

const STORAGE_KEY = "gv_attendance";

export interface LocalAttendance {
	fetchedAt: number;
	attendance: Attendance;
}

function store(): Storage | null {
	try {
		return sessionStorage;
	} catch {
		return null;
	}
}

export function readLocalAttendance(): LocalAttendance | null {
	const storage = store();
	if (!storage) return null;
	try {
		const raw = storage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as LocalAttendance;
		if (!parsed?.attendance || !Array.isArray(parsed.attendance.absences)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export function peekLocalAttendance(): LocalAttendance | null {
	const cached = readLocalAttendance();
	if (!cached || !cacheIsFresh(cached.fetchedAt)) return null;
	return cached;
}

export function writeLocalAttendance(attendance: Attendance, fetchedAt: number): void {
	const storage = store();
	if (!storage) return;
	try {
		storage.setItem(STORAGE_KEY, JSON.stringify({ fetchedAt, attendance } satisfies LocalAttendance));
	} catch {
		// Ignore quota / private-mode failures.
	}
}

export function clearLocalAttendance(): void {
	store()?.removeItem(STORAGE_KEY);
}
