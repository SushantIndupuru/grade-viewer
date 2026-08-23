export interface Credentials {
	username: string;
	password: string;
	districtUrl: string;
	accessToken?: string;
	refreshToken?: string;
}

export interface ReportingPeriod {
	index: string;
	gradePeriod: string;
	startDate: string;
	endDate: string;
}

export interface CategorySummary {
	type: string;
	weight: number;
	points: number;
	pointsPossible: number;
	weightedPct: number | null;
	calculatedMark: string;
}

export interface Assignment {
	id: string;
	name: string;
	type: string;
	date: string;
	dueDate: string;
	score: string;
	displayScore: string;
	scoreType: string;
	pointsEarned: number | null;
	pointsPossible: number | null;
	notes: string;
	ungraded: boolean;
}

export interface Course {
	period: string;
	title: string;
	teacher: string;
	email: string;
	room: string;
	officialMark: string;
	officialPercent: number;
	categories: CategorySummary[];
	assignments: Assignment[];
}

export interface Gradebook {
	reportingPeriods: ReportingPeriod[];
	reportingPeriod: ReportingPeriod | null;
	courses: Course[];
}

export interface StudentProfile {
	name: string;
	school: string;
	grade: string;
	email: string;
}

export interface StudentDocument {
	id: string;
	fileName: string;
	date: string;
	type: string;
	comment: string;
}

export interface DocumentFile {
	fileName: string;
	mimeType: string;
	bytes: Uint8Array;
}

export interface MailFolder {
	name: string;
	unread: number;
	folderType?: string;
	folderId?: string;
}

export interface MailPerson {
	name: string;
	role: string;
}

export interface MailAttachment {
	id: string;
	name: string;
}

export interface MailMessage {
	id: string;
	personId: string;
	subject: string;
	html: string;
	date: string;
	dateLabel: string;
	read: boolean;
	from: MailPerson[];
	attachments: MailAttachment[];
}

export interface Mailbox {
	folders: MailFolder[];
	messages: MailMessage[];
}

export type AttendanceKind = "excused" | "unexcused" | "tardy" | "activity" | "holiday" | "other";

export interface AttendancePeriod {
	number: string;
	name: string;
	course: string;
	staff: string;
	reason: string;
	kind: AttendanceKind;
}

export interface AttendanceDay {
	date: string;
	reason: string;
	note: string;
	kind: AttendanceKind;
	periods: AttendancePeriod[];
}

export interface AttendancePeriodTotal {
	period: string;
	excused: number;
	tardy: number;
	unexcused: number;
	activity: number;
}

export interface Attendance {
	type: string;
	absences: AttendanceDay[];
	periodTotals: AttendancePeriodTotal[];
}
