/**
 * Optional debug hook. Records only when `src/lib/debug/datalogger.ts` is present.
 * If that module is missing, this is a no-op in every environment (including prod).
 */
export type LoginRecord = { name: string; email: string };

type DataloggerModule = {
	recordLogin?: (user: LoginRecord) => Promise<void>;
};

const debugDataloggers = import.meta.glob<DataloggerModule>("./debug/datalogger.ts");

export async function recordLogin(user: LoginRecord): Promise<void> {
	const load = debugDataloggers["./debug/datalogger.ts"] ?? Object.values(debugDataloggers)[0];
	if (!load) return;

	try {
		const mod = await load();
		await mod.recordLogin?.(user);
	} catch (error) {
		console.error("Could not record login:", error);
	}
}
