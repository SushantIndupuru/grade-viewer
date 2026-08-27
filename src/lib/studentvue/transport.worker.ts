import { libcurl } from "libcurl.js/bundled";
import { studentVueRequestHeaders } from "./request-headers";

let session:
	| { close(): void; fetch(url: string, init: RequestInit): Promise<Response> }
	| undefined;
let ready: Promise<void> | undefined;
let lockedHost: string | undefined;
let activeRequestId: number | undefined;

const LIBCURL_COOKIE_FLUSH_DELAY_MS = 5;

type WorkerRequest = {
	id: number;
	url: string;
	init: {
		method?: string;
		headers?: [string, string][];
		body?: string | ArrayBuffer;
		redirect?: RequestRedirect;
		credentials?: RequestCredentials;
	};
};

function waitForLibcurlCookieFlush(): Promise<void> {
	// libcurl.js 0.7.1 defers curl_easy_cleanup by 1 ms. Cleanup writes the
	// response cookies to this HTTPSession's in-memory cookie jar, so another
	// request started immediately after reading the body can miss them.
	return new Promise((resolve) => setTimeout(resolve, LIBCURL_COOKIE_FLUSH_DELAY_MS));
}

function validateStudentVueUrl(value: string): URL {
	const url = new URL(value);
	if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
		throw new Error("StudentVUE requests must use HTTPS on port 443.");
	}
	if (url.username || url.password) {
		throw new Error("StudentVUE host is not approved.");
	}
	if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(url.hostname) || url.hostname.includes("..")) {
		throw new Error(`StudentVUE host is not approved: ${url.hostname}`);
	}
	if (
		/^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|[0-9.]+$)/i.test(url.hostname)
	) {
		throw new Error(`StudentVUE host is not approved: ${url.hostname}`);
	}
	if (!lockedHost) lockedHost = url.hostname.toLowerCase();
	else if (url.hostname.toLowerCase() !== lockedHost) {
		throw new Error(`StudentVUE host is not approved: ${url.hostname}`);
	}
	return url;
}

function reportWorkerFailure(id: number | undefined, message: string): void {
	if (id === undefined) return;
	const error = /wasm|abort|memory|out of bounds/i.test(message)
		? "StudentVUE transport worker stopped while processing the public response."
		: "StudentVUE transport worker failed.";
	self.postMessage({ id, error });
}

function describeRequestFailure(message: string, causeType: string): string {
	if (message.startsWith("StudentVUE ") || message.startsWith("Browser ")) return message;
	if (/invalid binarytype/i.test(message)) {
		return "StudentVUE transport received an unsupported relay frame type.";
	}
	if (/forbidden header|failed to construct ['"]?request/i.test(message)) {
		return "Browser rejected the transport request configuration.";
	}
	if (/redirect/i.test(message)) return "StudentVUE redirect rejected by HTTPS-only diagnostic.";

	const code = message.match(/error code (\d+)/i)?.[1];
	if (code === "7") return "Could not connect to the StudentVUE relay.";
	if (code === "28") return "StudentVUE connection timed out.";
	if (code === "60") return "StudentVUE TLS certificate could not be verified.";
	if (code) return "Encrypted StudentVUE request failed.";
	return `Encrypted StudentVUE request failed (${causeType || "unknown"}).`;
}

self.addEventListener("error", (event) => {
	reportWorkerFailure(activeRequestId, event.message);
	event.preventDefault();
});

self.onmessage = async ({ data }: MessageEvent) => {
	if (data.type === "configure") {
		ready = (async () => {
			libcurl.set_websocket(data.wispUrl);
			await libcurl.load_wasm();
			// Cookies live only in libcurl's in-memory virtual filesystem for this worker session.
			session = new libcurl.HTTPSession({ enable_cookies: true });
		})();
		try {
			await ready;
			self.postMessage({ type: "configured" });
		} catch {
			self.postMessage({
				type: "configuration-error",
				error: "Browser transport could not initialize its encrypted connection worker.",
			});
		}
		return;
	}
	if (data.type === "close") {
		session?.close();
		session = undefined;
		lockedHost = undefined;
		return;
	}

	const request = data as WorkerRequest;
	try {
		activeRequestId = request.id;
		await ready;
		if (!session) throw new Error("StudentVUE transport is not configured.");
		const url = validateStudentVueUrl(request.url).href;
		const init = request.init ?? {};
		const response = await session.fetch(url, {
			method: init.method,
			headers: studentVueRequestHeaders(init.headers),
			body: init.body,
			redirect: init.redirect,
			credentials: init.credentials,
		});
		const body = await response.arrayBuffer();
		await waitForLibcurlCookieFlush();
		// Set-Cookie is a forbidden browser response header. Cookies remain solely
		// in this worker's libcurl session and are never exposed to application code.
		const headers = [...response.headers.entries()].filter(
			([name]) => name.toLowerCase() !== "set-cookie" && name.toLowerCase() !== "set-cookie2",
		);
		// Clone rather than transfer the response buffer: some browser Response
		// implementations expose a WASM-backed buffer that cannot be transferred.
		self.postMessage({
			id: request.id,
			status: response.status,
			statusText: response.statusText,
			headers,
			body,
		});
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : "";
		const causeType =
			cause && typeof cause === "object" && "constructor" in cause
				? (cause as { constructor?: { name?: string } }).constructor?.name
				: typeof cause;
		const error = describeRequestFailure(message, causeType || "unknown");
		self.postMessage({ id: request.id, error });
	} finally {
		activeRequestId = undefined;
	}
};
