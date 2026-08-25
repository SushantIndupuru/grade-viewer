export type StudentVueTransportMode = "libcurl";

export interface StudentVueTransportConfig {
	mode: StudentVueTransportMode;
	wispUrl?: string;
}

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

type WorkerResponse = {
	id: number;
	status: number;
	statusText: string;
	headers: [string, string][];
	body: ArrayBuffer;
};

type WorkerFailure = { id: number; error: string };
type WorkerConfigured = { type: "configured" };
type WorkerConfigurationFailure = { type: "configuration-error"; error: string };

function describeWorkerFailure(message: string): string {
	if (/wasm|abort|memory|out of bounds/i.test(message)) {
		return "StudentVUE transport worker stopped while processing the public response.";
	}
	return "StudentVUE transport worker failed.";
}

function isLocalHostname(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function validateWispUrl(value: string): URL {
	const url = new URL(value);
	if (url.protocol === "wss:") {
		if (!url.pathname.endsWith("/")) url.pathname += "/";
		return url;
	}
	if (url.protocol === "ws:" && isLocalHostname(url.hostname)) {
		if (!url.pathname.endsWith("/")) url.pathname += "/";
		return url;
	}
	throw new Error("PUBLIC_WISP_URL must use wss:.");
}

function resolveWispUrl(): string {
	const configured = (import.meta.env.PUBLIC_WISP_URL ?? "").trim();
	if (configured) return validateWispUrl(configured).href;
	if (import.meta.env.DEV && typeof location !== "undefined") {
		const url = new URL("/wisp/", location.href);
		url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
		return url.href;
	}
	throw new Error("PUBLIC_WISP_URL is required in production (astro dev serves /wisp/ locally).");
}

export function getStudentVueTransportConfig(): StudentVueTransportConfig {
	return { mode: "libcurl", wispUrl: resolveWispUrl() };
}

function serializeInit(init: RequestInit): WorkerRequest["init"] {
	const headers = [...new Headers(init.headers)];
	let body: string | ArrayBuffer | undefined;
	if (typeof init.body === "string") body = init.body;
	else if (init.body instanceof ArrayBuffer) body = init.body;
	else if (ArrayBuffer.isView(init.body)) {
		body = init.body.buffer.slice(
			init.body.byteOffset,
			init.body.byteOffset + init.body.byteLength,
		);
	} else if (init.body instanceof URLSearchParams) body = init.body.toString();
	else if (init.body) {
		throw new Error("Browser rejected the transport request configuration.");
	}
	return {
		method: init.method,
		headers,
		body,
		redirect: init.redirect,
		credentials: init.credentials,
	};
}

export class StudentVueTransport {
	private static readonly SETUP_TIMEOUT_MS = 20_000;
	private worker?: Worker;
	private workerSetup?: Promise<void>;
	private resolveWorkerSetup?: () => void;
	private rejectWorkerSetup?: (reason: Error) => void;
	private nextId = 0;
	private pending = new Map<
		number,
		{ resolve: (response: Response) => void; reject: (reason: Error) => void }
	>();

	constructor(private readonly config = getStudentVueTransportConfig()) {}

	async fetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
		if (typeof window === "undefined") {
			throw new Error("StudentVUE transport is browser-only and cannot run on the server.");
		}
		if (this.config.mode !== "libcurl") return fetch(input, init);
		const url = String(input);
		await this.waitForWorkerSetup();
		return this.fetchWithWorker(url, init);
	}

	close(): void {
		for (const { reject } of this.pending.values()) {
			reject(new Error("StudentVUE transport closed."));
		}
		this.pending.clear();
		this.worker?.postMessage({ type: "close" });
		this.worker?.terminate();
		this.worker = undefined;
		this.rejectWorkerSetup?.(new Error("StudentVUE transport closed."));
		this.workerSetup = undefined;
		this.resolveWorkerSetup = undefined;
		this.rejectWorkerSetup = undefined;
	}

	private fetchWithWorker(url: string, init: RequestInit): Promise<Response> {
		const worker = this.getWorker();
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const pending = { resolve, reject };
			this.pending.set(id, pending);
			if (init.signal) {
				if (init.signal.aborted) {
					this.pending.delete(id);
					reject(init.signal.reason instanceof Error ? init.signal.reason : new Error("Aborted"));
					return;
				}
				init.signal.addEventListener(
					"abort",
					() => {
						if (!this.pending.delete(id)) return;
						reject(init.signal?.reason instanceof Error ? init.signal.reason : new Error("Aborted"));
					},
					{ once: true },
				);
			}
			worker.postMessage({ id, url, init: serializeInit(init) } satisfies WorkerRequest);
		});
	}

	private getWorker(): Worker {
		if (this.worker) return this.worker;
		const worker = new Worker(new URL("./transport.worker.ts", import.meta.url), {
			type: "module",
		});
		this.workerSetup = new Promise<void>((resolve, reject) => {
			this.resolveWorkerSetup = resolve;
			this.rejectWorkerSetup = reject;
		});
		worker.onmessage = ({
			data,
		}: MessageEvent<WorkerResponse | WorkerFailure | WorkerConfigured | WorkerConfigurationFailure>) => {
			if ("type" in data && data.type === "configured") {
				this.resolveWorkerSetup?.();
				return;
			}
			if ("type" in data && data.type === "configuration-error") {
				this.rejectWorkerSetup?.(new Error(data.error));
				return;
			}
			const pending = this.pending.get(data.id);
			if (!pending) return;
			this.pending.delete(data.id);
			if ("error" in data) {
				pending.reject(new Error(data.error));
				return;
			}
			try {
				pending.resolve(
					new Response(data.body, {
						status: data.status,
						statusText: data.statusText,
						headers: data.headers,
					}),
				);
			} catch {
				pending.reject(
					new Error("StudentVUE response could not be safely represented in the browser."),
				);
			}
		};
		worker.onerror = (event) => {
			const error = new Error(describeWorkerFailure(event.message));
			this.rejectWorkerSetup?.(error);
			for (const { reject } of this.pending.values()) reject(error);
			this.pending.clear();
		};
		if (!this.config.wispUrl) {
			throw new Error("PUBLIC_WISP_URL is required in production (astro dev serves /wisp/ locally).");
		}
		worker.postMessage({ type: "configure", wispUrl: this.config.wispUrl });
		this.worker = worker;
		return worker;
	}

	private waitForWorkerSetup(): Promise<void> {
		this.getWorker();
		const setup = this.workerSetup ?? Promise.reject(new Error("Browser transport could not start."));
		return Promise.race([
			setup,
			new Promise<never>((_resolve, reject) => {
				window.setTimeout(
					() => reject(new Error("Browser transport startup timed out.")),
					StudentVueTransport.SETUP_TIMEOUT_MS,
				);
			}),
		]);
	}
}

let transport: StudentVueTransport | undefined;

export function getStudentVueTransport(): StudentVueTransport {
	transport ??= new StudentVueTransport();
	return transport;
}

export function closeStudentVueTransport(): void {
	transport?.close();
	transport = undefined;
}
