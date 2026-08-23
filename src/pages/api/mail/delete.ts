import type { APIRoute } from "astro";
import { clearAuth, credentialsFromBody, readJsonBody } from "../../../lib/auth";
import { moveCachedMail, removeCachedMail } from "../../../lib/mail-cache";
import { markMailDeleted, moveMailToTrash, StudentVueError } from "../../../lib/studentvue";

const TRASH_FOLDER = "Archive";

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function isTrashFolder(folder: string): boolean {
	return folder.trim().toLowerCase() === "archive";
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
	const permanent = isTrashFolder(folder);

	try {
		if (!creds?.accessToken) {
			console.warn("mail_delete.unauthorized", { ms: Date.now() - started });
			return json({ error: "Session expired" }, 401);
		}
		if (!smMessagePersonGU) {
			return json({ error: "Message is required." }, 400);
		}

		if (permanent) {
			await markMailDeleted(creds, smMessagePersonGU);
			if (messageId) removeCachedMail(creds.username, folder, messageId);
		} else {
			await moveMailToTrash(creds, smMessagePersonGU);
			if (messageId) moveCachedMail(creds.username, folder, TRASH_FOLDER, messageId);
		}
		console.log("mail_delete.ok", { folder, permanent, ms: Date.now() - started });
		return json({ ok: true });
	} catch (error) {
		if (error instanceof StudentVueError && error.unauthorized) {
			console.warn("mail_delete.expired", { ms: Date.now() - started });
			return json({ error: "Session expired" }, 401);
		}
		console.error("mail_delete.unhandled", {
			ms: Date.now() - started,
			error: error instanceof Error ? error.stack || error.message : error,
		});
		return json(
			{
				error: error instanceof Error
					? error.message
					: permanent
						? "Could not delete the message."
						: "Could not move the message to Trash.",
			},
			error instanceof StudentVueError ? 502 : 500,
		);
	}
};
