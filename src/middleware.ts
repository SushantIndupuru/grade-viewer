import { defineMiddleware } from "astro:middleware";
import { clearAuth } from "./lib/auth";

export const onRequest = defineMiddleware(({ cookies }, next) => {
	clearAuth(cookies);
	return next();
});
