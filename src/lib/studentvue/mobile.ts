import type { Credentials } from "./types";
import { normalizeDistrictUrl, studentVueFetch, StudentVueError } from "./client";

const USER_AGENT = "StudentVUE/2.0.16 CFNetwork/3860.700.1 Darwin/25.6.0";
const KEY_VERSION = "bOpVYcir6oyLwz0Ymg8kCDMUNaHbLy5yLJJK/3LgToU=";

function clientData(path: string): string {
	const nonce = Math.random().toString(36).slice(2, 13);
	return `POST:${path}:${Date.now()}:${nonce}`;
}

function basicAuthorization(username: string, password: string): string {
	const bytes = new TextEncoder().encode(`${username}:${password}`);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return `Basic ${btoa(binary)}`;
}

function headers(creds: Credentials, path: string, withBearer: boolean): HeadersInit {
	const headers: Record<string, string> = {
		Accept: "*/*",
		"Content-Type": "application/json",
		"User-Agent": USER_AGENT,
		edupointkeyversion: KEY_VERSION,
		Cookie: "PVUE=98; AppSupportsSession=1",
	};
	if (withBearer && creds.accessToken) {
		headers.Authorization = `Bearer ${creds.accessToken}`;
		headers["x-client-data"] = clientData(path);
		headers["x-platform"] = "iOS";
		headers["x-device-model"] = "iPhone18,3";
	} else {
		headers.Authorization = basicAuthorization(creds.username, creds.password);
	}
	return headers;
}

function apiError(json: Record<string, unknown>, status: number): StudentVueError {
	const raw = json.error;
	const error = raw && typeof raw === "object" ? (raw as { code?: unknown; message?: unknown }) : {};
	const message = typeof error.message === "string" ? error.message : "";
	const code =
		typeof error.code === "string" && /^[a-z0-9][a-z0-9._-]{0,31}$/i.test(error.code)
			? error.code
			: "";
	if (/invalid|incorrect|unauthorized|credential|password|user ?name/i.test(message)) {
		return new StudentVueError("StudentVUE did not accept those credentials.", 401);
	}
	return new StudentVueError(
		code ? `StudentVUE rejected the request (${code}).` : "StudentVUE rejected the request.",
		status,
	);
}

async function mobilePost<T>(
	creds: Credentials,
	path: string,
	request: unknown,
	withBearer: boolean,
): Promise<T> {
	const url = `${normalizeDistrictUrl(creds.districtUrl)}${path}`;
	const response = await studentVueFetch(url, {
		method: "POST",
		headers: headers(creds, path, withBearer),
		body: JSON.stringify({
			arguments: { request: JSON.stringify(request) },
		}),
	});
	const text = await response.text();
	let json: Record<string, unknown> | null = null;
	try {
		json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
	} catch {
		json = null;
	}

	if (json && typeof json.error === "object" && json.error) {
		throw apiError(json, response.status);
	}
	if (!response.ok) {
		throw new StudentVueError(`StudentVUE returned HTTP ${response.status}.`, response.status);
	}
	return (json ?? {}) as T;
}

export async function attemptLogin(creds: Credentials): Promise<Credentials> {
	const path = "/api/v1/mobile/PXPWebServices/AttemptLogin";
	const json = await mobilePost<{ access_token?: string; refresh_token?: string; data?: unknown }>(
		creds,
		path,
		{
			userID: creds.username,
			password: creds.password,
			userType: "Student",
			AttestPlatform: "iOS",
			AttestKeyId: null,
			LoginAssertion: null,
			LoginClientData: clientData(path),
			DeviceModel: "iPhone18,3",
		},
		false,
	);

	const token =
		json.access_token ||
		(typeof json.data === "object" && json.data
			? String((json.data as { access_token?: string }).access_token ?? "")
			: "");
	if (!token) {
		throw new StudentVueError("StudentVUE did not return an access token");
	}
	return {
		...creds,
		accessToken: token,
		refreshToken: json.refresh_token,
	};
}

export async function getChildList(creds: Credentials): Promise<unknown> {
	return mobilePost(
		creds,
		"/api/v1/mobile/PXPWebServices/GetChildListData",
		{
			childIntID: 0,
			mobileAppLastSyncDateTime: "",
			languageCode: "98",
			legacyAppRequest: false,
			secondaryLogin: false,
		},
		true,
	);
}

export async function getMobileGradebook(creds: Credentials, reportPeriod?: string): Promise<unknown> {
	const request: Record<string, unknown> = {
		concurrentSchOrgYearGU: "",
		childIntID: 0,
		languageCode: "98",
	};
	if (reportPeriod) {
		request.reportPeriod = reportPeriod;
		request.reportPeriodIndex = reportPeriod;
	}
	return mobilePost(creds, "/api/v1/mobile/PXPWebServices/Gradebook", request, true);
}

export async function getMobileStudentDocuments(creds: Credentials): Promise<unknown> {
	return mobilePost(
		creds,
		"/api/v1/mobile/PXPWebServices/GetStudentDocuments",
		{ childIntID: 0, languageCode: "98" },
		true,
	);
}

export async function getMobileStudentDocumentContent(
	creds: Credentials,
	documentGU: string,
): Promise<unknown> {
	return mobilePost(
		creds,
		"/api/v1/mobile/PXPWebServices/GetStudentDocumentContent",
		{ childIntID: 0, documentGU },
		true,
	);
}

export async function getMobileMail(
	creds: Credentials,
	folder = "Inbox",
	skip = 0,
	take = 25,
): Promise<unknown> {
	return mobilePost(
		creds,
		"/api/v1/mobile/PXPWebServices/GetSynergyMailMessage",
		{
			childIntID: 0,
			folderGU: folder,
			languageCode: "98",
			loadMessageBody: "true",
			skip: String(skip),
			take: String(take),
		},
		true,
	);
}

export async function getMobileMailAttachment(creds: Credentials, smAttachmentGU: string): Promise<unknown> {
	return mobilePost(
		creds,
		"/api/v1/mobile/PXPWebServices/GetSynergyMailGetAttachment",
		{ childIntID: 0, smAttachmentGU },
		true,
	);
}

export async function markMobileMailRead(
	creds: Credentials,
	smMessagePersonGU: string,
	read = true,
): Promise<void> {
	await saveMobileMailFlags(creds, smMessagePersonGU, { read, deleted: false });
}

export async function moveMobileMail(
	creds: Credentials,
	smMessagePersonGU: string,
	dest: { folderType: string; smFolderGU?: string },
): Promise<void> {
	await mobilePost(
		creds,
		"/api/v1/mobile/PXPWebServices/GetSynergyMailMoveMessage",
		{
			childIntID: 0,
			smMessagePersonGU,
			smFolderGU: dest.smFolderGU ?? "",
			folderType: dest.folderType,
		},
		true,
	);
}

export async function moveMobileMailToTrash(creds: Credentials, smMessagePersonGU: string): Promise<void> {
	await moveMobileMail(creds, smMessagePersonGU, { folderType: "3" });
}

export async function markMobileMailDeleted(creds: Credentials, smMessagePersonGU: string): Promise<void> {
	await saveMobileMailFlags(creds, smMessagePersonGU, { read: false, deleted: true });
}

async function saveMobileMailFlags(
	creds: Credentials,
	smMessagePersonGU: string,
	flags: { read: boolean; deleted: boolean },
): Promise<void> {
	await mobilePost(
		creds,
		"/api/v1/mobile/PXPWebServices/GetSynergyMailSaveReadOrDeleteMsg",
		{
			childIntID: 0,
			synergyEmailMarkList: {
				processRead: !flags.deleted,
				processDelete: flags.deleted,
				markAsRead: flags.read,
				markAsDeleteRecord: flags.deleted,
				smMessagePersonGuList: smMessagePersonGU,
			},
		},
		true,
	);
}

const TOKEN_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function tokenFromValue(value: unknown): string {
	if (typeof value === "string") {
		return value.match(TOKEN_RE)?.[0] ?? "";
	}
	const record = asRecord(value);
	if (!record) return "";
	return (
		tokenFromValue(record.encyToken) ||
		tokenFromValue(record.encToken) ||
		tokenFromValue(record.token) ||
		tokenFromValue(record.result)
	);
}

export function parseGenerateAuthToken(payload: unknown): string {
	const root = asRecord(payload) ?? {};
	let data: unknown = root.data ?? root;
	if (typeof data === "string") {
		try {
			data = JSON.parse(data);
		} catch {
			return tokenFromValue(data);
		}
	}
	const dataRecord = asRecord(data) ?? root;
	return (
		tokenFromValue(dataRecord.authToken) ||
		tokenFromValue(dataRecord.result) ||
		tokenFromValue(root.authToken) ||
		tokenFromValue(root.result) ||
		JSON.stringify(payload).match(TOKEN_RE)?.[0] ||
		""
	);
}

export async function generateAuthToken(creds: Credentials): Promise<string> {
	const json = await mobilePost(
		creds,
		"/api/v1/mobile/PXPWebServices/GenerateAuthToken",
		{
			username: creds.username,
			tokenForClassWebSite: "true",
			usertype: "0",
			isParentStudent: "0",
			assignmentID: "1",
			documentID: "1",
			childIntID: 0,
		},
		true,
	);
	const token = parseGenerateAuthToken(json);
	if (!token) {
		throw new StudentVueError("StudentVUE did not return an attendance token");
	}
	return token;
}
