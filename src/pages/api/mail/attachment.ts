import type { APIRoute } from "astro";
import { clearAuth, credentialsFromBody, readJsonBody } from "../../../lib/auth";
import { getMailAttachment, StudentVueError } from "../../../lib/studentvue";

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function downloadName(fileName: string): string {
	const base = fileName.replace(/["\\]/g, "").replace(/[^\w.\- ()]+/g, "_").trim() || "attachment";
	return base;
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
	const smAttachmentGU =
		body && typeof body === "object" && "smAttachmentGU" in body
			? String((body as { smAttachmentGU?: unknown }).smAttachmentGU ?? "").trim()
			: "";

	try {
		if (!creds?.accessToken) {
			console.warn("mail_attachment.unauthorized", { ms: Date.now() - started });
			return json({ error: "Session expired" }, 401);
		}
		if (!smAttachmentGU) {
			return json({ error: "Attachment is required." }, 400);
		}

		const file = await getMailAttachment(creds, smAttachmentGU);
		console.log("mail_attachment.ok", {
			bytes: file.bytes.byteLength,
			ms: Date.now() - started,
		});
		return new Response(Buffer.from(file.bytes), {
			headers: {
				"Content-Type": file.mimeType || "application/octet-stream",
				"Content-Disposition": `inline; filename="${downloadName(file.fileName)}"`,
				"Cache-Control": "no-store",
			},
		});
	} catch (error) {
		if (error instanceof StudentVueError && error.unauthorized) {
			console.warn("mail_attachment.expired", { ms: Date.now() - started });
			return json({ error: "Session expired" }, 401);
		}
		console.error("mail_attachment.unhandled", {
			ms: Date.now() - started,
			error: error instanceof Error ? error.stack || error.message : error,
		});
		return json(
			{ error: error instanceof Error ? error.message : "Could not load the attachment." },
			error instanceof StudentVueError ? 502 : 500,
		);
	}
};
