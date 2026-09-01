export const THEME_COOKIE = "gv_theme";
const THEME_MAX_AGE = 60 * 60 * 24 * 365;

type Theme = "light" | "dark";

export function isTheme(value: string | undefined | null): value is Theme {
	return value === "light" || value === "dark";
}

function readThemeCookie(): Theme | null {
	const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`));
	const value = match ? decodeURIComponent(match[1]) : "";
	return isTheme(value) ? value : null;
}

function writeThemeCookie(theme: Theme): void {
	const secure = location.protocol === "https:" ? "; Secure" : "";
	document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_MAX_AGE}; SameSite=Lax${secure}`;
}

function systemTheme(): Theme {
	return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolvedTheme(): Theme {
	return readThemeCookie() ?? systemTheme();
}

function applyTheme(theme: Theme): void {
	document.documentElement.classList.toggle("dark", theme === "dark");
	document.documentElement.style.colorScheme = theme;
}

function toggleTheme(): void {
	const next = resolvedTheme() === "dark" ? "light" : "dark";
	writeThemeCookie(next);
	applyTheme(next);
}

function syncToggleButtons(): void {
	const dark = resolvedTheme() === "dark";
	const label = dark ? "Switch to light mode" : "Switch to dark mode";
	for (const button of document.querySelectorAll("[data-theme-toggle]")) {
		button.setAttribute("aria-label", label);
		button.setAttribute("title", label);
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
		if (!(target instanceof Element) || !target.closest("[data-theme-toggle]")) return;
		toggleTheme();
		syncToggleButtons();
	});

	matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
		if (readThemeCookie()) return;
		applyTheme(systemTheme());
		syncToggleButtons();
	});
}
