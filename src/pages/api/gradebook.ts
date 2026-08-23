import type { APIRoute } from "astro";
import { loadCachedGradebook } from "../../lib/gradebook-cache";
import { clearAuth, credentialsFromBody, readJsonBody } from "../../lib/auth";

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export const GET: APIRoute = async ({ cookies }) => {
	clearAuth(cookies);
	return json({ error: "Session expired" }, 401);
};

export const POST: APIRoute = async ({ request, cookies }) => {
	const started = Date.now();
	clearAuth(cookies);

	const body = await readJsonBody(request);
	const creds = credentialsFromBody(body);
	const period =
		body && typeof body === "object" && "period" in body ? String((body as { period?: unknown }).period ?? "") : "";
	const refresh =
		body && typeof body === "object" && "refresh" in body
			? Boolean((body as { refresh?: unknown }).refresh)
			: false;

	try {
		if (!creds?.accessToken) {
			console.warn("gradebook.unauthorized", { period, refresh, ms: Date.now() - started });
			return json({ error: "Session expired" }, 401);
		}

		const { gradebook, fetchedAt, error, unauthorized: expired } = await loadCachedGradebook(
			creds,
			period,
			refresh,
		);

		if (expired) {
			console.warn("gradebook.expired", { period, refresh, ms: Date.now() - started });
			return json({ error: "Session expired" }, 401);
		}

		if (!gradebook) {
			console.error("gradebook.upstream_failed", {
				period,
				refresh,
				error,
				ms: Date.now() - started,
			});
			return json({ error: error || "Failed to load gradebook" }, 503);
		}

		console.log("gradebook.ok", {
			period,
			refresh,
			courses: gradebook.courses.length,
			ms: Date.now() - started,
		});
		return json({ gradebook, fetchedAt, error: error || undefined });
	} catch (error) {
		console.error("gradebook.unhandled", {
			period,
			refresh,
			ms: Date.now() - started,
			error: error instanceof Error ? error.stack || error.message : error,
		});
		return json({ error: "Could not load the gradebook." }, 500);
	}
};
