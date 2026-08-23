import type { APIRoute } from "astro";
import { loadCachedMail } from "../../lib/mail-cache";
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
	const folder =
		body && typeof body === "object" && "folder" in body
			? String((body as { folder?: unknown }).folder ?? "Inbox") || "Inbox"
			: "Inbox";
	const skip =
		body && typeof body === "object" && "skip" in body
			? Math.max(0, Number((body as { skip?: unknown }).skip) || 0)
			: 0;
	const take =
		body && typeof body === "object" && "take" in body
			? Math.min(50, Math.max(1, Number((body as { take?: unknown }).take) || 25))
			: 25;
	const refresh =
		body && typeof body === "object" && "refresh" in body
			? Boolean((body as { refresh?: unknown }).refresh)
			: false;

	try {
		if (!creds?.accessToken) {
			console.warn("mail.unauthorized", { folder, skip, refresh, ms: Date.now() - started });
			return json({ error: "Session expired" }, 401);
		}

		const { mailbox, hasMore, fetchedAt, error, unauthorized: expired } = await loadCachedMail(
			creds,
			folder,
			skip,
			take,
			refresh,
		);

		if (expired) {
			console.warn("mail.expired", { folder, skip, refresh, ms: Date.now() - started });
			return json({ error: "Session expired" }, 401);
		}

		if (!mailbox) {
			console.error("mail.upstream_failed", { folder, skip, refresh, error, ms: Date.now() - started });
			return json({ error: error || "Failed to load mail" }, 503);
		}

		console.log("mail.ok", {
			folder,
			skip,
			refresh,
			count: mailbox.messages.length,
			ms: Date.now() - started,
		});
		return json({ mailbox, hasMore, fetchedAt, error: error || undefined });
	} catch (error) {
		console.error("mail.unhandled", {
			folder,
			skip,
			refresh,
			ms: Date.now() - started,
			error: error instanceof Error ? error.stack || error.message : error,
		});
		return json({ error: "Could not load mail." }, 500);
	}
};
