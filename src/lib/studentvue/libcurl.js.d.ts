declare module "libcurl.js/bundled" {
	// The package ships an untyped WebAssembly bridge; its dynamic API is isolated in the worker.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	export const libcurl: any;
}
