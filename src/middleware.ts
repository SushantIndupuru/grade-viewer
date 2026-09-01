import { defineMiddleware } from "astro:middleware";
import { clearAuth } from "./lib/auth";

function isRetiredAppPath(pathname: string): boolean {
	return (
		pathname === "/login" ||
		pathname.startsWith("/login/") ||
		pathname === "/signup" ||
		pathname.startsWith("/signup/") ||
		pathname === "/grades" ||
		pathname.startsWith("/grades/") ||
		pathname === "/documents" ||
		pathname.startsWith("/documents/") ||
		pathname === "/attendance" ||
		pathname.startsWith("/attendance/") ||
		pathname === "/mail" ||
		pathname.startsWith("/mail/") ||
		pathname === "/student-info" ||
		pathname.startsWith("/student-info/")
	);
}

export const onRequest = defineMiddleware(async ({ cookies, url, redirect }, next) => {
	clearAuth(cookies);
	if (isRetiredAppPath(url.pathname)) {
		return redirect("/", 302);
	}

	const response = await next();
	response.headers.set(
		"Content-Security-Policy",
		[
			"default-src 'self'",
			"base-uri 'self'",
			"object-src 'none'",
			"frame-ancestors 'none'",
			"script-src 'self' 'unsafe-inline'",
			"style-src 'self' 'unsafe-inline'",
			"img-src 'self' data:",
			"font-src 'self' data:",
			"connect-src 'self'",
		].join("; "),
	);
	response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
	response.headers.set("X-Content-Type-Options", "nosniff");
	response.headers.set("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
	response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
	return response;
});
