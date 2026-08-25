import http from "node:http";
import { server as wisp } from "@mercuryworkshop/wisp-js/server";

const PORT = Number(process.env.PORT || 5001);
const HOST = process.env.HOST || "127.0.0.1";
const ALLOWED_ORIGINS = new Set(
	(process.env.ALLOWED_ORIGINS ||
		"https://gradeviewer.org,https://www.gradeviewer.org,http://localhost:4321,http://127.0.0.1:4321")
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean),
);

wisp.options.wisp_version = 1;
wisp.options.port_whitelist = [443];
wisp.options.allow_udp_streams = false;
wisp.options.allow_direct_ip = false;
wisp.options.allow_private_ips = false;
wisp.options.allow_loopback_ips = false;
wisp.options.hostname_whitelist = [/\.edupoint\.com$/i];

const server = http.createServer((_request, response) => {
	response.writeHead(200, { "Content-Type": "text/plain" });
	response.end("ok\n");
});

server.on("upgrade", (request, socket, head) => {
	const path = request.url?.split("?")[0] ?? "";
	const origin = request.headers.origin ?? "";
	if ((path !== "/wisp" && path !== "/wisp/") || !ALLOWED_ORIGINS.has(origin)) {
		socket.destroy();
		return;
	}
	wisp.routeRequest(request, socket, head);
});

server.listen(PORT, HOST, () => {
	console.log(`wisp relay listening on ${HOST}:${PORT}`);
});
