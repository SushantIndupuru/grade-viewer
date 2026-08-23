import type { APIRoute } from "astro";
import { clearAuth } from "../../lib/auth";

export const POST: APIRoute = async ({ cookies }) => {
	clearAuth(cookies);
	return new Response(null, { status: 204 });
};
