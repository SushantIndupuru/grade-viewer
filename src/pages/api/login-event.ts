import type { APIRoute } from "astro";

export const POST: APIRoute = async () => {
	return new Response(JSON.stringify({ error: "Grade Viewer is no longer available." }), {
		status: 410,
		headers: { "Content-Type": "application/json" },
	});
};
