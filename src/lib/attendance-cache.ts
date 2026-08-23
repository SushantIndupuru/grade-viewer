import type { Attendance, Credentials } from "./studentvue/types";
import { getAttendance, StudentVueError } from "./studentvue";
import { cacheIsFresh } from "./grades/cache-policy";

interface AttendanceCache {
	fetchedAt: number;
	attendance: Attendance;
}

const memory = new Map<string, AttendanceCache>();

function cacheKey(username: string): string {
	return username.trim().toLowerCase();
}

export async function loadCachedAttendance(
	creds: Credentials,
	refresh = false,
): Promise<{ attendance: Attendance | null; fetchedAt: number; error: string; unauthorized?: boolean }> {
	const cached = memory.get(cacheKey(creds.username));
	if (!refresh && cached && cacheIsFresh(cached.fetchedAt)) {
		return { attendance: cached.attendance, fetchedAt: cached.fetchedAt, error: "" };
	}

	try {
		const attendance = await getAttendance(creds);
		const fetchedAt = Date.now();
		memory.set(cacheKey(creds.username), { fetchedAt, attendance });
		return { attendance, fetchedAt, error: "" };
	} catch (err) {
		if (err instanceof StudentVueError && err.unauthorized) {
			return { attendance: null, fetchedAt: 0, error: err.message, unauthorized: true };
		}
		const message = err instanceof StudentVueError ? err.message : "Could not load attendance.";
		if (cached) {
			return { attendance: cached.attendance, fetchedAt: cached.fetchedAt, error: message };
		}
		return { attendance: null, fetchedAt: 0, error: message };
	}
}
