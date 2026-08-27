import { processRequest, StudentVueError } from "./client";
import { resolveStudentVueAuthMode } from "./config";
import { getWebAttendance } from "./attendance-web";
import {
	attemptLogin,
	getChildList,
	getMobileGradebook,
	getMobileMail,
	getMobileMailAttachment,
	getMobileStudentDocumentContent,
	getMobileStudentDocuments,
	markMobileMailDeleted,
	markMobileMailRead,
	moveMobileMail,
	moveMobileMailToTrash,
} from "./mobile";
import {
	parseChildList,
	parseDocumentContentXml,
	parseGradebook,
	parseMobileDocumentContent,
	parseMobileDocuments,
	parseMobileGradebook,
	parseMobileMail,
	parseMobileMailAttachment,
	parseStudentDocumentsXml,
	parseStudentInfo,
} from "./parse";
import type {
	Attendance,
	Credentials,
	DocumentFile,
	Gradebook,
	Mailbox,
	StudentDocument,
	StudentProfile,
} from "./types";
import { escapeXml } from "./xml";

function usernameEmail(username: string): string {
	return username.includes("@") ? username : "";
}

function mergeProfile(base: StudentProfile, extra: StudentProfile): StudentProfile {
	return {
		name: extra.name || base.name,
		school: extra.school || base.school,
		grade: extra.grade || base.grade,
		email: extra.email || base.email,
	};
}

export async function login(creds: Credentials): Promise<{ student: StudentProfile; creds: Credentials }> {
	resolveStudentVueAuthMode(import.meta.env.PUBLIC_STUDENTVUE_AUTH);
	const withTokens = await attemptLogin(creds);
	let student: StudentProfile = {
		name: withTokens.username,
		school: "",
		grade: "",
		email: usernameEmail(withTokens.username),
	};

	const [childResult, infoResult] = await Promise.allSettled([
		getChildList(withTokens).then(parseChildList),
		processRequest(withTokens, "StudentInfo").then(parseStudentInfo),
	]);
	if (childResult.status === "fulfilled") {
		student = mergeProfile(student, childResult.value);
	}
	if (infoResult.status === "fulfilled") {
		student = mergeProfile(student, infoResult.value);
	}

	return { student, creds: withTokens };
}

export async function getGradebook(
	creds: Credentials,
	reportPeriod?: string,
): Promise<Gradebook> {
	if (creds.accessToken) {
		const payload = await getMobileGradebook(creds, reportPeriod);
		return parseMobileGradebook(payload);
	}

	const periodXml =
		reportPeriod != null && reportPeriod !== ""
			? `<Parms><ChildIntID>0</ChildIntID><ReportPeriod>${reportPeriod}</ReportPeriod></Parms>`
			: "<Parms><ChildIntID>0</ChildIntID></Parms>";
	const xml = await processRequest(creds, "Gradebook", periodXml);
	return parseGradebook(xml);
}

export async function getDocuments(creds: Credentials): Promise<StudentDocument[]> {
	if (creds.accessToken) {
		const payload = await getMobileStudentDocuments(creds);
		return parseMobileDocuments(payload);
	}
	const xml = await processRequest(creds, "StudentDocuments");
	return parseStudentDocumentsXml(xml);
}

export async function getDocumentContent(creds: Credentials, documentGU: string): Promise<DocumentFile> {
	if (creds.accessToken) {
		const payload = await getMobileStudentDocumentContent(creds, documentGU);
		return parseMobileDocumentContent(payload);
	}
	const xml = await processRequest(
		creds,
		"GetReportCardDocumentData",
		`<Parms><ChildIntID>0</ChildIntID><DocumentGU>${escapeXml(documentGU)}</DocumentGU></Parms>`,
	);
	return parseDocumentContentXml(xml);
}

export async function getMail(creds: Credentials, folder = "Inbox", skip = 0, take = 25): Promise<Mailbox> {
	if (!creds.accessToken) {
		throw new StudentVueError("Session expired", 401);
	}
	const payload = await getMobileMail(creds, folder, skip, take);
	return parseMobileMail(payload, folder);
}

export async function getMailAttachment(creds: Credentials, smAttachmentGU: string): Promise<DocumentFile> {
	if (!creds.accessToken) {
		throw new StudentVueError("Session expired", 401);
	}
	const payload = await getMobileMailAttachment(creds, smAttachmentGU);
	return parseMobileMailAttachment(payload);
}

export async function markMailRead(creds: Credentials, smMessagePersonGU: string, read = true): Promise<void> {
	if (!creds.accessToken) {
		throw new StudentVueError("Session expired", 401);
	}
	await markMobileMailRead(creds, smMessagePersonGU, read);
}

export async function markMailDeleted(creds: Credentials, smMessagePersonGU: string): Promise<void> {
	if (!creds.accessToken) {
		throw new StudentVueError("Session expired", 401);
	}
	await markMobileMailDeleted(creds, smMessagePersonGU);
}

export async function moveMailToTrash(creds: Credentials, smMessagePersonGU: string): Promise<void> {
	if (!creds.accessToken) {
		throw new StudentVueError("Session expired", 401);
	}
	await moveMobileMailToTrash(creds, smMessagePersonGU);
}

export async function moveMail(
	creds: Credentials,
	smMessagePersonGU: string,
	dest: { folderType: string; smFolderGU?: string },
): Promise<void> {
	if (!creds.accessToken) {
		throw new StudentVueError("Session expired", 401);
	}
	await moveMobileMail(creds, smMessagePersonGU, dest);
}

export async function getAttendance(creds: Credentials): Promise<Attendance> {
	if (!creds.accessToken) {
		throw new StudentVueError("Session expired", 401);
	}
	return getWebAttendance(creds);
}

export { StudentVueError } from "./client";
export { normalizeDistrictUrl } from "./client";
