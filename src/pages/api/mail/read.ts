import type { APIRoute } from "astro";
import { clearAuth, credentialsFromBody, readJsonBody } from "../../../lib/auth";
import { markCachedMailRead } from "../../../lib/mail-cache";
import { markMailRead, StudentVueError } from "../../../lib/studentvue";

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
	const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
	const smMessagePersonGU = String(record.smMessagePersonGU ?? "").trim();
	const messageId = String(record.messageId ?? "").trim();
	const folder = String(record.folder ?? "Inbox").trim() || "Inbox";

	try {
		if (!creds?.accessToken) {
			console.warn("mail_read.unauthorized", { ms: Date.now() - started });
			return json({ error: "Session expired" }, 401);
		}
		if (!smMessagePersonGU) {
			return json({ error: "Message is required." }, 400);
		}

		const read = record.read !== false;
		await markMailRead(creds, smMessagePersonGU, read);
		if (messageId) markCachedMailRead(creds.username, folder, messageId, read);
		console.log("mail_read.ok", { folder, read, ms: Date.now() - started });
		return json({ ok: true });
	} catch (error) {
		if (error instanceof StudentVueError && error.unauthorized) {
			console.warn("mail_read.expired", { ms: Date.now() - started });
			return json({ error: "Session expired" }, 401);
		}
		console.error("mail_read.unhandled", {
			ms: Date.now() - started,
			error: error instanceof Error ? error.stack || error.message : error,
		});
		return json(
			{ error: error instanceof Error ? error.message : "Could not mark the message as read." },
			error instanceof StudentVueError ? 502 : 500,
		);
	}
};
