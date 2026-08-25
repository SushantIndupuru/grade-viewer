/**
 * Browser + server HMAC-SHA256 of a normalized email.
 * Pepper is public (PUBLIC_LOGIN_HASH_PEPPER) so hashing can stay on-device.
 */
function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

function requirePepper(): string {
	const pepper = (import.meta.env.PUBLIC_LOGIN_HASH_PEPPER ?? "").trim();
	if (!pepper) {
		throw new Error("PUBLIC_LOGIN_HASH_PEPPER is required for usage tracking.");
	}
	return pepper;
}

function bytesToHex(bytes: ArrayBuffer): string {
	return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashLoginEmail(email: string): Promise<string> {
	const normalized = normalizeEmail(email);
	if (!normalized || !normalized.includes("@")) {
		throw new Error("A sign-in email is required for usage tracking.");
	}
	const pepper = requirePepper();
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(pepper),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(normalized));
	return bytesToHex(signature);
}

export function isLoginEmailHash(value: string): boolean {
	return /^[a-f0-9]{64}$/.test(value);
}
