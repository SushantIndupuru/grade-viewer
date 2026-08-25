import { defineMiddleware } from "astro:middleware";
import { clearAuth } from "./lib/auth";

function wispConnectSrc(): string[] {
	const raw = (import.meta.env.PUBLIC_WISP_URL ?? "").trim();
	if (!raw) return [];
	try {
		return [new URL(raw).origin];
	} catch {
		return [];
	}
}

export const onRequest = defineMiddleware(async ({ cookies }, next) => {
	clearAuth(cookies);
	const response = await next();
	const connect = ["'self'", ...wispConnectSrc()].join(" ");
	response.headers.set(
		"Content-Security-Policy",
		[
			"default-src 'self'",
			"base-uri 'self'",
			"object-src 'none'",
			"frame-ancestors 'none'",
			"script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
			"style-src 'self' 'unsafe-inline'",
			"img-src 'self' data: blob:",
			"font-src 'self' data:",
			`connect-src ${connect}`,
			"worker-src 'self' blob:",
			"frame-src 'self' blob: data:",
		].join("; "),
	);
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
	response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
	return response;
});
