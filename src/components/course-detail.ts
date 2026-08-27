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
	assignmentTimestamp,
	assignmentPercent,
	displayPercent,
	categoryStyle,
	formatCategoryWeight,
	formatDateTitle,
	formatGrade,
	formatShortDate,
	gradeHistory,
	officialLetter,
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
	return `<span class="inline-flex select-none items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${extra}" ${title ? `title="${escapeHtml(title)}"` : ""}>${text}</span>`;
}

function scoreStepper(
	field: "earned" | "possible",
	index: number,
	label: string,
	value: number | null,
): string {
	return `<span class="min-w-0 flex-1">
		<label class="sr-only" for="${field}-${index}">${escapeHtml(label)}</label>
		<input id="${field}-${index}" data-${field}="${index}" type="number" autocomplete="off" class="h-8 w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring" value="${value ?? ""}" />
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
	return `<div class="relative h-3 w-full overflow-hidden rounded-full border border-border ${track}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"${marked}><div class="h-full w-full transition-all ${fill}" data-progress-fill style="transform: ${progressTranslate(percent)};"></div></div>`;
}

function renderChart(points: { date: Date; percent: number }[], containerWidth = 720): string {
	if (points.length === 0) {
		return `<p class="px-4 py-8 text-center text-sm text-muted-foreground">The graph will appear after an assignment is graded.</p>`;
	}

	const width = Math.max(280, Math.round(containerWidth));
	const height = 340;
	const padL = 46;
	const padR = 16;
	const padT = 18;
	const padB = 34;
	const innerW = width - padL - padR;
	const innerH = height - padT - padB;

	const ys = points.map((point) => point.percent);
	const range = Math.max(...ys) - Math.min(...ys);
	const gradePadding = Math.max(3, range * 0.18);
	const minY = Math.max(0, Math.floor(Math.min(...ys) - gradePadding));
	const maxY = Math.max(...ys) <= 100 ? 100 : Math.ceil(Math.max(...ys) + gradePadding);
	const safeYRange = Math.max(1, maxY - minY);

	const times = points.map((point) => point.date.getTime()).filter(Number.isFinite);
	const minT = times.length ? Math.min(...times) : Date.now();
	const maxT = times.length ? Math.max(...times) : minT;
	const spanT = Math.max(1, maxT - minT);

	const x = (time: number) => points.length === 1 ? padL + innerW / 2 : padL + ((time - minT) / spanT) * innerW;
	const y = (value: number) => padT + ((maxY - value) / safeYRange) * innerH;

	const line = points
		.map(
			(point, index) =>
				`${index ? "L" : "M"}${x(point.date.getTime()).toFixed(2)},${y(point.percent).toFixed(2)}`,
		)
		.join("");
	const last = points[points.length - 1];
	const area = `${line}L${x(last.date.getTime()).toFixed(2)},${padT + innerH}L${x(points[0].date.getTime()).toFixed(2)},${padT + innerH}Z`;

	const yTicks = Array.from({ length: 4 }, (_, index) => maxY - (safeYRange * index) / 3);
	const xTicks = points.length <= 2
		? points
		: [points[0], points[Math.floor((points.length - 1) / 2)], points[points.length - 1]];

	const formatX = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

	return `
		<div class="relative w-full overflow-hidden pb-2" role="group" aria-label="Course grade over time">
			<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" class="block h-[340px] w-full touch-none" role="figure">
				${yTicks
					.map((value) => {
						const py = y(value);
						return `<g>
							<line x1="${padL}" y1="${py}" x2="${width - padR}" y2="${py}" class="stroke-border" vector-effect="non-scaling-stroke" />
							<text x="${padL - 8}" y="${py + 4}" text-anchor="end" class="fill-muted-foreground text-[11px]">${value.toFixed(0)}%</text>
						</g>`;
					})
					.join("")}
				<path d="${area}" style="fill:#2563eb;opacity:.04" />
				<path d="${line}" style="fill:none;stroke:#2563eb;stroke-width:2;stroke-linecap:round;stroke-linejoin:round" vector-effect="non-scaling-stroke" />
				${points
					.map(
						(point) =>
							`<circle cx="${x(point.date.getTime())}" cy="${y(point.percent)}" r="3.5" style="fill:#2563eb" class="stroke-card" stroke-width="2" vector-effect="non-scaling-stroke" />`,
					)
					.join("")}
				${xTicks
					.map((point, index) => {
						const px = x(point.date.getTime());
						const anchor = index === 0 ? "start" : index === xTicks.length - 1 ? "end" : "middle";
						return `<text x="${px}" y="${height - 8}" text-anchor="${anchor}" class="fill-muted-foreground text-[11px]">${formatX(point.date)}</text>`;
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
	weightLabels: Record<string, string>,
): string {
	const extra = isExtraCredit(assignment);
	const notScored = assignment.ungraded || assignment.pointsEarned == null;
	const percent = assignmentPercent(assignment);
	const typeOptions =
		!assignment.type || categories.includes(assignment.type)
			? categories
			: [assignment.type, ...categories];
	const assignmentTone = categoryStyle(assignment.type, categories);
	const categorySelect = hypothetical
		? `<label class="flex min-w-0 items-center gap-2 sm:w-60" for="type-${index}"><span class="size-2 shrink-0 rounded-full ${assignmentTone.dot}" aria-hidden="true"></span><span class="sr-only">Category</span><select id="type-${index}" data-type="${index}" class="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm font-medium text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring" title="Category">${typeOptions.map((type) => {
			const weight = weightLabels[type];
			const label = weight ? `${type} · ${weight}` : type;
			return `<option value="${escapeHtml(type)}" ${assignment.type === type ? "selected" : ""}>${escapeHtml(label)}</option>`;
		}).join("")}</select></label>`
		: "";
	const barPercent = percent == null ? null : Math.min(Math.max(percent, 0), 100);
	const fill = "bg-primary";
	const track = "bg-muted";

	const possibleText = extra
		? `${assignment.pointsEarned ?? 0}/<span class="text-indigo-700 dark:text-indigo-400">${assignment.pointsPossible ?? 0}</span>`
		: notScored
			? assignment.pointsPossible != null
				? `${assignment.pointsPossible}`
				: ""
			: `${assignment.pointsEarned}/${assignment.pointsPossible}`;

	const scores = hypothetical
		? `<div class="mt-2 flex items-center gap-1.5">${scoreStepper("earned", index, "Points earned", assignment.pointsEarned)}<span class="text-muted-foreground">/</span>${scoreStepper("possible", index, "Points possible", assignment.pointsPossible)}</div>`
		: notScored
			? `<div class="mt-2 flex justify-between text-xs text-muted-foreground"><span>${assignment.pointsEarned ?? "—"}/${assignment.pointsPossible ?? "—"}</span><span>Not entered</span></div>`
			: `<div class="mt-2 flex justify-between text-xs tabular-nums text-muted-foreground"><span>${possibleText}</span><span>${extra && assignment.pointsPossible === 0 ? "Extra credit" : formatGrade(percent)}</span></div>`;

	return `<li><div class="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:flex-row sm:items-center">
			<div class="min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-1">
					${
						hypothetical && assignment.added
							? `<input data-name="${index}" class="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" value="${escapeHtml(assignment.name)}" />`
							: `<p class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">${escapeHtml(assignment.name)}</p>`
					}
					${popover("Teacher comments", assignment.notes, icons.message("size-3.5"))}
				</div>
				<div class="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
					${
						hypothetical
							? ""
							: assignment.type
								? badge(
										`<span class="mr-1.5 inline-block size-2 rounded-full align-middle ${assignmentTone.dot}" aria-hidden="true"></span>${escapeHtml(assignment.type)}${weightLabels[assignment.type] ? ` · ${escapeHtml(weightLabels[assignment.type])}` : ""}`,
										"border-transparent bg-secondary text-secondary-foreground",
										"Category",
									)
								: ""
					}
					${notScored ? badge("Not graded", "text-foreground") : ""}
					${extra ? badge("Extra credit", "text-foreground", "Calculated as if zero points were possible") : ""}
					${
						assignment.date && !hypothetical
							? badge(
									formatShortDate(assignment.date),
									"text-foreground",
									formatDateTitle(assignment.date),
								)
							: ""
					}
				</div>
			</div>
			<div class="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
				${hypothetical && assignment.date ? `<div class="shrink-0 pb-0.5">${badge(formatShortDate(assignment.date), "text-foreground", formatDateTitle(assignment.date))}</div>` : ""}
				${categorySelect}
				<div class="w-full sm:w-56">
					${progressBar(barPercent, fill, track, index)}
					${scores}
				</div>
			</div>
	</div></li>`;
}

export function mountCourseDetail(root: Element, data: Bootstrap): () => void {
	const official = toDraft(data.course.assignments);
	let draft = toDraft(data.course.assignments);
	let hypothetical = false;
	let tab = "all";
	let chartObserver: ResizeObserver | null = null;
	let gradeAnimationFrame: number | null = null;

	function assignments(): DraftAssignment[] {
		return hypothetical ? draft : official;
	}

	function gradeHtml(percent: number | null): string {
		const letter = hypothetical ? null : officialLetter(data.course);
		return `${escapeHtml(formatGrade(percent, hypothetical ? 1 : 2))}${letter ? ` <span class="text-muted-foreground">(${escapeHtml(letter)})</span>` : ""}`;
	}

	function setHeaderGrade(percent: number | null, animate = false): void {
		const grade = document.querySelector<HTMLElement>("[data-page-grade]");
		if (!grade) return;
		if (gradeAnimationFrame != null) cancelAnimationFrame(gradeAnimationFrame);
		gradeAnimationFrame = null;
		grade.removeAttribute("hidden");
		const previous = Number(grade.dataset.gradeValue);
		grade.dataset.gradeValue = percent == null ? "" : String(percent);
		if (!animate || percent == null || !Number.isFinite(previous) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
			grade.innerHTML = gradeHtml(percent);
			return;
		}
		const startedAt = performance.now();
		const duration = 750;
		const tick = (now: number) => {
			const elapsed = Math.min(1, (now - startedAt) / duration);
			const eased = 1 - Math.pow(1 - elapsed, 5);
			const value = previous + (percent - previous) * eased;
			grade.textContent = formatGrade(value, 1);
			if (elapsed < 1) gradeAnimationFrame = requestAnimationFrame(tick);
			else {
				gradeAnimationFrame = null;
				grade.innerHTML = gradeHtml(percent);
			}
		};
		gradeAnimationFrame = requestAnimationFrame(tick);
	}

	function drawChart(list: DraftAssignment[]): void {
		chartObserver?.disconnect();
		const host = root.querySelector<HTMLElement>("[data-chart-canvas]");
		if (!host) return;
		const points = gradeHistory(data.course, list);
		let previousWidth = 0;
		const paint = () => {
			const width = Math.max(280, Math.round(host.getBoundingClientRect().width));
			if (width === previousWidth) return;
			previousWidth = width;
			host.innerHTML = renderChart(points, width);
		};
		requestAnimationFrame(paint);
		if (typeof ResizeObserver !== "undefined") {
			chartObserver = new ResizeObserver(paint);
			chartObserver.observe(host);
		}
	}

	function render(): void {
		const course = data.course;
		const list = assignments();
		const result = calculateCourse(course, list);
		setHeaderGrade(hypothetical ? result.percent : displayPercent(course));
		const categories = uniqueCategories(list, course.categories.map((category) => category.type));
		const weightLabels: Record<string, string> = {};
		for (const type of categories) {
			const weight = formatCategoryWeight(type, course.categories);
			if (weight) weightLabels[type] = weight;
		}
		const officialPercent = displayPercent(course);
		const trendDifference = !hypothetical && result.percent != null && officialPercent != null
			? result.percent - officialPercent
			: 0;
		const trendNote = Math.abs(trendDifference) >= 0.05
			? `<div class="-mt-2 text-sm"><p class="text-red-500">Trend differs from StudentVUE · calculated ${escapeHtml(formatGrade(result.percent))}, StudentVUE reports ${escapeHtml(formatGrade(officialPercent))}</p><p class="mt-0.5 text-muted-foreground">Hidden, dropped, or otherwise unavailable gradebook data can cause a difference.</p></div>`
			: "";
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
		root.innerHTML = `
			<div class="flex min-h-screen flex-col gap-4 p-4 md:p-6">
				<div class="min-w-0 overflow-hidden" data-chart-canvas></div>
				${trendNote}
				<div class="flex flex-wrap items-center justify-end gap-4">
					<label class="inline-flex cursor-pointer items-center gap-2 text-sm" for="hypothetical-mode">
						<span class="relative box-content size-4 shrink-0">
							<input class="peer box-content size-4 shrink-0 appearance-none rounded-[3px] border border-primary bg-background ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 checked:bg-primary disabled:cursor-not-allowed disabled:opacity-50" id="hypothetical-mode" data-hypothetical type="checkbox" ${hypothetical ? "checked" : ""} />
							<svg class="pointer-events-none absolute inset-0 hidden size-4 stroke-primary-foreground peer-checked:block" viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"></path></svg>
						</span>
						<span class="font-medium">Hypothetical</span>
					</label>
					${
						hypothetical
							? `<div class="flex gap-2">
								<button class="h-8 rounded-md px-3 text-sm font-medium transition-colors hover:bg-muted" data-add type="button">Add Assignment</button>
								<button class="h-8 rounded-md px-3 text-sm font-medium transition-colors hover:bg-muted" data-reset type="button">Reset</button>
							</div>`
							: ""
					}
				</div>
				${list.length > 0 || hypothetical ? `<div class="flex flex-col gap-4">
					<div class="inline-flex h-10 w-fit max-w-full items-center justify-start gap-0 overflow-x-auto rounded-md bg-muted p-1 text-muted-foreground">
						<button class="inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all ${tab === "all" ? "bg-background text-foreground shadow-sm" : ""}" data-tab="all" type="button">All</button>
						${categories
							.map((type) => {
								const active = tab === type;
								const tone = categoryStyle(type, categories);
								return `<button class="inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all ${active ? "bg-background text-foreground shadow-sm" : ""}" data-tab="${escapeHtml(type)}" type="button"><span class="size-2 shrink-0 rounded-full ${tone.dot}" aria-hidden="true"></span>${escapeHtml(type)}</button>`;
							})
							.join("")}
					</div>
					<ol class="flex flex-col gap-3">
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
												weightLabels,
											),
										)
										.join("")
						}
					</ol>
				</div>` : ""}
			</div>
		`;

		drawChart(list);
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
		setHeaderGrade(result.percent, true);
		drawChart(list);

		for (const [index, assignment] of list.entries()) {
			const extra = isExtraCredit(assignment);
			const percent = assignmentPercent(assignment);
			const barPercent = percent == null ? null : Math.min(Math.max(percent, 0), 100);
			const fill = "bg-primary";
			const track = "bg-muted";
			const bar = root.querySelector(`[data-progress="${index}"]`);
			if (bar instanceof HTMLElement) {
				bar.className = `relative h-3 w-full overflow-hidden rounded-full border border-border ${track}`;
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
			assignment.pointsEarned = parsed == null || isExtraCredit(assignment)
				? parsed
				: Math.min(Math.max(parsed, 0), assignment.pointsPossible ?? parsed);
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
		let next = Math.max(0, Number(((current ?? 0) + delta).toFixed(10)));
		if (field === "earned") {
			if (!isExtraCredit(assignment) && assignment.pointsPossible != null) {
				next = Math.min(next, assignment.pointsPossible);
			}
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
			draft = toDraft(data.course.assignments);
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
	return () => {
		chartObserver?.disconnect();
		if (gradeAnimationFrame != null) cancelAnimationFrame(gradeAnimationFrame);
	};
}
