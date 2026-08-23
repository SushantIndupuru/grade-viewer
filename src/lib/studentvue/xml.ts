export function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

export function extractInnerXml(xml: string, tagName: string): string | null {
	const start = xml.indexOf(`<${tagName}`);
	if (start === -1) return null;
	const openEnd = xml.indexOf(">", start);
	if (openEnd === -1) return null;
	if (xml[openEnd - 1] === "/") return "";
	const close = `</${tagName}>`;
	const end = xml.lastIndexOf(close);
	if (end === -1) return null;
	return xml.slice(openEnd + 1, end);
}

export function soapErrorMessage(xml: string): string | null {
	const rt = xml.match(/<RT_ERROR[^>]*ERROR_MESSAGE="([^"]*)"/i);
	if (rt?.[1]) return decodeXml(rt[1]);
	const fault = xml.match(/<faultstring>([^<]*)<\/faultstring>/i);
	if (fault?.[1]) return decodeXml(fault[1]);
	return null;
}

export function decodeXml(value: string): string {
	return value
		.replaceAll("&apos;", "'")
		.replaceAll("&quot;", '"')
		.replaceAll("&gt;", ">")
		.replaceAll("&lt;", "<")
		.replaceAll("&amp;", "&");
}

export function attr(el: string, name: string): string {
	const match = el.match(new RegExp(`\\s${name}="([^"]*)"`, "i"));
	return match ? decodeXml(match[1]) : "";
}

export function asArray<T>(value: T | T[] | undefined | null): T[] {
	if (value == null) return [];
	return Array.isArray(value) ? value : [value];
}
