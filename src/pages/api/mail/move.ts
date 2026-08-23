import type { APIRoute } from "astro";
import { clearAuth, credentialsFromBody, readJsonBody } from "../../../lib/auth";
import { folderTypeForName } from "../../../lib/mail-folders";
import { moveCachedMail } from "../../../lib/mail-cache";
import { moveMail, StudentVueError } from "../../../lib/studentvue";

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
	const fromFolder = String(record.fromFolder ?? "Inbox").trim() || "Inbox";
	const toFolder = String(record.toFolder ?? "").trim();
	const folderType = String(record.folderType ?? "").trim() || folderTypeForName(toFolder);
	const smFolderGU = String(record.smFolderGU ?? "").trim();

	try {
		if (!creds?.accessToken) {
			console.warn("mail_move.unauthorized", { ms: Date.now() - started });
			return json({ error: "Session expired" }, 401);
		}
		if (!smMessagePersonGU) {
			return json({ error: "Message is required." }, 400);
		}
		if (!toFolder) {
			return json({ error: "Folder is required." }, 400);
		}
		if (!folderType && !smFolderGU) {
			return json({ error: "Unknown mail folder." }, 400);
		}

		await moveMail(creds, smMessagePersonGU, { folderType: folderType || "0", smFolderGU });
		if (messageId) moveCachedMail(creds.username, fromFolder, toFolder, messageId);
		console.log("mail_move.ok", { fromFolder, toFolder, ms: Date.now() - started });
		return json({ ok: true });
	} catch (error) {
		if (error instanceof StudentVueError && error.unauthorized) {
			console.warn("mail_move.expired", { ms: Date.now() - started });
			return json({ error: "Session expired" }, 401);
		}
		console.error("mail_move.unhandled", {
			ms: Date.now() - started,
			error: error instanceof Error ? error.stack || error.message : error,
		});
		return json(
			{ error: error instanceof Error ? error.message : "Could not move the message." },
			error instanceof StudentVueError ? 502 : 500,
		);
	}
};
