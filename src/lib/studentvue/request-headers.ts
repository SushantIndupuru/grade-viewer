// libcurl, rather than browser fetch(), sends these headers inside the
// end-to-end StudentVUE TLS connection. Keep protocol headers such as Cookie,
// Referer, and User-Agent while rejecting connection-level/browser metadata.
const BLOCKED_REQUEST_HEADERS = new Set([
	"accept-charset",
	"accept-encoding",
	"access-control-request-headers",
	"access-control-request-method",
	"connection",
	"content-length",
	"cookie2",
	"date",
	"dnt",
	"expect",
	"host",
	"keep-alive",
	"origin",
	"set-cookie",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"via",
]);

export function studentVueRequestHeaders(
	entries: [string, string][] | undefined,
): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const [name, value] of entries ?? []) {
		const key = name.toLowerCase();
		if (BLOCKED_REQUEST_HEADERS.has(key) || key.startsWith("proxy-") || key.startsWith("sec-")) {
			continue;
		}
		headers[name] = value;
	}
	return headers;
}
