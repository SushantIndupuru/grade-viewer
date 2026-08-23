import { icons } from "./icons";
import { spinnerHtml } from "./grades-list";

export interface PreviewSource {
	blob: Blob;
	fileName: string;
	mimeType?: string;
}

interface PreviewOptions {
	title: string;
	load: () => Promise<PreviewSource>;
}

let overlay: HTMLElement | null = null;
let objectUrl: string | null = null;
let previousOverflow = "";

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function fileNameFromResponse(response: Response, fallback: string): string {
	const header = response.headers.get("Content-Disposition") ?? "";
	const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
	if (encoded?.[1]) {
		try {
			return decodeURIComponent(encoded[1]).trim() || fallback;
		} catch {
			// Fall through to the plain filename.
		}
	}
	const quoted = header.match(/filename="([^"]+)"/i);
	if (quoted?.[1]) return quoted[1].trim() || fallback;
	const plain = header.match(/filename=([^;]+)/i);
	if (plain?.[1]) return plain[1].trim().replace(/^["']|["']$/g, "") || fallback;
	return fallback;
}

function mimeTypeOf(source: PreviewSource): string {
	return (source.mimeType || source.blob.type || "application/octet-stream").split(";")[0].trim().toLowerCase();
}

function isPdf(mime: string, fileName: string): boolean {
	return mime === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");
}

function isImage(mime: string, fileName: string): boolean {
	if (mime.startsWith("image/") && mime !== "image/svg+xml") return true;
	return /\.(png|jpe?g|gif|webp|bmp)$/i.test(fileName);
}

function previewBody(source: PreviewSource, url: string): string {
	const mime = mimeTypeOf(source);
	if (isPdf(mime, source.fileName)) {
		return `<iframe class="h-full w-full border-0 bg-white" title="${escapeHtml(source.fileName)}" src="${escapeHtml(url)}"></iframe>`;
	}
	if (isImage(mime, source.fileName)) {
		return `<img class="max-h-full max-w-full object-contain" alt="${escapeHtml(source.fileName)}" src="${escapeHtml(url)}" />`;
	}
	return `<div class="max-w-sm px-4 text-center text-white">
		<p class="text-sm font-medium">${escapeHtml(source.fileName)}</p>
		<p class="mt-2 text-sm text-white/70">This file type can’t be previewed here. Download it to open it.</p>
	</div>`;
}

function closePreview(): void {
	if (objectUrl) {
		URL.revokeObjectURL(objectUrl);
		objectUrl = null;
	}
	overlay?.remove();
	overlay = null;
	document.body.style.overflow = previousOverflow;
	document.removeEventListener("keydown", onKeyDown);
}

function onKeyDown(event: KeyboardEvent): void {
	if (event.key === "Escape") {
		event.preventDefault();
		closePreview();
	}
}

function mountOverlay(title: string): HTMLElement {
	closePreview();
	previousOverflow = document.body.style.overflow;
	document.body.style.overflow = "hidden";
	const node = document.createElement("div");
	node.className = "fixed inset-0 z-50 flex flex-col bg-neutral-950/90";
	node.setAttribute("role", "dialog");
	node.setAttribute("aria-modal", "true");
	node.setAttribute("aria-label", title);
	node.innerHTML = `
		<div class="flex h-12 shrink-0 items-center gap-2 px-2 text-white">
			<button class="inline-flex size-9 cursor-pointer items-center justify-center rounded hover:bg-white/10" type="button" data-preview-close aria-label="Close">
				${icons.x("h-5 w-5")}
			</button>
			<p class="min-w-0 flex-1 truncate text-sm font-medium" data-preview-title>${escapeHtml(title)}</p>
			<button class="hidden h-9 cursor-pointer items-center gap-1.5 rounded px-2.5 text-sm hover:bg-white/10" type="button" data-preview-download>
				${icons.download("h-4 w-4")}
				Download
			</button>
		</div>
		<div class="flex min-h-0 flex-1 items-center justify-center p-3" data-preview-stage>
			<p class="inline-flex items-center gap-2 text-sm text-white/80" role="status" aria-live="polite">
				${spinnerHtml("h-4 w-4")}
				Loading preview…
			</p>
		</div>`;
	node.querySelector("[data-preview-close]")?.addEventListener("click", () => closePreview());
	node.addEventListener("click", (event) => {
		if (event.target === node) closePreview();
	});
	document.addEventListener("keydown", onKeyDown);
	document.body.append(node);
	overlay = node;
	(node.querySelector("[data-preview-close]") as HTMLButtonElement | null)?.focus();
	return node;
}

function enableDownload(node: HTMLElement, source: PreviewSource, url: string): void {
	if (isPdf(mimeTypeOf(source), source.fileName)) return;
	const button = node.querySelector<HTMLButtonElement>("[data-preview-download]");
	if (!button) return;
	button.classList.remove("hidden");
	button.classList.add("inline-flex");
	button.addEventListener("click", () => {
		const link = document.createElement("a");
		link.href = url;
		link.download = source.fileName || "download";
		link.rel = "noopener";
		node.append(link);
		link.click();
		link.remove();
	});
}

export function openFilePreview(options: PreviewOptions): void {
	const node = mountOverlay(options.title);
	const stage = node.querySelector("[data-preview-stage]");
	void options
		.load()
		.then((source) => {
			if (overlay !== node) return;
			const blob =
				source.blob.type && source.blob.type !== "application/octet-stream"
					? source.blob
					: new Blob([source.blob], { type: source.mimeType || "application/pdf" });
			const next: PreviewSource = {
				blob,
				fileName: source.fileName || "download",
				mimeType: blob.type,
			};
			objectUrl = URL.createObjectURL(blob);
			if (stage instanceof HTMLElement) {
				const mime = mimeTypeOf(next);
				stage.className = isPdf(mime, next.fileName)
					? "min-h-0 flex-1 bg-white"
					: "flex min-h-0 flex-1 items-center justify-center p-3";
				stage.innerHTML = previewBody(next, objectUrl);
			}
			enableDownload(node, next, objectUrl);
		})
		.catch((error) => {
			if (overlay !== node) return;
			const message = error instanceof Error ? error.message : "Could not open the file.";
			if (stage) {
				stage.innerHTML = `<p class="max-w-sm px-4 text-center text-sm text-white">${escapeHtml(message)}</p>`;
			}
		});
}
