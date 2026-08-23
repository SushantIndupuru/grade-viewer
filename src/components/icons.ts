const svg = (body: string, className = "size-4") =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${className}">${body}</svg>`;

export const icons = {
	bellElectric: (className?: string) =>
		svg(
			`<path d="M18.518 17.347A7 7 0 0 1 14 19"/><path d="M18.8 4A11 11 0 0 1 20 9"/><path d="M9 9h.01"/><circle cx="20" cy="16" r="2"/><circle cx="9" cy="9" r="7"/><rect x="4" y="16" width="10" height="6" rx="2"/>`,
			className,
		),
	mapPinHouse: (className?: string) =>
		svg(
			`<path d="M15 22a1 1 0 0 1-1-1v-4a1 1 0 0 1 .445-.832l3-2a1 1 0 0 1 1.11 0l3 2A1 1 0 0 1 22 17v4a1 1 0 0 1-1 1z"/><path d="M18 10a8 8 0 0 0-16 0c0 4.993 5.539 10.193 7.399 11.799a1 1 0 0 0 .601.2"/><path d="M18 22v-3"/><circle cx="10" cy="10" r="3"/>`,
			className,
		),
	user: (className?: string) =>
		svg(
			`<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>`,
			className,
		),
	clock: (className?: string) =>
		svg(`<path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="10"/>`, className),
	message: (className?: string) =>
		svg(
			`<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>`,
			className,
		),
	alignLeft: (className?: string) =>
		svg(`<path d="M21 5H3"/><path d="M15 12H3"/><path d="M17 19H3"/>`, className),
	check: (className?: string) =>
		svg(`<path d="M20 6 9 17l-5-5"/>`, className),
	logOut: (className?: string) =>
		svg(
			`<path d="m16 17 5-5-5-5"/><path d="M21 12H9"/><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>`,
			className,
		),
	refresh: (className?: string) =>
		svg(
			`<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>`,
			className,
		),
	chevronLeft: (className?: string) =>
		svg(`<path d="m15 18-6-6 6-6"/>`, className),
	chevronUp: (className?: string) => svg(`<path d="m18 15-6-6-6 6"/>`, className),
	chevronDown: (className?: string) => svg(`<path d="m6 9 6 6 6-6"/>`, className),
	plus: (className?: string) => svg(`<path d="M5 12h14"/><path d="M12 5v14"/>`, className),
	fileText: (className?: string) =>
		svg(
			`<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>`,
			className,
		),
	paperclip: (className?: string) =>
		svg(
			`<path d="m13.22 20.2-4.16-4.17a6 6 0 0 1 0-8.49 6 6 0 0 1 8.49 0l5.89 5.87a4 4 0 0 1 0 5.66 4 4 0 0 1-5.66 0l-6.18-6.2a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l4.17 4.17"/>`,
			className,
		),
	download: (className?: string) =>
		svg(`<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>`, className),
	x: (className?: string) => svg(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`, className),
	calendar: (className?: string) =>
		svg(
			`<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>`,
			className,
		),
	chevronRight: (className?: string) => svg(`<path d="m9 18 6-6-6-6"/>`, className),
	mail: (className?: string) =>
		svg(
			`<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>`,
			className,
		),
	trash: (className?: string) =>
		svg(
			`<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>`,
			className,
		),
	folderInput: (className?: string) =>
		svg(
			`<path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1"/><path d="M2 13h10"/><path d="m9 16 3-3-3-3"/>`,
			className,
		),
};
