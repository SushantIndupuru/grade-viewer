import {
	resolveStudentVueTransportMode,
	resolveWispUrl,
	type StudentVueTransportConfig,
} from "./config";

export {
	resolveStudentVueTransportMode,
	resolveWispUrl,
	validateWispUrl,
} from "./config";
export type { StudentVueTransportConfig, StudentVueTransportMode } from "./config";

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

type PendingRequest = {
	resolve: (response: Response) => void;
	reject: (reason: Error) => void;
	cleanup: () => void;
};

function describeWorkerFailure(message: string): string {
	if (/wasm|abort|memory|out of bounds/i.test(message)) {
		return "StudentVUE transport worker stopped unexpectedly.";
	}
	return "StudentVUE transport worker failed.";
}

export function getStudentVueTransportConfig(): StudentVueTransportConfig {
	return {
		mode: resolveStudentVueTransportMode(import.meta.env.PUBLIC_STUDENTVUE_TRANSPORT),
		wispUrl: resolveWispUrl(
			import.meta.env.PUBLIC_WISP_URL_2,
			import.meta.env.DEV,
			typeof location === "undefined" ? undefined : location.href,
		),
	};
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
	private workerSetupTimer?: ReturnType<typeof setTimeout>;
	private nextId = 0;
	private pending = new Map<number, PendingRequest>();

	constructor(private readonly config = getStudentVueTransportConfig()) {}

	async fetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
		if (typeof window === "undefined") {
			throw new Error("StudentVUE transport is browser-only and cannot run on the server.");
		}
		const url = String(input);
		await this.waitForWorkerSetup();
		return this.fetchWithWorker(url, init);
	}

	close(): void {
		const worker = this.worker;
		worker?.postMessage({ type: "close" });
		this.failWorker(new Error("StudentVUE transport closed."), worker);
	}

	private fetchWithWorker(url: string, init: RequestInit): Promise<Response> {
		const worker = this.getWorker();
		const id = this.nextId++;
		const serialized = serializeInit(init);
		return new Promise((resolve, reject) => {
			let abortListener: (() => void) | undefined;
			const cleanup = () => {
				if (abortListener) init.signal?.removeEventListener("abort", abortListener);
			};
			const pending = { resolve, reject, cleanup };
			this.pending.set(id, pending);
			if (init.signal) {
				if (init.signal.aborted) {
					this.pending.delete(id);
					cleanup();
					reject(init.signal.reason instanceof Error ? init.signal.reason : new Error("Aborted"));
					return;
				}
				abortListener = () => {
					if (!this.pending.delete(id)) return;
					cleanup();
					reject(init.signal?.reason instanceof Error ? init.signal.reason : new Error("Aborted"));
					// libcurl.js cannot reliably cancel an in-flight WASM request. Terminating
					// the worker prevents a timed-out request from poisoning the next login.
					this.failWorker(new Error("StudentVUE connection timed out."), worker);
				};
				init.signal.addEventListener(
					"abort",
					abortListener,
					{ once: true },
				);
			}
			try {
				worker.postMessage({ id, url, init: serialized } satisfies WorkerRequest);
			} catch {
				this.pending.delete(id);
				cleanup();
				const error = new Error("Browser rejected the transport request configuration.");
				reject(error);
				this.failWorker(error, worker);
			}
		});
	}

	private failWorker(error: Error, worker = this.worker): void {
		if (worker && this.worker && worker !== this.worker) return;
		if (this.workerSetupTimer) clearTimeout(this.workerSetupTimer);
		this.workerSetupTimer = undefined;
		worker?.terminate();
		this.worker = undefined;
		this.rejectWorkerSetup?.(error);
		this.workerSetup = undefined;
		this.resolveWorkerSetup = undefined;
		this.rejectWorkerSetup = undefined;
		for (const pending of this.pending.values()) {
			pending.cleanup();
			pending.reject(error);
		}
		this.pending.clear();
	}

	private getWorker(): Worker {
		if (this.worker) return this.worker;
		if (!this.config.wispUrl) {
			throw new Error("PUBLIC_WISP_URL_2 is required in production (astro dev serves /wisp/ locally).");
		}
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
				if (worker !== this.worker) return;
				if (this.workerSetupTimer) clearTimeout(this.workerSetupTimer);
				this.workerSetupTimer = undefined;
				this.resolveWorkerSetup?.();
				return;
			}
			if ("type" in data && data.type === "configuration-error") {
				this.failWorker(new Error(data.error), worker);
				return;
			}
			const pending = this.pending.get(data.id);
			if (!pending) return;
			this.pending.delete(data.id);
			pending.cleanup();
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
			this.failWorker(error, worker);
			event.preventDefault();
		};
		worker.onmessageerror = () => {
			this.failWorker(new Error("StudentVUE transport worker returned an invalid message."), worker);
		};
		this.worker = worker;
		this.workerSetupTimer = setTimeout(() => {
			this.failWorker(new Error("StudentVUE connection timed out."), worker);
		}, StudentVueTransport.SETUP_TIMEOUT_MS);
		try {
			worker.postMessage({ type: "configure", wispUrl: this.config.wispUrl });
		} catch {
			const error = new Error("Browser transport could not start.");
			this.failWorker(error, worker);
			throw error;
		}
		return worker;
	}

	private waitForWorkerSetup(): Promise<void> {
		this.getWorker();
		return this.workerSetup ?? Promise.reject(new Error("Browser transport could not start."));
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
