export const THEME_COOKIE = "gv_theme";
export const THEME_MAX_AGE = 60 * 60 * 24 * 365;

export type Theme = "light" | "dark";

export function isTheme(value: string | undefined | null): value is Theme {
	return value === "light" || value === "dark";
}

export function readThemeCookie(): Theme | null {
	const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`));
	const value = match ? decodeURIComponent(match[1]) : "";
	return isTheme(value) ? value : null;
}

export function writeThemeCookie(theme: Theme): void {
	const secure = location.protocol === "https:" ? "; Secure" : "";
	document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_MAX_AGE}; SameSite=Lax${secure}`;
}

export function systemTheme(): Theme {
	return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolvedTheme(): Theme {
	return readThemeCookie() ?? systemTheme();
}

export function applyTheme(theme: Theme): void {
	document.documentElement.classList.toggle("dark", theme === "dark");
	document.documentElement.style.colorScheme = theme;
}

export function toggleTheme(): Theme {
	const next = resolvedTheme() === "dark" ? "light" : "dark";
	writeThemeCookie(next);
	applyTheme(next);
	return next;
}

function syncToggleButtons(): void {
	const dark = resolvedTheme() === "dark";
	const label = dark ? "Switch to light mode" : "Switch to dark mode";
	for (const button of document.querySelectorAll("[data-theme-toggle]")) {
		button.setAttribute("aria-label", label);
		button.setAttribute("title", label);
	}
	for (const button of document.querySelectorAll<HTMLElement>("[data-theme-choice]")) {
		button.setAttribute("aria-pressed", String(button.dataset.themeChoice === (dark ? "dark" : "light")));
	}
	for (const check of document.querySelectorAll<HTMLElement>("[data-theme-check]")) {
		check.classList.toggle("hidden", check.dataset.themeCheck !== (dark ? "dark" : "light"));
	}
}

let bound = false;

export function bindThemeControls(): void {
	applyTheme(resolvedTheme());
	syncToggleButtons();
	if (bound) return;
	bound = true;

	document.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof Element)) return;
		const choice = target.closest<HTMLElement>("[data-theme-choice]")?.dataset.themeChoice;
		if (isTheme(choice)) {
			writeThemeCookie(choice);
			applyTheme(choice);
			syncToggleButtons();
			return;
		}
		if (!target.closest("[data-theme-toggle]")) return;
		toggleTheme();
		syncToggleButtons();
	});

	matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
		if (readThemeCookie()) return;
		applyTheme(systemTheme());
		syncToggleButtons();
	});
}
