export const SOURCE_URL = "https://github.com/SushantIndupuru/grade-viewer";
export const CONTACT_EMAIL = "contact@gradeviewer.org";

export function defaultDistrictUrl(): string {
	return (import.meta.env.PUBLIC_DEFAULT_DISTRICT_URL ?? "").trim();
}
