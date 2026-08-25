import { createClient } from "@supabase/supabase-js";
import { isLoginEmailHash } from "./login-hash";

/**
 * Stores a client-computed email HMAC plus last sign-in time.
 * Plain email never needs to reach this module.
 */
const TABLE = "login_users";

function requireEnv(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
	const value = (import.meta.env[name] ?? "").trim();
	if (!value) {
		throw new Error(`${name} is required for sign-in usage tracking.`);
	}
	return value;
}

export async function recordLoginHash(emailHash: string): Promise<void> {
	const hash = emailHash.trim().toLowerCase();
	if (!isLoginEmailHash(hash)) {
		throw new Error("Invalid login email hash.");
	}

	const supabase = createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const { error } = await supabase.from(TABLE).upsert(
		{ email_hash: hash, last_signed_in: new Date().toISOString() },
		{ onConflict: "email_hash" },
	);
	if (error) {
		throw new Error(`Could not record login event: ${error.message}`);
	}
}
