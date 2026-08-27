export type StudentVueAuthMode = "mobile-rest";

export type StudentVueTransportMode = "libcurl";

export interface StudentVueTransportConfig {
	mode: StudentVueTransportMode;
	wispUrl?: string;
}

function isLocalHostname(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function validateWispUrl(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error("PUBLIC_WISP_URL_2 must be a valid absolute WebSocket URL.");
	}
	if (url.username || url.password) {
		throw new Error("PUBLIC_WISP_URL_2 must not contain credentials.");
	}
	if (url.search || url.hash) {
		throw new Error("PUBLIC_WISP_URL_2 must not contain a query string or fragment.");
	}
	if (url.protocol === "wss:") {
		if (!url.pathname.endsWith("/")) url.pathname += "/";
		return url;
	}
	if (url.protocol === "ws:" && isLocalHostname(url.hostname)) {
		if (!url.pathname.endsWith("/")) url.pathname += "/";
		return url;
	}
	throw new Error("PUBLIC_WISP_URL_2 must use wss: (ws: is allowed only on localhost).");
}

export function resolveWispUrl(
	configuredValue: string | undefined,
	dev: boolean,
	locationHref?: string,
): string {
	const configured = (configuredValue ?? "").trim();
	if (configured) return validateWispUrl(configured).href;
	if (dev && locationHref) {
		const url = new URL("/wisp/", locationHref);
		url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
		return url.href;
	}
	throw new Error("PUBLIC_WISP_URL_2 is required in production (astro dev serves /wisp/ locally).");
}

export function resolveStudentVueTransportMode(value: string | undefined): StudentVueTransportMode {
	const configured = (value ?? "libcurl").trim();
	if (configured === "libcurl") return configured;
	throw new Error("PUBLIC_STUDENTVUE_TRANSPORT must be libcurl.");
}

export function resolveStudentVueAuthMode(value: string | undefined): StudentVueAuthMode {
	const configured = (value ?? "mobile-rest").trim();
	if (configured === "mobile-rest") return configured;
	throw new Error("PUBLIC_STUDENTVUE_AUTH must be mobile-rest.");
}
