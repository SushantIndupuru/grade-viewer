import type { APIRoute } from "astro";
import { clearAuth, credentialsFromBody, readJsonBody } from "../../../lib/auth";
import { getDocumentContent, StudentVueError } from "../../../lib/studentvue";

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function downloadName(fileName: string): string {
	const base = fileName.replace(/["\\]/g, "").replace(/[^\w.\- ()]+/g, "_").trim() || "document.pdf";
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
	const documentGU =
		body && typeof body === "object" && "documentGU" in body
			? String((body as { documentGU?: unknown }).documentGU ?? "").trim()
			: "";

	try {
		if (!creds?.accessToken) {
			console.warn("document_content.unauthorized", { ms: Date.now() - started });
			return json({ error: "Session expired" }, 401);
		}
		if (!documentGU) {
			return json({ error: "Document is required." }, 400);
		}

		const file = await getDocumentContent(creds, documentGU);
		console.log("document_content.ok", {
			bytes: file.bytes.byteLength,
			ms: Date.now() - started,
		});
		return new Response(Buffer.from(file.bytes), {
			headers: {
				"Content-Type": file.mimeType || "application/pdf",
				"Content-Disposition": `inline; filename="${downloadName(file.fileName)}"`,
				"Cache-Control": "no-store",
			},
		});
	} catch (error) {
		if (error instanceof StudentVueError && error.unauthorized) {
			console.warn("document_content.expired", { ms: Date.now() - started });
			return json({ error: "Session expired" }, 401);
		}
		console.error("document_content.unhandled", {
			ms: Date.now() - started,
			error: error instanceof Error ? error.stack || error.message : error,
		});
		return json(
			{ error: error instanceof Error ? error.message : "Could not load the document." },
			error instanceof StudentVueError ? 502 : 500,
		);
	}
};
