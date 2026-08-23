import type { APIRoute } from "astro";
import { login, StudentVueError, normalizeDistrictUrl } from "../../lib/studentvue";
import { clearAuth, readJsonBody } from "../../lib/auth";
import { defaultDistrictUrl } from "../../lib/config";
import { recordLogin } from "../../lib/datalogger";

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

async function readLogin(request: Request): Promise<{
	username: string;
	password: string;
	districtUrl: string;
}> {
	const contentType = request.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		const body = await readJsonBody(request);
		const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
		const nested = raw.creds && typeof raw.creds === "object" ? (raw.creds as Record<string, unknown>) : raw;
		return {
			username: String(nested.username ?? "").trim(),
			password: String(nested.password ?? ""),
			districtUrl: String(nested.districtUrl ?? ""),
		};
	}

	const form = await request.formData();
	return {
		username: String(form.get("username") ?? "").trim(),
		password: String(form.get("password") ?? ""),
		districtUrl: String(form.get("districtUrl") ?? ""),
	};
}

export const POST: APIRoute = async ({ request, cookies }) => {
	clearAuth(cookies);
	const input = await readLogin(request);
	const username = input.username.trim();
	const password = input.password;
	const districtInput = input.districtUrl.trim() || defaultDistrictUrl();

	if (!username || !password) {
		return json({ error: "Username and password are required." }, 400);
	}
	if (!districtInput) {
		return json({ error: "District URL is required." }, 400);
	}

	const districtUrl = normalizeDistrictUrl(districtInput);

	try {
		const { student, creds } = await login({ username, password, districtUrl });
		await recordLogin({ name: student.name, email: student.email });
		return json({
			student,
			districtUrl,
			accessToken: creds.accessToken,
			refreshToken: creds.refreshToken ?? "",
		});
	} catch (error) {
		const message =
			error instanceof StudentVueError
				? error.message
				: "Could not reach StudentVUE. Check the district URL and try again.";
		const status = error instanceof StudentVueError && error.unauthorized ? 401 : 502;
		return json({ error: message }, status);
	}
};
