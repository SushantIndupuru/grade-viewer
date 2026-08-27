import assert from "node:assert/strict";
import test from "node:test";

import {
	resolveStudentVueAuthMode,
	resolveStudentVueTransportMode,
	resolveWispUrl,
	validateWispUrl,
} from "../src/lib/studentvue/config.ts";
import { studentVueRequestHeaders } from "../src/lib/studentvue/request-headers.ts";

test("uses the configured Heroku relay and preserves its root path", () => {
	assert.equal(
		resolveWispUrl("wss://relay.example.herokuapp.com/", false),
		"wss://relay.example.herokuapp.com/",
	);
});

test("adds the trailing slash required by libcurl.js", () => {
	assert.equal(validateWispUrl("wss://relay.example/wisp").href, "wss://relay.example/wisp/");
});

test("requires PUBLIC_WISP_URL_2 in production", () => {
	assert.throws(() => resolveWispUrl(undefined, false), /PUBLIC_WISP_URL_2 is required/);
});

test("rejects malformed, credentialed, and insecure production relay URLs", () => {
	assert.throws(() => validateWispUrl("not a URL"), /valid absolute WebSocket URL/);
	assert.throws(() => validateWispUrl("wss://user:secret@relay.example/"), /must not contain credentials/);
	assert.throws(() => validateWispUrl("ws://relay.example/"), /must use wss/);
});

test("allows the local development relay over ws", () => {
	assert.equal(
		resolveWispUrl(undefined, true, "http://localhost:4321/login"),
		"ws://localhost:4321/wisp/",
	);
});

test("accepts only the implemented transport and auth modes", () => {
	assert.equal(resolveStudentVueTransportMode("libcurl"), "libcurl");
	assert.equal(resolveStudentVueAuthMode("mobile-rest"), "mobile-rest");
	assert.throws(() => resolveStudentVueTransportMode("fetch"), /must be libcurl/);
	assert.throws(() => resolveStudentVueAuthMode("soap"), /must be mobile-rest/);
});

test("preserves StudentVUE protocol headers but blocks connection metadata", () => {
	assert.deepEqual(
		studentVueRequestHeaders([
			["Cookie", "PVUE=98; AppSupportsSession=1"],
			["User-Agent", "StudentVUE/test"],
			["Referer", "https://district.edupoint.com/"],
			["Authorization", "Basic redacted"],
			["Host", "attacker.example"],
			["Proxy-Authorization", "redacted"],
			["Sec-WebSocket-Key", "redacted"],
		]),
		{
			Cookie: "PVUE=98; AppSupportsSession=1",
			"User-Agent": "StudentVUE/test",
			Referer: "https://district.edupoint.com/",
			Authorization: "Basic redacted",
		},
	);
});
