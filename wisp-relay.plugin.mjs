import { server as wisp } from "@mercuryworkshop/wisp-js/server";

function attachWisp(httpServer) {
	if (!httpServer || httpServer.__gradeViewerWisp) return;
	httpServer.__gradeViewerWisp = true;
	wisp.options.wisp_version = 1;
	wisp.options.port_whitelist = [443];
	wisp.options.allow_udp_streams = false;
	wisp.options.allow_direct_ip = false;
	wisp.options.allow_private_ips = false;
	wisp.options.allow_loopback_ips = false;
	wisp.options.hostname_whitelist = [/\.edupoint\.com$/i];

	httpServer.on("upgrade", (req, socket, head) => {
		const path = req.url?.split("?")[0] ?? "";
		if (path === "/wisp" || path === "/wisp/") {
			wisp.routeRequest(req, socket, head);
		}
	});
}

/** Local Wisp relay for browser StudentVUE traffic during `astro dev` / `astro preview`. */
export function wispRelay() {
	return {
		name: "studentvue-wisp-relay",
		configureServer(server) {
			return () => attachWisp(server.httpServer);
		},
		configurePreviewServer(server) {
			return () => attachWisp(server.httpServer);
		},
	};
}
