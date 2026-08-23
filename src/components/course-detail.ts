import type { Course } from "../lib/studentvue/types";
import { icons } from "./icons";
import {
	calculateCourse,
	categoryTypes,
	emptyAssignment,
	isExtraCredit,
	toDraft,
	type DraftAssignment,
} from "../lib/grades/calculate";
import {
	assignmentImpacts,
	assignmentTimestamp,
	assignmentPercent,
	categoryStyle,
	displayCourseTitle,
	formatCategoryWeight,
	formatDateTitle,
	formatGrade,
	formatShortDate,
	formatUpdatedAt,
	gradeHistory,
	officialLetter,
	progressFillClass,
	progressTranslate,
	uniqueCategories,
} from "../lib/grades/display";

interface Bootstrap {
	course: Course;
	index: number;
	period?: string;
	fetchedAt?: number;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function badge(text: string, extra = "", title = ""): string {
	return `<span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs ${extra}" ${title ? `title="${escapeHtml(title)}"` : ""}>${text}</span>`;
}

function scoreStepper(
	field: "earned" | "possible",
	index: number,
	label: string,
	value: number | null,
): string {
	return `<span class="relative inline-flex">
		<label class="sr-only" for="${field}-${index}">${escapeHtml(label)}</label>
		<input id="${field}-${index}" data-${field}="${index}" type="text" inputmode="decimal" autocomplete="off" class="h-8 w-[4.75rem] rounded border border-border bg-background py-0 pr-6 pl-2 text-sm tabular-nums" value="${value ?? ""}" />
		<span class="absolute inset-y-px right-px flex w-5 flex-col overflow-hidden rounded-r-[3px] border-l border-border">
			<button class="flex flex-1 items-center justify-center text-muted-foreground hover:bg-muted" data-step="${field}" data-index="${index}" data-delta="1" type="button" tabindex="-1" aria-label="Increase ${escapeHtml(label)}">${icons.chevronUp("size-2.5")}</button>
			<button class="flex flex-1 items-center justify-center border-t border-border text-muted-foreground hover:bg-muted" data-step="${field}" data-index="${index}" data-delta="-1" type="button" tabindex="-1" aria-label="Decrease ${escapeHtml(label)}">${icons.chevronDown("size-2.5")}</button>
		</span>
	</span>`;
}

function progressBar(
	percent: number | null,
	fill: string,
	track = "bg-foreground/10",
	index?: number,
): string {
	const value = percent ?? 0;
	const marked = index == null ? "" : ` data-progress="${index}"`;
	return `<div class="relative h-1.5 w-36 overflow-hidden rounded-sm ${track}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"${marked}><div class="h-full w-full transition-all ${fill}" data-progress-fill style="transform: ${progressTranslate(percent)};"></div></div>`;
}

function renderChart(points: { date: Date; percent: number }[]): string {
	if (points.length === 0) {
		return `<div class="flex h-52 items-center justify-center text-sm text-muted-foreground">No graded assignments yet to chart.</div>`;
	}

	const width = 1000;
	const height = 256;
	const padL = 40;
	const padR = 16;
	const padT = 12;
	const padB = 32;
	const innerW = width - padL - padR;
	const innerH = height - padT - padB;

	const ys = points.map((point) => point.percent);
	let minY = Math.min(...ys);
	let maxY = Math.max(...ys);
	if (maxY - minY < 2) {
		minY -= 1;
		maxY += 1;
	}
	const pad = (maxY - minY) * 0.1;
	minY = Math.max(0, minY - pad);
	maxY += pad;
	if (maxY <= minY) maxY = minY + 1;

	const times = points.map((point) => point.date.getTime()).filter(Number.isFinite);
	const day = 24 * 60 * 60 * 1000;
	const week = 7 * day;
	let minT = times.length ? Math.min(...times) : Date.now();
	let maxT = times.length ? Math.max(...times) : minT + week;
	if (maxT < minT) [minT, maxT] = [maxT, minT];
	let spanT = maxT - minT;
	if (spanT < day) {
		maxT = minT + 6 * day;
		spanT = maxT - minT;
	} else {
		const padT = spanT * 0.06;
		minT -= padT;
		maxT += padT;
		spanT = maxT - minT;
	}

	const x = (time: number) => padL + ((time - minT) / spanT) * innerW;
	const y = (value: number) => padT + (1 - (value - minY) / (maxY - minY)) * innerH;

	const line = points
		.map(
			(point, index) =>
				`${index ? "L" : "M"}${x(point.date.getTime()).toFixed(2)},${y(point.percent).toFixed(2)}`,
		)
		.join("");
	const last = points[points.length - 1];
	const area = `${line}L${x(last.date.getTime()).toFixed(2)},${padT + innerH}L${x(points[0].date.getTime()).toFixed(2)},${padT + innerH}Z`;

	const yTickCount = 5;
	const yTicks = Array.from(
		{ length: yTickCount },
		(_, index) => minY + ((maxY - minY) * index) / (yTickCount - 1),
	);

	const xStep = spanT > week * 18 ? week * 2 : week;
	const xTicks: number[] = [];
	const start = new Date(minT);
	start.setHours(0, 0, 0, 0);
	let tick = start.getTime();
	while (tick < minT) tick += xStep;
	for (; tick <= maxT + 1; tick += xStep) xTicks.push(tick);
	if (xTicks.length === 0) xTicks.push(minT, maxT);

	const formatX = (time: number) => {
		const date = new Date(time);
		return `${date.getMonth() + 1}/${date.getDate()}`;
	};

	return `
		<div class="h-52 overflow-hidden text-xs sm:h-56">
			<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="h-full w-full overflow-hidden text-chart" role="figure">
				<defs>
					<clipPath id="grade-clip">
						<rect x="${padL}" y="${padT}" width="${innerW}" height="${innerH}" />
					</clipPath>
					<linearGradient id="grade-fill" x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stop-color="currentColor" stop-opacity="0.35" />
						<stop offset="100%" stop-color="currentColor" stop-opacity="0.02" />
					</linearGradient>
				</defs>
				${yTicks
					.map((value) => {
						const py = y(value);
						return `<g>
							<line x1="${padL}" y1="${py}" x2="${width - padR}" y2="${py}" class="stroke-border" />
							<text x="${padL - 8}" y="${py}" text-anchor="end" dominant-baseline="middle" class="fill-muted-foreground">${Math.round(value)}</text>
						</g>`;
					})
					.join("")}
				<g clip-path="url(#grade-clip)">
					<path d="${area}" fill="url(#grade-fill)" class="opacity-80" />
					<path d="${line}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" />
				</g>
				${points
					.map(
						(point) =>
							`<circle cx="${x(point.date.getTime())}" cy="${y(point.percent)}" r="4" fill="currentColor" />`,
					)
					.join("")}
				${xTicks
					.map((time) => {
						const px = x(Math.min(Math.max(time, minT), maxT));
						return `<g>
							<line x1="${px}" y1="${padT + innerH}" x2="${px}" y2="${padT + innerH + 4}" class="stroke-border" />
							<text x="${px}" y="${height - 8}" text-anchor="middle" class="fill-muted-foreground">${formatX(time)}</text>
						</g>`;
					})
					.join("")}
			</svg>
		</div>
	`;
}

function popover(title: string, body: string, icon: string): string {
	if (!body) return "";
	return `<details class="relative">
		<summary class="flex size-7 cursor-pointer list-none items-center justify-center rounded text-muted-foreground hover:bg-muted" title="${escapeHtml(title)}">${icon}</summary>
		<div class="absolute z-20 mt-1 w-72 rounded border border-border bg-card p-3 text-sm shadow-sm">${escapeHtml(body)}</div>
	</details>`;
}

function assignmentCard(
	assignment: DraftAssignment,
	index: number,
	categories: string[],
	tab: string,
	hypothetical: boolean,
	impact: number | null,
	weightLabels: Record<string, string>,
): string {
	const extra = isExtraCredit(assignment);
	const notScored = assignment.ungraded || assignment.pointsEarned == null;
	const percent = assignmentPercent(assignment);
	const style = categoryStyle(assignment.type, categories);
	const typeOptions =
		!assignment.type || categories.includes(assignment.type)
			? categories
			: [assignment.type, ...categories];
	const overMax =
		assignment.pointsEarned != null &&
		assignment.pointsPossible != null &&
		assignment.pointsPossible > 0 &&
		assignment.pointsEarned > assignment.pointsPossible;
	const barPercent =
		overMax && assignment.pointsPossible
			? (assignment.pointsPossible / assignment.pointsEarned) * 100
			: percent;
	const fill = progressFillClass(percent, extra);
	const track = overMax ? "bg-indigo-700" : "bg-foreground/10";
	const impactClass =
		impact == null ? "" : impact >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
	const impactText =
		impact == null ? "" : `${impact > 0 ? "+" : ""}${impact.toFixed(2)}%`;

	const possibleText = extra
		? `${assignment.pointsEarned ?? 0}/<span class="text-indigo-700 dark:text-indigo-400">${assignment.pointsPossible ?? 0}</span>`
		: notScored
			? assignment.pointsPossible != null
				? `${assignment.pointsPossible}`
				: ""
			: `${assignment.pointsEarned}/${assignment.pointsPossible}`;

	const scores = hypothetical
		? `${scoreStepper("earned", index, "Points earned", assignment.pointsEarned)}
			<span>/</span>
			${scoreStepper("possible", index, "Points possible", assignment.pointsPossible)}`
		: `<span class="tabular-nums" title="${notScored ? "Points possible" : "Points earned/Points possible"}">${possibleText}</span>
			${percent == null || notScored || (extra && assignment.pointsPossible === 0) ? "" : `<span class="tabular-nums text-muted-foreground" title="Assignment grade percentage">${formatGrade(percent)}</span>`}`;

	return `<li class="border-b border-border py-3">
		<div class="flex max-w-full flex-col gap-2 sm:flex-row sm:items-center">
			<div class="flex min-w-0 flex-1 flex-col gap-1">
				<div class="flex flex-wrap items-center gap-1">
					${
						hypothetical && assignment.added
							? `<input data-name="${index}" class="h-8 min-w-40 rounded border border-border bg-background px-2 text-sm" value="${escapeHtml(assignment.name)}" />`
							: `<span>${escapeHtml(assignment.name)}</span>`
					}
					${popover("Teacher comments", assignment.notes, icons.message("size-3.5"))}
				</div>
				<div class="flex flex-wrap items-center gap-1">
					${
						hypothetical && assignment.added
							? `<label class="sr-only" for="type-${index}">Category</label>
								<select id="type-${index}" data-type="${index}" class="h-7 rounded border border-border bg-background px-1.5 text-xs" title="Category">
									${typeOptions
										.map((type) => {
											const weight = weightLabels[type];
											const label = weight ? `${type} · ${weight}` : type;
											return `<option value="${escapeHtml(type)}" ${assignment.type === type ? "selected" : ""}>${escapeHtml(label)}</option>`;
										})
										.join("")}
								</select>`
							: tab === "all" && assignment.type
								? badge(
										`${escapeHtml(assignment.type)}${weightLabels[assignment.type] ? ` · ${escapeHtml(weightLabels[assignment.type])}` : ""}`,
										style.badge,
										"Category",
									)
								: ""
					}
					${notScored ? badge(escapeHtml(assignment.displayScore || "Not Graded"), "bg-purple-100 text-purple-900 dark:bg-purple-900/40 dark:text-purple-100") : ""}
					${extra ? badge("Extra Credit", "bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-100", "Calculated as if zero points were possible") : ""}
					${
						assignment.date
							? badge(
									formatShortDate(assignment.date),
									"bg-muted text-muted-foreground",
									formatDateTitle(assignment.date),
								)
							: ""
					}
				</div>
			</div>
			<div class="flex w-full flex-col items-end gap-1.5 sm:w-auto">
				<div class="flex items-center gap-2 text-sm">
					${hypothetical && assignment.added ? `<button class="text-sm text-muted-foreground underline" data-remove="${index}" type="button">Remove</button>` : ""}
					<span class="${impactClass} min-w-0 tabular-nums" data-impact="${index}" title="Change in overall grade when this assignment was added">${impactText}</span>
					${scores}
				</div>
				${notScored && !hypothetical ? "" : progressBar(barPercent, fill, extra ? "bg-foreground/10" : track, index)}
			</div>
		</div>
	</li>`;
}

export function mountCourseDetail(root: Element, data: Bootstrap): void {
	const official = toDraft(data.course.assignments);
	let draft = toDraft(data.course.assignments);
	let hypothetical = false;
	let pinChart = false;
	let tab = "all";

	function assignments(): DraftAssignment[] {
		return hypothetical ? draft : official;
	}

	function gradeHtml(percent: number | null): string {
		const letter = hypothetical ? null : officialLetter(data.course);
		return `${letter ? `<span class="text-muted-foreground">${escapeHtml(letter)}</span> ` : ""}${escapeHtml(formatGrade(percent))}`;
	}

	function render(): void {
		const course = data.course;
		const list = assignments();
		const result = calculateCourse(course, list);
		const categories = uniqueCategories(list, course.categories.map((category) => category.type));
		const weightLabels: Record<string, string> = {};
		for (const type of categories) {
			const weight = formatCategoryWeight(type, course.categories);
			if (weight) weightLabels[type] = weight;
		}
		const impacts = assignmentImpacts(course, list);
		const now = Date.now();
		const visible = list
			.map((assignment, index) => ({ assignment, index }))
			.sort((a, b) => {
				const delta =
					assignmentTimestamp(b.assignment, now) - assignmentTimestamp(a.assignment, now);
				return delta || b.index - a.index;
			})
			.map(({ assignment }) => assignment)
			.filter((assignment) => tab === "all" || assignment.type === tab);
		const backHref = `/grades${data.period ? `?period=${encodeURIComponent(data.period)}` : ""}`;

		root.innerHTML = `
			<div class="flex flex-1 flex-col">
				<p class="mt-4 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
					<span class="inline-flex items-center gap-1">
						${icons.clock("h-3.5 w-3.5")}
						Updated ${escapeHtml(formatUpdatedAt(data.fetchedAt ?? 0))}
					</span>
					<button class="cursor-pointer underline" data-refresh type="button">Refresh</button>
				</p>
				<div class="bg-background sticky top-0 z-10 border-b border-border py-3">
					<div class="flex items-center justify-between gap-3">
						<div class="flex min-w-0 items-center gap-1">
							<a
								class="inline-flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground no-underline hover:bg-muted hover:text-foreground"
								href="${backHref}"
								aria-label="Back to grades"
							>
								${icons.chevronLeft("h-5 w-5")}
							</a>
							<h1 class="min-w-0 truncate text-lg font-medium">${escapeHtml(displayCourseTitle(course.title))}</h1>
						</div>
						<p class="shrink-0 tabular-nums" data-course-grade>
							${gradeHtml(result.percent)}
						</p>
					</div>
				</div>
				<div class="min-w-0 overflow-hidden ${pinChart ? "bg-background sticky top-14 z-10" : ""}" data-chart>
					${renderChart(gradeHistory(course, list))}
				</div>
				<div class="mt-3 mb-4 flex min-h-9 flex-wrap items-center gap-x-5 gap-y-2">
					<label class="inline-flex items-center gap-2 text-sm">
						<input class="size-4" id="hypothetical-mode" data-hypothetical type="checkbox" ${hypothetical ? "checked" : ""} />
						<span class="${hypothetical ? "font-medium underline" : ""}">Hypothetical mode</span>
					</label>
					<label class="hidden items-center gap-2 text-sm sm:inline-flex">
						<input class="size-4" id="pin-chart" data-pin type="checkbox" ${pinChart ? "checked" : ""} />
						Pin chart to top of screen
					</label>
					${
						hypothetical
							? `<div class="flex items-center gap-3">
								<button class="h-8 rounded border border-border px-2.5 text-sm hover:bg-muted" data-add type="button">Add assignment</button>
								<button class="text-sm text-muted-foreground underline" data-reset type="button">Reset</button>
							</div>`
							: ""
					}
				</div>
				<div class="flex flex-col gap-1">
					<div class="flex max-w-full items-center gap-1 overflow-x-auto border-b border-border">
						<button class="shrink-0 border-b-2 px-2 py-1.5 text-sm ${tab === "all" ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}" data-tab="all" type="button">All</button>
						${categories
							.map((type) => {
								const style = categoryStyle(type, categories);
								const active = tab === type;
								const weight = weightLabels[type];
								return `<button class="inline-flex shrink-0 items-center gap-1.5 border-b-2 px-2 py-1.5 text-sm whitespace-nowrap ${active ? "border-foreground font-medium" : "border-transparent text-muted-foreground"}" data-tab="${escapeHtml(type)}" type="button" title="${weight ? `${escapeHtml(type)} · ${weight} of overall grade` : escapeHtml(type)}"><span class="${style.dot} h-2 w-2 rounded-full"></span>${escapeHtml(type)}${weight ? `<span class="tabular-nums text-muted-foreground">${weight}</span>` : ""}</button>`;
							})
							.join("")}
					</div>
					<ol>
						${
							visible.length === 0
								? `<li class="py-8 text-center text-sm text-muted-foreground">No assignments in this category.</li>`
								: visible
										.map((assignment) =>
											assignmentCard(
												assignment,
												list.indexOf(assignment),
												categories,
												tab,
												hypothetical,
												impacts.get(assignment.id) ?? null,
												weightLabels,
											),
										)
										.join("")
						}
					</ol>
				</div>
			</div>
		`;

		bind();
	}

	function parseScoreInput(raw: string): number | null | undefined {
		const trimmed = raw.trim();
		if (trimmed === "") return null;
		if (trimmed === "." || trimmed === "-" || trimmed === "-.") return undefined;
		const value = Number(trimmed);
		return Number.isFinite(value) ? value : undefined;
	}

	function syncLive(): void {
		const course = data.course;
		const list = assignments();
		const result = calculateCourse(course, list);
		const gradeEl = root.querySelector("[data-course-grade]");
		if (gradeEl) gradeEl.innerHTML = gradeHtml(result.percent);
		const chartEl = root.querySelector("[data-chart]");
		if (chartEl) chartEl.innerHTML = renderChart(gradeHistory(course, list));

		const impacts = assignmentImpacts(course, list);
		for (const [index, assignment] of list.entries()) {
			const extra = isExtraCredit(assignment);
			const percent = assignmentPercent(assignment);
			const impact = impacts.get(assignment.id) ?? null;
			const impactEl = root.querySelector(`[data-impact="${index}"]`);
			if (impactEl) {
				impactEl.className =
					impact == null
						? "min-w-0 tabular-nums"
						: `min-w-0 tabular-nums ${impact >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`;
				impactEl.textContent =
					impact == null ? "" : `${impact > 0 ? "+" : ""}${impact.toFixed(2)}%`;
			}
			const overMax =
				assignment.pointsEarned != null &&
				assignment.pointsPossible != null &&
				assignment.pointsPossible > 0 &&
				assignment.pointsEarned > assignment.pointsPossible;
			const barPercent =
				overMax && assignment.pointsPossible
					? (assignment.pointsPossible / assignment.pointsEarned) * 100
					: percent;
			const fill = progressFillClass(percent, extra);
			const track = extra ? "bg-foreground/10" : overMax ? "bg-indigo-700" : "bg-foreground/10";
			const bar = root.querySelector(`[data-progress="${index}"]`);
			if (bar instanceof HTMLElement) {
				bar.className = `relative h-1.5 w-36 overflow-hidden rounded-sm ${track}`;
				bar.setAttribute("aria-valuenow", String(barPercent ?? 0));
				const fillEl = bar.querySelector("[data-progress-fill]");
				if (fillEl instanceof HTMLElement) {
					fillEl.className = `h-full w-full transition-all ${fill}`;
					fillEl.style.transform = progressTranslate(barPercent);
				}
			}
		}
	}

	function applyScore(index: number, field: "earned" | "possible", raw: string): void {
		const assignment = draft[index];
		const parsed = parseScoreInput(raw);
		if (parsed === undefined) return;
		if (field === "earned") {
			assignment.pointsEarned = parsed;
			assignment.ungraded = parsed == null;
		} else {
			assignment.pointsPossible = parsed;
		}
		syncLive();
	}

	function nudgeScore(index: number, field: "earned" | "possible", delta: number): void {
		const assignment = draft[index];
		if (!assignment) return;
		const current = field === "earned" ? assignment.pointsEarned : assignment.pointsPossible;
		const next = Math.max(0, Number(((current ?? 0) + delta).toFixed(10)));
		if (field === "earned") {
			assignment.pointsEarned = next;
			assignment.ungraded = false;
		} else {
			assignment.pointsPossible = next;
		}
		const input = root.querySelector<HTMLInputElement>(`[data-${field}="${index}"]`);
		if (input) input.value = String(next);
		syncLive();
	}

	function bind(): void {
		root.querySelector("[data-refresh]")?.addEventListener("click", () => {
			const url = new URL(location.href);
			url.searchParams.set("refresh", "1");
			location.assign(url);
		});
		root.querySelector<HTMLInputElement>("[data-hypothetical]")?.addEventListener("change", (event) => {
			hypothetical = (event.currentTarget as HTMLInputElement).checked;
			render();
		});
		root.querySelector<HTMLInputElement>("[data-pin]")?.addEventListener("change", (event) => {
			pinChart = (event.currentTarget as HTMLInputElement).checked;
			render();
		});
		root.querySelector("[data-add]")?.addEventListener("click", () => {
			const types = categoryTypes(data.course);
			draft.push(emptyAssignment(tab !== "all" ? tab : (types[0] ?? "Assignment")));
			hypothetical = true;
			render();
		});
		root.querySelector("[data-reset]")?.addEventListener("click", () => {
			draft = toDraft(data.course.assignments);
			render();
		});
		root.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((button) => {
			button.addEventListener("click", () => {
				tab = button.dataset.tab ?? "all";
				render();
			});
		});
		root.querySelectorAll<HTMLButtonElement>("[data-remove]").forEach((button) => {
			button.addEventListener("click", () => {
				draft.splice(Number(button.dataset.remove), 1);
				render();
			});
		});
		root.querySelectorAll<HTMLInputElement>("[data-earned]").forEach((input) => {
			input.addEventListener("input", () => {
				applyScore(Number(input.dataset.earned), "earned", input.value);
			});
			input.addEventListener("keydown", (event) => {
				if (event.key === "ArrowUp" || event.key === "ArrowDown") {
					event.preventDefault();
					nudgeScore(Number(input.dataset.earned), "earned", event.key === "ArrowUp" ? 1 : -1);
				}
			});
		});
		root.querySelectorAll<HTMLInputElement>("[data-possible]").forEach((input) => {
			input.addEventListener("input", () => {
				applyScore(Number(input.dataset.possible), "possible", input.value);
			});
			input.addEventListener("keydown", (event) => {
				if (event.key === "ArrowUp" || event.key === "ArrowDown") {
					event.preventDefault();
					nudgeScore(Number(input.dataset.possible), "possible", event.key === "ArrowUp" ? 1 : -1);
				}
			});
		});
		root.querySelectorAll<HTMLButtonElement>("[data-step]").forEach((button) => {
			button.addEventListener("mousedown", (event) => event.preventDefault());
			button.addEventListener("click", () => {
				const field = button.dataset.step === "possible" ? "possible" : "earned";
				nudgeScore(Number(button.dataset.index), field, Number(button.dataset.delta) || 1);
			});
		});
		root.querySelectorAll<HTMLInputElement>("[data-name]").forEach((input) => {
			input.addEventListener("change", () => {
				draft[Number(input.dataset.name)].name = input.value;
			});
		});
		root.querySelectorAll<HTMLSelectElement>("[data-type]").forEach((select) => {
			select.addEventListener("change", () => {
				draft[Number(select.dataset.type)].type = select.value;
				render();
			});
		});
	}

	render();
}
