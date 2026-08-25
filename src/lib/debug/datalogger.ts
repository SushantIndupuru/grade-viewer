/**
 * Optional debug login recorder. Loaded only when this file is present at build
 * time; omit it (any environment, including prod) and nothing is recorded.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

function getClient(): SupabaseClient | null {
	if (client !== undefined) return client;
	const url = import.meta.env.SUPABASE_URL || process.env.SUPABASE_URL;
	const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
	client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
	if (!client) {
		console.warn("Supabase is not configured; login records will be skipped.");
	}
	return client;
}

export async function recordLogin(user: { name: string; email: string }): Promise<void> {
	const email = user.email.trim();
	if (!email) return;

	try {
		const supabase = getClient();
		if (!supabase) return;

		const now = new Date().toISOString();
		const { data, error: updateError } = await supabase
			.from("logins")
			.update({ last_login_at: now })
			.eq("email", email)
			.select("email");

		if (updateError) {
			console.error("Could not update login time:", updateError.message);
			return;
		}
		if (data && data.length > 0) return;

		const { error: insertError } = await supabase.from("logins").insert({
			name: user.name.trim() || email,
			email,
			last_login_at: now,
		});
		if (insertError) {
			if (insertError.code === "23505") {
				const { error: retryError } = await supabase
					.from("logins")
					.update({ last_login_at: now })
					.eq("email", email);
				if (retryError) console.error("Could not update login time:", retryError.message);
				return;
			}
			console.error("Could not record login:", insertError.message);
		}
	} catch (error) {
		console.error("Could not record login:", error);
	}
}
