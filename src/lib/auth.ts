import type { AstroCookies } from "astro";

const COOKIE = "gv_auth";

/** Clears leftover auth cookies from older app versions. */
export function clearAuth(cookies: AstroCookies): void {
	cookies.delete(COOKIE, { path: "/" });
}
