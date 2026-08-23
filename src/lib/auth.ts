import type { AstroCookies } from "astro";
import type { Credentials } from "./studentvue/types";

const COOKIE = "gv_auth";

export function clearAuth(cookies: AstroCookies): void {
	cookies.delete(COOKIE, { path: "/" });
}

function asCreds(value: unknown): Credentials | null {
	if (!value || typeof value !== "object") return null;
	const raw = value as Record<string, unknown>;
	const username = String(raw.username ?? "").trim();
	const districtUrl = String(raw.districtUrl ?? "").trim();
	if (!username || !districtUrl) return null;
	const accessToken = raw.accessToken ? String(raw.accessToken) : "";
	const refreshToken = raw.refreshToken ? String(raw.refreshToken) : "";
	return {
		username,
		password: String(raw.password ?? ""),
		districtUrl,
		...(accessToken ? { accessToken } : {}),
		...(refreshToken ? { refreshToken } : {}),
	};
}

export function credentialsFromBody(body: unknown): Credentials | null {
	if (!body || typeof body !== "object") return null;
	if ("creds" in body) return asCreds((body as { creds: unknown }).creds);
	return asCreds(body);
}

export async function readJsonBody(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		return null;
	}
}
