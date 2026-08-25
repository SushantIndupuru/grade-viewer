/**
 * One-shot: copy logins (email, name, last_login_at) → login_users (email_hash, last_signed_in).
 *
 *   node --env-file=.env.local scripts/migrate-logins.mjs
 *
 * Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUBLIC_LOGIN_HASH_PEPPER.
 * Create the destination table first if needed:
 *
 *   create table if not exists login_users (
 *     email_hash text primary key,
 *     last_signed_in timestamptz not null
 *   );
 */
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = (process.env.SUPABASE_URL ?? "").trim();
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
const pepper = (process.env.PUBLIC_LOGIN_HASH_PEPPER ?? process.env.LOGIN_HASH_PEPPER ?? "").trim();

if (!url || !key || !pepper) {
	console.error("Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and PUBLIC_LOGIN_HASH_PEPPER.");
	process.exit(1);
}

function hashEmail(email) {
	const normalized = email.trim().toLowerCase();
	if (!normalized.includes("@")) return null;
	return createHmac("sha256", pepper).update(normalized).digest("hex");
}

const supabase = createClient(url, key, {
	auth: { persistSession: false, autoRefreshToken: false },
});

const { data: rows, error: readError } = await supabase
	.from("logins")
	.select("email, last_login_at");

if (readError) {
	console.error("Could not read logins:", readError.message);
	process.exit(1);
}

let migrated = 0;
let skipped = 0;
const byHash = new Map();

for (const row of rows ?? []) {
	const emailHash = hashEmail(String(row.email ?? ""));
	if (!emailHash) {
		skipped += 1;
		continue;
	}
	const signedIn = row.last_login_at ? new Date(row.last_login_at).toISOString() : new Date().toISOString();
	const previous = byHash.get(emailHash);
	if (!previous || new Date(signedIn) > new Date(previous)) {
		byHash.set(emailHash, signedIn);
	}
}

const payload = [...byHash.entries()].map(([email_hash, last_signed_in]) => ({
	email_hash,
	last_signed_in,
}));

if (payload.length) {
	const { error: writeError } = await supabase.from("login_users").upsert(payload, {
		onConflict: "email_hash",
	});
	if (writeError) {
		console.error("Could not write login_users:", writeError.message);
		process.exit(1);
	}
	migrated = payload.length;
}

console.log(`Migrated ${migrated} unique hashed emails (${skipped} rows skipped, no @ email).`);
console.log("After you verify counts, you can drop the old table:");
console.log("  drop table logins;");
