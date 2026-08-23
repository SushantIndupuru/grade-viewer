import type { APIRoute } from "astro";
import { loadCachedDocuments } from "../../lib/documents-cache";
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
	const refresh =
		body && typeof body === "object" && "refresh" in body
			? Boolean((body as { refresh?: unknown }).refresh)
			: false;

	try {
		if (!creds?.accessToken) {
			console.warn("documents.unauthorized", { refresh, ms: Date.now() - started });
			return json({ error: "Session expired" }, 401);
		}

		const { documents, fetchedAt, error, unauthorized: expired } = await loadCachedDocuments(creds, refresh);

		if (expired) {
			console.warn("documents.expired", { refresh, ms: Date.now() - started });
			return json({ error: "Session expired" }, 401);
		}

		if (!documents) {
			console.error("documents.upstream_failed", { refresh, error, ms: Date.now() - started });
			return json({ error: error || "Failed to load documents" }, 503);
		}

		console.log("documents.ok", { refresh, count: documents.length, ms: Date.now() - started });
		return json({ documents, fetchedAt, error: error || undefined });
	} catch (error) {
		console.error("documents.unhandled", {
			refresh,
			ms: Date.now() - started,
			error: error instanceof Error ? error.stack || error.message : error,
		});
		return json({ error: "Could not load documents." }, 500);
	}
};
