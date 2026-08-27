import type { Credentials } from "./types";
import { decodeXml, escapeXml, extractInnerXml, soapErrorMessage } from "./xml";

const SOAP_NS = "http://edupoint.com/webservices/";
const SOAP_ACTION = `${SOAP_NS}ProcessWebServiceRequest`;
const USER_AGENT = "StudentVUE/14.1.20 CFNetwork/1498.700.2 Darwin/23.6.0";

export class StudentVueError extends Error {
	readonly status: number;

	constructor(message: string, status = 0) {
		super(message);
		this.name = "StudentVueError";
		this.status = status;
	}

	get unauthorized(): boolean {
		if (this.status === 401 || this.status === 403) return true;
		return /unauthorized|not authenticated|invalid token|session expired/i.test(this.message);
	}
}

const STUDENTVUE_TIMEOUT_MS = 30_000;

async function resolveFetch(): Promise<(input: string, init?: RequestInit) => Promise<Response>> {
	if (import.meta.env.SSR) {
		throw new Error("StudentVUE requests run in the browser only.");
	}
	const { getStudentVueTransport } = await import("./transport");
	const transport = getStudentVueTransport();
	return (input, init) => transport.fetch(input, init);
}

export async function studentVueFetch(url: string, init: RequestInit = {}): Promise<Response> {
	try {
		const run = await resolveFetch();
		return await run(url, {
			...init,
			signal: init.signal ?? AbortSignal.timeout(STUDENTVUE_TIMEOUT_MS),
		});
	} catch (error) {
		if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
			throw new StudentVueError(`StudentVUE timed out after ${STUDENTVUE_TIMEOUT_MS / 1000}s`, 504);
		}
		throw new StudentVueError(
			error instanceof Error ? error.message : "Could not reach StudentVUE",
		);
	}
}

export function normalizeDistrictUrl(input: string): string {
	const trimmed = input.trim();
	const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
	return withProtocol.replace(/\/+$/, "");
}

function soapEnvelope(
	creds: Credentials,
	methodName: string,
	paramStr: string,
): string {
	return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ProcessWebServiceRequest xmlns="${SOAP_NS}">
      <userID>${escapeXml(creds.username)}</userID>
      <password>${escapeXml(creds.password)}</password>
      <skipLoginLog>1</skipLoginLog>
      <parent>0</parent>
      <webServiceHandleName>PXPWebServices</webServiceHandleName>
      <methodName>${escapeXml(methodName)}</methodName>
      <paramStr>${escapeXml(paramStr)}</paramStr>
    </ProcessWebServiceRequest>
  </soap:Body>
</soap:Envelope>`;
}

export async function processRequest(
	creds: Credentials,
	methodName: string,
	paramsXml = "<Parms><ChildIntID>0</ChildIntID></Parms>",
): Promise<string> {
	const url = `${normalizeDistrictUrl(creds.districtUrl)}/Service/PXPCommunication.asmx`;
	const body = soapEnvelope(creds, methodName, paramsXml);

	const response = await studentVueFetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "text/xml; charset=utf-8",
			SOAPAction: `"${SOAP_ACTION}"`,
			Accept: "text/xml",
			"User-Agent": USER_AGENT,
		},
		body,
	});

	const xml = await response.text();
	if (!response.ok) {
		throw new StudentVueError(`StudentVUE returned HTTP ${response.status}.`, response.status);
	}

	const resultRaw =
		extractInnerXml(xml, "ProcessWebServiceRequestResult") ??
		extractInnerXml(xml, "ProcessWebServiceRequestMultiWebResult") ??
		"";
	const result = resultRaw.includes("&lt;") ? decodeXml(resultRaw) : resultRaw;
	const error = soapErrorMessage(result) || soapErrorMessage(xml);
	if (error) throw new StudentVueError(error);
	if (!result) {
		throw new StudentVueError("StudentVUE returned an empty SOAP result");
	}
	return result;
}
