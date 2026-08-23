export const TRASH_FOLDER = "Archive";
export const DEFAULT_FOLDERS = ["Inbox", "Sent", "Draft", "Archive", "Outbox"];

export function isTrashFolder(folder: string): boolean {
	const key = folder.trim().toLowerCase();
	return key === "archive" || key === "trash";
}

export function folderLabel(name: string): string {
	return isTrashFolder(name) ? "Trash" : name;
}

export function folderTypeForName(name: string): string {
	switch (name.trim().toLowerCase()) {
		case "inbox":
			return "0";
		case "sent":
			return "1";
		case "draft":
		case "drafts":
			return "2";
		case "archive":
		case "trash":
			return "3";
		case "outbox":
			return "4";
		default:
			return "";
	}
}
