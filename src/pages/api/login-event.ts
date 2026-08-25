import type { APIRoute } from "astro";
import { recordLoginHash } from "../../lib/datalogger";
import { readJsonBody } from "../../lib/auth";

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export const POST: APIRoute = async ({ request }) => {
	const body = await readJsonBody(request);
	const emailHash =
		body && typeof body === "object" && "emailHash" in body
			? String((body as { emailHash?: unknown }).emailHash ?? "").trim()
			: "";

	if (!emailHash) {
		return json({ error: "A login email hash is required." }, 400);
	}

	try {
		await recordLoginHash(emailHash);
		return json({ ok: true });
	} catch (error) {
		console.error("login-event.unhandled", error);
		return json(
			{ error: error instanceof Error ? error.message : "Could not record login." },
			503,
		);
	}
};
