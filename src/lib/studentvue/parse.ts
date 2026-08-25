import type {
	Assignment,
	CategorySummary,
	Course,
	Attendance,
	AttendanceDay,
	AttendanceKind,
	AttendancePeriod,
	AttendancePeriodTotal,
	DocumentFile,
	Gradebook,
	Mailbox,
	MailAttachment,
	MailFolder,
	MailMessage,
	MailPerson,
	ReportingPeriod,
	StudentDocument,
	StudentProfile,
} from "./types";
import { asArray } from "./xml";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "",
	allowBooleanAttributes: true,
	parseTagValue: false,
	trimValues: true,
	isArray: (name) =>
		[
			"Course",
			"Assignment",
			"ReportPeriod",
			"AssignmentGradeCalc",
			"Mark",
			"StudentDocumentData",
			"DocumentData",
			"Document",
			"Absence",
			"Period",
		].includes(name),
});

function num(value: unknown, fallback = 0): number {
	if (value == null || value === "") return fallback;
	const parsed = Number(String(value).replace("%", ""));
	return Number.isFinite(parsed) ? parsed : fallback;
}

function str(value: unknown): string {
	if (value == null) return "";
	return String(value);
}

function optionalNum(value: unknown): number | null {
	if (value == null || value === "") return null;
	const parsed = Number(String(value).replace("%", "").replace(/,/g, "").trim());
	return Number.isFinite(parsed) ? parsed : null;
}

function labeledUngraded(score: string, points: string): boolean {
	const lower = `${score} ${points}`.toLowerCase();
	if (/missing/.test(lower)) return false;
	return /not\s*graded|not\s*posted|not\s*due|ungraded|not\s*turned\s*in|exempt|incomplete/.test(
		lower,
	);
}

function possibleFromLabel(text: string): number | null {
	const match =
		text.match(/([\d.]+)\s*points?\s*possible/i) ??
		text.match(/points?\s*possible[:\s]+([\d.]+)/i);
	return match ? Number(match[1]) : null;
}

function parsePoints(points: string, score: string): Pick<
	Assignment,
	"pointsEarned" | "pointsPossible" | "ungraded"
> {
	const fraction = points.match(/(-?[\d.]+)\s*\/\s*([\d.]+)/);
	const possibleHint = possibleFromLabel(points) ?? possibleFromLabel(score);
	const danglingPossible = points.match(/(?:^|[^\d.])\/\s*([\d.]+)\s*$/);
	const lone = points.match(/^\s*(-?[\d.]+)\s*$/);

	let pointsEarned: number | null = null;
	let pointsPossible: number | null = null;
	if (fraction) {
		pointsEarned = Number(fraction[1]);
		pointsPossible = Number(fraction[2]);
	} else if (possibleHint != null) {
		pointsPossible = possibleHint;
	} else if (danglingPossible) {
		pointsPossible = Number(danglingPossible[1]);
	} else if (lone) {
		pointsPossible = Number(lone[1]);
	}

	const emptyScore = score.trim() === "" || /^[-–—*]+$/.test(score.trim());
	const ungraded =
		labeledUngraded(score, points) ||
		(pointsEarned == null && emptyScore) ||
		(emptyScore && pointsEarned === 0 && (pointsPossible == null || pointsPossible === 0));

	if (ungraded) {
		pointsEarned = null;
		if (pointsPossible === 0) {
			pointsPossible = possibleHint ?? (lone ? Number(lone[1]) : null);
		}
		if (pointsPossible === 0) pointsPossible = null;
	}

	return { pointsEarned, pointsPossible, ungraded };
}

function parseReportingPeriod(node: Record<string, unknown> | undefined): ReportingPeriod | null {
	if (!node) return null;
	return {
		index: str(node.Index),
		gradePeriod: str(node.GradePeriod),
		startDate: str(node.StartDate),
		endDate: str(node.EndDate),
	};
}

function parseAssignment(node: Record<string, unknown>): Assignment {
	const score = str(node.Score);
	const points = str(node.Points);
	return {
		id: str(node.GradebookID) || crypto.randomUUID(),
		name: str(node.Measure),
		type: str(node.Type) || "Assignment",
		date: str(node.Date),
		dueDate: str(node.DueDate),
		score,
		displayScore: score,
		scoreType: str(node.ScoreType),
		notes: str(node.Notes),
		...parsePoints(points, score),
	};
}

function parseCategory(node: Record<string, unknown>): CategorySummary {
	return {
		type: str(node.Type),
		weight: num(node.Weight),
		points: num(node.Points),
		pointsPossible: num(node.PointsPossible),
		weightedPct: node.WeightedPct == null || node.WeightedPct === "" ? null : num(node.WeightedPct),
		calculatedMark: str(node.CalculatedMark),
	};
}

function parseCourse(node: Record<string, unknown>): Course {
	const marksNode = (node.Marks ?? {}) as Record<string, unknown>;
	const markObj = (asArray(marksNode.Mark as Record<string, unknown>[] | undefined)[0] ??
		{}) as Record<string, unknown>;
	const summary = (markObj.GradeCalculationSummary ?? {}) as Record<string, unknown>;
	const assignmentsNode = (markObj.Assignments ?? {}) as Record<string, unknown>;

	return {
		period: str(node.Period),
		title: str(node.Title) || str(node.CourseName),
		teacher: str(node.Staff),
		email: str(node.StaffEMail),
		room: str(node.Room),
		officialMark: str(markObj.CalculatedScoreString),
		officialPercent: num(markObj.CalculatedScoreRaw),
		categories: asArray(summary.AssignmentGradeCalc as Record<string, unknown>[]).map(parseCategory),
		assignments: asArray(assignmentsNode.Assignment as Record<string, unknown>[]).map(parseAssignment),
	};
}

export function parseGradebook(xml: string): Gradebook {
	const parsed = parser.parse(xml) as Record<string, unknown>;
	const gradebook = (parsed.Gradebook ?? parsed) as Record<string, unknown>;
	const periodsNode = (gradebook.ReportingPeriods ?? {}) as Record<string, unknown>;
	const coursesNode = (gradebook.Courses ?? {}) as Record<string, unknown>;

	return {
		reportingPeriods: asArray(periodsNode.ReportPeriod as Record<string, unknown>[]).map(
			(period) => parseReportingPeriod(period) as ReportingPeriod,
		),
		reportingPeriod: parseReportingPeriod(gradebook.ReportingPeriod as Record<string, unknown>),
		courses: asArray(coursesNode.Course as Record<string, unknown>[]).map(parseCourse),
	};
}

export function parseStudentInfo(xml: string): StudentProfile {
	const parsed = parser.parse(xml) as Record<string, unknown>;
	const info = (parsed.StudentInfo ?? parsed) as Record<string, unknown>;
	return {
		name: str(info.FormattedName),
		school: str(info.CurrentSchool),
		grade: str(info.Grade),
		email: str(info.EMail || info.Email),
	};
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
	for (const key of keys) {
		if (obj[key] != null && obj[key] !== "") return obj[key];
	}
	return undefined;
}

function parseJsonAssignment(node: Record<string, unknown>): Assignment {
	const displayScore = str(pick(node, "displayScore", "DisplayScore"));
	const score = str(pick(node, "score", "Score")) || displayScore;
	const pointsRaw = pick(node, "points", "Points");
	const fromObject =
		pointsRaw != null && typeof pointsRaw === "object"
			? (pointsRaw as Record<string, unknown>)
			: null;
	const pointsText = fromObject ? "" : str(pointsRaw);
	const parsed = parsePoints(pointsText, score);

	const earnedRaw =
		pick(node, "point", "pointsEarned", "PointsEarned", "scoreCalValue") ??
		pick(fromObject ?? {}, "earned", "pointsEarned");
	const possibleRaw =
		pick(
			node,
			"pointPossible",
			"pointsPossible",
			"PointsPossible",
			"scoreMaxValue",
			"maxPoints",
			"MaxPoints",
			"totalPoints",
			"possiblePoints",
		) ?? pick(fromObject ?? {}, "possible", "pointsPossible", "max", "maxPoints");

	let pointsEarned = optionalNum(earnedRaw) ?? parsed.pointsEarned;
	let pointsPossible = optionalNum(possibleRaw);
	if (pointsPossible == null || pointsPossible === 0) {
		pointsPossible = parsed.pointsPossible ?? (pointsPossible === 0 ? 0 : null);
	}
	if ((pointsPossible == null || pointsPossible === 0) && typeof pointsRaw === "number") {
		pointsPossible = pointsRaw;
	}

	const ungraded =
		parsed.ungraded ||
		labeledUngraded(score, pointsText) ||
		(pointsEarned == null && !/missing/i.test(score));
	if (ungraded) {
		pointsEarned = null;
		if (pointsPossible === 0) pointsPossible = parsed.pointsPossible;
		if (pointsPossible === 0) pointsPossible = null;
	}

	return {
		id: str(pick(node, "gradebookID", "GradebookID", "id")) || crypto.randomUUID(),
		name: str(pick(node, "measure", "Measure", "name")),
		type: str(pick(node, "type", "Type")) || "Assignment",
		date: str(pick(node, "date", "Date")),
		dueDate: str(pick(node, "dueDate", "DueDate")),
		score,
		displayScore: displayScore || score,
		scoreType: str(pick(node, "scoreType", "ScoreType")),
		notes: str(pick(node, "notes", "Notes", "measureDescription")),
		pointsEarned,
		pointsPossible,
		ungraded,
	};
}

function parseJsonCategory(node: Record<string, unknown>): CategorySummary {
	return {
		type: str(pick(node, "type", "Type")),
		weight: num(pick(node, "weight", "Weight")),
		points: num(pick(node, "points", "Points")),
		pointsPossible: num(pick(node, "pointsPossible", "PointsPossible")),
		weightedPct:
			pick(node, "weightedPct", "WeightedPct") == null ? null : num(pick(node, "weightedPct", "WeightedPct")),
		calculatedMark: str(pick(node, "calculatedMark", "CalculatedMark")),
	};
}

function parseJsonCourse(node: Record<string, unknown>): Course {
	const marks = asArray(node.marks as Record<string, unknown>[] | undefined);
	const mark = marks[0] ?? {};
	return {
		period: str(pick(node, "period", "Period")),
		title: str(pick(node, "courseName", "CourseName", "title", "Title")),
		teacher: str(pick(node, "staff", "Staff")),
		email: str(pick(node, "staffEMail", "StaffEMail")),
		room: str(pick(node, "room", "Room")),
		officialMark: str(pick(mark, "calculatedScoreString", "CalculatedScoreString")),
		officialPercent: num(pick(mark, "calculatedScoreRaw", "CalculatedScoreRaw")),
		categories: asArray(
			pick(mark, "gradeCalculationSummary", "GradeCalculationSummary") as Record<string, unknown>[] | undefined,
		).map(parseJsonCategory),
		assignments: asArray(pick(mark, "assignments", "Assignments") as Record<string, unknown>[] | undefined).map(
			parseJsonAssignment,
		),
	};
}

export function parseMobileGradebook(payload: unknown): Gradebook {
	const root = (payload ?? {}) as Record<string, unknown>;
	const data = (root.data ?? root) as Record<string, unknown>;
	const book = (data.traditionalGradebook ?? data.Gradebook ?? data) as Record<string, unknown>;
	const current = (book.reportingPeriod ?? {}) as Record<string, unknown>;
	return {
		reportingPeriods: asArray(book.reportingPeriods as Record<string, unknown>[] | undefined).map(
			(period) =>
				({
					index: str(pick(period, "index", "Index")),
					gradePeriod: str(pick(period, "gradePeriod", "GradePeriod")),
					startDate: str(pick(period, "startDate", "StartDate")),
					endDate: str(pick(period, "endDate", "EndDate")),
				}) satisfies ReportingPeriod,
		),
		reportingPeriod: current && Object.keys(current).length
			? {
					index: str(pick(current, "index", "Index")),
					gradePeriod: str(pick(current, "gradePeriod", "GradePeriod")),
					startDate: str(pick(current, "startDate", "StartDate")),
					endDate: str(pick(current, "endDate", "EndDate")),
				}
			: null,
		courses: asArray(book.courses as Record<string, unknown>[] | undefined).map(parseJsonCourse),
	};
}

export function parseChildList(payload: unknown): StudentProfile {
	const root = (payload ?? {}) as Record<string, unknown>;
	const data = (root.data ?? root) as Record<string, unknown>;
	const children = (data.children ?? data) as Record<string, unknown>;
	const list = asArray(children.childrenList as Record<string, unknown>[] | undefined);
	const child = list[0] ?? {};
	return {
		name: str(pick(child, "childName") || pick(children, "userFormattedName")),
		school: str(pick(child, "organizationName", "CurrentSchool")),
		grade: str(pick(child, "grade", "Grade")),
		email: str(pick(child, "email", "eMail", "EMail") || pick(children, "email", "eMail", "EMail")),
	};
}

function parseDocument(node: Record<string, unknown>): StudentDocument {
	return {
		id: str(pick(node, "documentGU", "DocumentGU", "id")),
		fileName: str(pick(node, "documentFileName", "DocumentFileName", "fileName", "FileName")),
		date: str(pick(node, "documentDate", "DocumentDate", "docDate", "DocDate", "date", "Date")),
		type: str(pick(node, "documentType", "DocumentType", "category", "Category", "docType")) || "Document",
		comment: str(pick(node, "documentComment", "DocumentComment", "notes", "Notes", "comment", "Comment")),
	};
}

export function parseMobileDocuments(payload: unknown): StudentDocument[] {
	const root = (payload ?? {}) as Record<string, unknown>;
	const data = (root.data ?? root) as Record<string, unknown>;
	const docs = (data.studentDocuments ?? data) as Record<string, unknown>;
	return asArray(
		(pick(docs, "studentDocumentDatas", "StudentDocumentDatas", "studentDocumentData") as
			| Record<string, unknown>[]
			| undefined) ?? [],
	)
		.map(parseDocument)
		.filter((doc) => doc.id);
}

export function parseStudentDocumentsXml(xml: string): StudentDocument[] {
	const parsed = parser.parse(xml) as Record<string, unknown>;
	const root = (parsed.StudentDocuments ?? parsed) as Record<string, unknown>;
	const nested = (root.StudentDocumentDatas ?? root) as Record<string, unknown>;
	return asArray(
		(pick(nested, "StudentDocumentData", "Document", "studentDocumentDatas") as
			| Record<string, unknown>[]
			| undefined) ?? [],
	)
		.map(parseDocument)
		.filter((doc) => doc.id);
}

function mimeFor(docType: string, fileName: string): string {
	const type = docType.toLowerCase();
	const name = fileName.toLowerCase();
	if (type.includes("pdf") || name.endsWith(".pdf")) return "application/pdf";
	if (type.includes("png") || name.endsWith(".png")) return "image/png";
	if (type.includes("jpg") || type.includes("jpeg") || name.endsWith(".jpg") || name.endsWith(".jpeg")) {
		return "image/jpeg";
	}
	return "application/octet-stream";
}

function decodeBase64(value: string): Uint8Array {
	const cleaned = value.replace(/\s+/g, "");
	if (!cleaned) return new Uint8Array();
	const binary = atob(cleaned);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function parseDocumentFile(node: Record<string, unknown>): DocumentFile | null {
	const base64 = str(pick(node, "base64Code", "Base64Code", "fileContents", "FileContents"));
	if (!base64) return null;
	const fileName = str(pick(node, "fileName", "FileName", "documentFileName")) || "document.pdf";
	const docType = str(pick(node, "docType", "DocType", "contentType", "ContentType"));
	return {
		fileName,
		mimeType: mimeFor(docType, fileName),
		bytes: decodeBase64(base64),
	};
}

export function parseMobileDocumentContent(payload: unknown): DocumentFile {
	const root = (payload ?? {}) as Record<string, unknown>;
	const data = (root.data ?? root) as Record<string, unknown>;
	const attached = (data.studentAttachedDocumentData ?? data) as Record<string, unknown>;
	const list = asArray(
		(pick(attached, "documentDatas", "DocumentDatas", "documentData") as Record<string, unknown>[] | undefined) ??
			[],
	);
	const file = parseDocumentFile(list[0] ?? attached);
	if (!file || file.bytes.length === 0) {
		throw new Error("StudentVUE did not return the document file.");
	}
	return file;
}

export function parseDocumentContentXml(xml: string): DocumentFile {
	const parsed = parser.parse(xml) as Record<string, unknown>;
	const root = (parsed.DocumentDatas ?? parsed.StudentDocuments ?? parsed) as Record<string, unknown>;
	const list = asArray(
		(pick(root, "DocumentData", "StudentDocumentData", "Document") as Record<string, unknown>[] | undefined) ?? [],
	);
	const file = parseDocumentFile(list[0] ?? root);
	if (!file || file.bytes.length === 0) {
		throw new Error("StudentVUE did not return the document file.");
	}
	return file;
}

function parseMailPerson(node: Record<string, unknown>): MailPerson {
	return {
		name: str(pick(node, "details1", "details1", "Details1", "contactDetails1", "fromPersonName")),
		role: str(pick(node, "details2", "details2", "Details2", "contactDetails2")),
	};
}

function parseMailAttachment(node: Record<string, unknown>): MailAttachment {
	return {
		id: str(pick(node, "smAttachmentGU", "smAttachmentGU", "SMAttachmentGU", "id")),
		name: str(pick(node, "documentName", "documentName", "DocumentName", "fileName")) || "Attachment",
	};
}

export function parseMobileMailAttachment(payload: unknown): DocumentFile {
	const root = (payload ?? {}) as Record<string, unknown>;
	const data = (root.data ?? root) as Record<string, unknown>;
	const attached =
		(pick(data, "attachmentXML", "attachmentXML", "AttachmentXML") as Record<string, unknown> | undefined) ?? data;
	const base64 = str(pick(attached, "base64Code", "base64Code", "Base64Code"));
	if (!base64) {
		throw new Error("StudentVUE did not return the attachment.");
	}
	const fileName =
		str(pick(attached, "documentName", "documentName", "DocumentName", "fileName")) || "attachment";
	const type = str(pick(attached, "type", "Type", "contentType", "ContentType"));
	return {
		fileName,
		mimeType: mimeFor(type, fileName),
		bytes: decodeBase64(base64),
	};
}

function parseMailMessage(node: Record<string, unknown>): MailMessage {
	const from = asArray((pick(node, "from", "From") as Record<string, unknown>[] | undefined) ?? [])
		.map(parseMailPerson)
		.filter((person) => person.name);
	const fallback = str(pick(node, "fromPersonName", "fromPersonName", "FromPersonName"));
	return {
		id: str(pick(node, "smMessageGU", "smMessageGU", "SMMessageGU", "id")),
		personId: str(pick(node, "smMsgPersonGU", "smMsgPersonGU", "SMMsgPersonGU")),
		subject: str(pick(node, "subject", "Subject")) || "(No subject)",
		html: str(pick(node, "messageText", "messageText", "MessageText")),
		date: str(pick(node, "sendDateTime", "sendDateTime", "SendDateTime")),
		dateLabel: str(
			pick(
				node,
				"sendDateTimeFormattedShort",
				"sendDateTimeFormattedShort",
				"sendDateTimeFormattedLong",
				"SendDateTimeFormattedShort",
			),
		),
		read: Boolean(pick(node, "mailRead", "mailRead", "MailRead")),
		from: from.length ? from : fallback ? [{ name: fallback, role: "" }] : [],
		attachments: asArray(
			(pick(node, "attachments", "Attachments") as Record<string, unknown>[] | undefined) ?? [],
		)
			.map(parseMailAttachment)
			.filter((item) => item.name),
	};
}

function firstListing(mail: Record<string, unknown>, ...keys: string[]): Record<string, unknown>[] {
	for (const key of keys) {
		const listed = asArray((mail[key] as Record<string, unknown>[] | undefined) ?? []);
		if (listed.length) return listed;
	}
	return [];
}

function listingsForFolder(mail: Record<string, unknown>, folder: string): Record<string, unknown>[] {
	switch (folder.trim().toLowerCase()) {
		case "inbox":
			return firstListing(mail, "inboxItemListings", "inboxItemListings");
		case "sent":
			return firstListing(mail, "sentItemListings", "sentItemListings");
		case "draft":
		case "drafts":
			return firstListing(mail, "draftItemListings", "draftItemListings");
		case "archive":
		case "trash":
			return firstListing(mail, "archiveItemListings", "archiveItemListings");
		case "outbox":
			return firstListing(mail, "outboxItemListings", "outboxItemListings");
		default:
			return firstListing(mail, "allOtherFolderMessages", "allOtherFolderMessages");
	}
}

const KIND_RANK: AttendanceKind[] = ["unexcused", "tardy", "activity", "excused", "holiday", "other"];

function classifyReason(reason: string, dailyTardy = false): AttendanceKind {
	const value = reason.toLowerCase();
	if (dailyTardy || /\btardy\b|\blate\b/.test(value)) return "tardy";
	if (/unexcused|truant|\bcut\b|unverify|unverified/.test(value)) return "unexcused";
	if (/activit|field\s*trip|school\s*business|athletics/.test(value)) return "activity";
	if (/holiday|not\s*schedul|non-?enroll|weekend/.test(value)) return "holiday";
	if (reason.trim()) return "excused";
	return "other";
}

function worseKind(left: AttendanceKind, right: AttendanceKind): AttendanceKind {
	return KIND_RANK.indexOf(left) <= KIND_RANK.indexOf(right) ? left : right;
}

function parseAttendancePeriod(node: Record<string, unknown>): AttendancePeriod {
	const reason = str(pick(node, "Reason", "reason"));
	return {
		number: str(pick(node, "Number", "PeriodNumber", "Period", "number")),
		name: str(pick(node, "Name", "PeriodName", "name")),
		course: str(pick(node, "Course", "CourseTitle", "course")),
		staff: str(pick(node, "Staff", "Teacher", "StaffName", "staff")),
		reason,
		kind: classifyReason(reason),
	};
}

function parseAttendanceDay(node: Record<string, unknown>): AttendanceDay {
	const reason = str(pick(node, "Reason", "reason"));
	const dailyTardy = /^(1|true|yes)$/i.test(str(pick(node, "DailyTardy", "dailyTardy")));
	const wrapped = (node.Periods ?? node.periods ?? node) as Record<string, unknown>;
	const periods = asArray(
		(pick(wrapped, "Period", "period") as Record<string, unknown>[] | undefined) ??
			(pick(node, "Period", "period") as Record<string, unknown>[] | undefined) ??
			[],
	)
		.map(parseAttendancePeriod)
		.filter((period) => period.number || period.course || period.reason);
	let kind = classifyReason(reason, dailyTardy);
	for (const period of periods) kind = worseKind(kind, period.kind);
	return {
		date: str(pick(node, "AbsenceDate", "Date", "AttendanceDate", "date")),
		reason,
		note: str(pick(node, "Note", "Notes", "note")),
		kind,
		periods,
	};
}

function parsePeriodTotalNode(
	node: Record<string, unknown> | undefined,
	key: "excused" | "tardy" | "unexcused" | "activity",
	into: Map<string, AttendancePeriodTotal>,
): void {
	if (!node) return;
	for (const [name, value] of Object.entries(node)) {
		const match = name.match(/period_?(\d+)/i);
		if (!match) continue;
		const period = match[1];
		const current = into.get(period) ?? { period, excused: 0, tardy: 0, unexcused: 0, activity: 0 };
		current[key] = num(value);
		into.set(period, current);
	}
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

export function parseAttendanceXml(xml: string): Attendance {
	const parsed = parser.parse(xml) as Record<string, unknown>;
	const root = (parsed.Attendance ?? parsed) as Record<string, unknown>;
	const absencesRoot = (root.Absences ?? root.absences ?? root) as Record<string, unknown>;
	const absences = asArray(
		(pick(absencesRoot, "Absence", "absence") as Record<string, unknown>[] | undefined) ?? [],
	)
		.map(parseAttendanceDay)
		.filter((day) => day.date)
		.sort((a, b) => str(a.date).localeCompare(str(b.date)));

	const totals = new Map<string, AttendancePeriodTotal>();
	parsePeriodTotalNode(recordFromUnknown(pick(root, "TotalExcused", "TotalsExcused")), "excused", totals);
	parsePeriodTotalNode(recordFromUnknown(pick(root, "TotalTardies", "TotalsTardies")), "tardy", totals);
	parsePeriodTotalNode(recordFromUnknown(pick(root, "TotalUnexcused", "TotalsUnexcused")), "unexcused", totals);
	parsePeriodTotalNode(recordFromUnknown(pick(root, "TotalActivities", "TotalsActivities")), "activity", totals);

	return {
		type: str(pick(root, "Type", "type")) || "Period",
		absences,
		periodTotals: [...totals.values()].sort((a, b) => Number(a.period) - Number(b.period)),
	};
}

export function parseMobileMail(payload: unknown, folder = "Inbox"): Mailbox {
	const root = (payload ?? {}) as Record<string, unknown>;
	const data = (root.data ?? root) as Record<string, unknown>;
	const mail = (data.synergyMailDataXML ?? data.synergyMailDataXML ?? data) as Record<string, unknown>;
	const folders = asArray(
		((mail.folderListViews ?? mail.folderListViews) as Record<string, unknown>[] | undefined) ?? [],
	)
		.map((node) => ({
			name: str(pick(node, "folderName", "folderName", "FolderName")) || "Folder",
			unread: Number(pick(node, "unreadMessages", "unreadMessages", "UnreadMessages") ?? 0) || 0,
			folderType: str(pick(node, "folderType", "folderType", "FolderType")),
			folderId: str(pick(node, "smFolderGU", "smFolderGU", "SMFolderGU")),
		}))
		.filter((item) => item.name);
	return {
		folders,
		messages: listingsForFolder(mail, folder)
			.map(parseMailMessage)
			.filter((item) => item.id),
	};
}
