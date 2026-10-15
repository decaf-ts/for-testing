import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  PerformanceRunner,
  type HandlerPayload,
  type HandlerResult,
  type PerformanceScenario,
  type Phase,
  type PhaseConfig,
  type PhaseResult,
} from "@decaf-ts/utils";

/** The desktop viewport used unless a storyboard entry overrides it. */
export const DESKTOP_VIEWPORT = { width: 1440, height: 900 } as const;
const OPERATION_TIMEOUT_MS = 15_000;
const OVERLAY_ID = "__decaf_storyboard_overlay__";

/** A deliberately small Playwright-compatible surface; this package has no Playwright runtime dependency. */
export interface StoryboardPage {
  locator(selector: string): any;
  keyboard: { press(key: string): Promise<void> };
  goto(url: string, options?: Record<string, unknown>): Promise<unknown>;
  screenshot(options: Record<string, unknown>): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  waitForURL(url: RegExp, options?: Record<string, unknown>): Promise<unknown>;
  setViewportSize(viewport: { width: number; height: number }): Promise<unknown>;
  evaluate<R>(fn: any, arg?: unknown): Promise<R>;
  route(url: string, handler: (route: any) => Promise<void>): Promise<void>;
  unroute(url: string): Promise<void>;
  context(): { browser(): any; addInitScript(script: () => void): Promise<unknown> };
}

export type StoryboardAction =
  | { type: "click"; selector: string; text?: string | RegExp; nth?: number; timeout?: number }
  | { type: "fill"; selector: string; value: string; nth?: number; timeout?: number }
  | { type: "press"; key: string; selector?: string }
  | { type: "select"; selector: string; value?: string; label?: string; nth?: number }
  | { type: "check"; selector: string; nth?: number }
  | { type: "scrollIntoView"; selector: string }
  | { type: "wait"; ms: number }
  | { type: "waitForSelector"; selector: string; state?: "attached" | "detached" | "visible" | "hidden"; timeout?: number }
  | { type: "waitForUrl"; pattern: string }
  | { type: "setViewport"; width: number; height: number };

export interface StoryboardHighlight {
  selector: string;
  label?: string;
  number?: boolean;
  padding?: number;
  radius?: number;
  color?: string;
}

export interface StoryboardScenario {
  id: string;
  section: string;
  title: string;
  description?: string;
  notes?: string[];
  alt?: string;
  route: string;
  actions?: StoryboardAction[];
  highlights?: StoryboardHighlight[];
  numbering?: boolean;
  labels?: boolean;
  fullPage?: boolean;
  waitUntil?: "load" | "domcontentloaded" | "networkidle" | "commit";
  settleMs?: number;
  scenarioTimeoutMs?: number;
  scrollTo?: string;
  viewport?: { width: number; height: number };
  setup?: (page: StoryboardPage, config: StoryboardConfig) => Promise<void> | void;
  teardown?: (page: StoryboardPage, config: StoryboardConfig) => Promise<void> | void;
}

export interface StoryboardSection { title: string; intro?: string }
export interface StoryboardConfig {
  title: string;
  intro?: string;
  sections?: StoryboardSection[];
  baseUrl?: string;
  guideFile: string;
  screenshotsDir: string;
  viewport?: { width: number; height: number };
  scenarioTimeoutMs?: number;
  translations?: Record<string, string>;
  scenarios: StoryboardScenario[];
}
export interface StoryboardContext { page: StoryboardPage; baseUrl: string; screenshotsDir: string; config: StoryboardConfig }
export interface StoryboardMeta {
  scenarioId: string; section: string; title: string; description: string; notes: string[]; alt: string;
  screenshot: string; numbering: boolean; labels: boolean; highlighted: number; requested: number; warnings: string[];
}

const target = (page: StoryboardPage, selector: string, nth?: number) => {
  const locator = page.locator(selector);
  return typeof nth === "number" ? locator.nth(nth) : locator.first();
};

export async function applyStoryboardAction(page: StoryboardPage, action: StoryboardAction): Promise<void> {
  switch (action.type) {
    case "click": { let locator = page.locator(action.selector); if (action.text !== undefined) locator = locator.filter({ hasText: action.text }); await (typeof action.nth === "number" ? locator.nth(action.nth) : locator.first()).click({ timeout: action.timeout ?? OPERATION_TIMEOUT_MS }); return; }
    case "fill": await target(page, action.selector, action.nth).fill(action.value, { timeout: action.timeout ?? OPERATION_TIMEOUT_MS }); return;
    case "press": if (action.selector) await target(page, action.selector).press(action.key); else await page.keyboard.press(action.key); return;
    case "select": await target(page, action.selector, action.nth).selectOption(action.value ?? { label: action.label }); return;
    case "check": await target(page, action.selector, action.nth).check(); return;
    case "scrollIntoView": await target(page, action.selector).scrollIntoViewIfNeeded({ timeout: OPERATION_TIMEOUT_MS }); return;
    case "wait": await page.waitForTimeout(action.ms); return;
    case "waitForSelector": await target(page, action.selector).waitFor({ state: action.state ?? "visible", timeout: action.timeout ?? OPERATION_TIMEOUT_MS }); return;
    case "waitForUrl": await page.waitForURL(new RegExp(action.pattern), { timeout: OPERATION_TIMEOUT_MS }); return;
    case "setViewport": await page.setViewportSize({ width: action.width, height: action.height }); return;
  }
}

const installTranslations = async (page: StoryboardPage, translations?: Record<string, string>) => {
  await page.unroute("**/assets/i18n/*.json").catch(() => undefined);
  if (!translations || !Object.keys(translations).length) return;
  await page.route("**/assets/i18n/*.json", async (route) => {
    const response = await route.fetch();
    let body: Record<string, unknown> = {};
    try { body = await response.json(); } catch { /* an empty response is valid */ }
    await route.fulfill({ response, json: { ...body, ...translations } });
  });
};

const clearHighlights = (page: StoryboardPage) => page.evaluate((id: string) => (globalThis as any).document.getElementById(id)?.remove(), OVERLAY_ID).catch(() => undefined);

const drawHighlights = async (page: StoryboardPage, highlights: StoryboardHighlight[], numbering: boolean, labels: boolean): Promise<string[]> => {
  const items: any[] = []; const warnings: string[] = []; let number = 0;
  for (const highlight of highlights) {
    const locator = target(page, highlight.selector);
    if (!(await locator.count())) { warnings.push(`highlight selector not found: ${highlight.selector}`); continue; }
    await locator.scrollIntoViewIfNeeded({ timeout: OPERATION_TIMEOUT_MS }).catch(() => undefined);
    const box = await locator.boundingBox({ timeout: OPERATION_TIMEOUT_MS });
    if (!box) { warnings.push(`highlight selector has no box: ${highlight.selector}`); continue; }
    const offset = await page.evaluate<{ x: number; y: number }>(() => ({ x: (globalThis as any).scrollX, y: (globalThis as any).scrollY }));
    number++;
    items.push({ left: box.x + offset.x, top: box.y + offset.y, width: box.width, height: box.height, padding: highlight.padding ?? 4, radius: highlight.radius ?? 8, color: highlight.color ?? "#e11d48", number: (highlight.number ?? numbering) ? number : undefined, label: labels ? highlight.label : undefined });
  }
  await page.evaluate(({ items, overlayId }: any) => {
    const document = (globalThis as any).document; document.getElementById(overlayId)?.remove(); const overlay = document.createElement("div"); overlay.id = overlayId;
    Object.assign(overlay.style, { position: "absolute", top: "0", left: "0", zIndex: "2147483647", pointerEvents: "none" });
    for (const item of items) {
      const box = document.createElement("div"); Object.assign(box.style, { position: "absolute", left: `${item.left - item.padding}px`, top: `${item.top - item.padding}px`, width: `${item.width + item.padding * 2}px`, height: `${item.height + item.padding * 2}px`, border: `2px solid ${item.color}`, borderRadius: `${item.radius}px`, boxSizing: "border-box", boxShadow: "0 0 0 1px rgba(255,255,255,.65),0 4px 14px rgba(0,0,0,.18)" }); overlay.appendChild(box);
      if (item.number !== undefined) { const badge = document.createElement("div"); badge.textContent = String(item.number); Object.assign(badge.style, { position: "absolute", left: `${item.left - item.padding - 13}px`, top: `${item.top - item.padding - 13}px`, minWidth: "22px", height: "22px", borderRadius: "11px", background: item.color, color: "white", font: "600 12px/22px system-ui", textAlign: "center" }); overlay.appendChild(badge); }
      if (item.label) { const label = document.createElement("div"); label.textContent = item.label; Object.assign(label.style, { position: "absolute", left: `${item.left}px`, top: `${item.top + item.height + item.padding + 10}px`, maxWidth: "240px", padding: "4px 10px", borderRadius: "6px", background: "#0f172a", color: "#f8fafc", font: "500 12px/1.35 system-ui", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }); overlay.appendChild(label); }
    } document.body.appendChild(overlay);
  }, { items, overlayId: OVERLAY_ID });
  return warnings;
};

const cell = (value: string) => value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n+/g, "<br>").trim();
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-");
export function renderStoryboardGuide(config: StoryboardConfig, results: PhaseResult<StoryboardContext>[]): string {
  const entries = results.flatMap((result) => result.iterationMetrics.map((metric) => metric.meta as unknown as StoryboardMeta).filter((meta) => meta?.scenarioId));
  const guideDir = path.dirname(path.resolve(process.cwd(), config.guideFile));
  const imageRoot = path.relative(guideDir, path.resolve(process.cwd(), config.screenshotsDir)).split(path.sep).join("/");
  const ordered = [...(config.sections ?? []).map(({ title }) => title), ...entries.map(({ section }) => section).filter((section, index, all) => !all.slice(0, index).includes(section))].filter((value, index, all) => all.indexOf(value) === index);
  const intro = new Map((config.sections ?? []).filter((s) => s.intro).map((s) => [s.title, s.intro!]));
  const image = (entry: StoryboardMeta) => `![${cell(entry.alt)}](./${path.posix.join(imageRoot, `${entry.scenarioId}.png`)})`;
  const lines = [`# ${config.title}`, ""];
  if (config.intro) lines.push(config.intro.trimEnd(), "");
  if (ordered.length) lines.push("## Table of Contents", ...ordered.map((title) => `- [${title}](#${slug(title)})`), "");
  for (const section of ordered) {
    const sectionEntries = entries.filter((entry) => entry.section === section); if (!sectionEntries.length && !intro.has(section)) continue;
    lines.push(`# ${section}`, ""); if (intro.has(section)) lines.push(intro.get(section)!.trimEnd(), "");
    if (sectionEntries.length === 1) { const entry = sectionEntries[0]; lines.push(`## ${entry.title}`, "", image(entry), ""); if (entry.description) lines.push(entry.description.trimEnd(), ""); if (entry.notes.length) lines.push("**Notes**", "", ...entry.notes.map((note) => `- ${note}`), ""); }
    else if (sectionEntries.length) { lines.push("|  |  |", "| --- | --- |"); sectionEntries.forEach((entry, index) => { const text = [`**${cell(entry.title)}**`, entry.description && cell(entry.description), entry.notes.length && `**Notes**<br>${entry.notes.map((note) => `- ${cell(note)}`).join("<br>")}`].filter(Boolean).join("<br><br>"); lines.push(index % 2 ? `| ${text} | ${image(entry)} |` : `| ${image(entry)} | ${text} |`); }); lines.push(""); }
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

const frontmatter = async (file: string) => { try { const text = await readFile(file, "utf8"); return text.match(/^---\r?\n[\s\S]*?\r?\n---(?=\r?\n|$)/)?.[0] ?? null; } catch { return null; } };
const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: () => string) => { let timer: ReturnType<typeof setTimeout> | undefined; try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message())), timeoutMs); })]); } finally { if (timer) clearTimeout(timer); } };

/** Executes storyboard entries sequentially and writes their screenshots and Markdown guide. */
export class StoryboardRunner extends PerformanceRunner<StoryboardContext> {
  private readonly performanceScenario: PerformanceScenario<StoryboardContext>;
  constructor(readonly config: StoryboardConfig) {
    const scenario: PerformanceScenario<StoryboardContext> = { name: config.title, failOnError: true, enableCanvas: false, baseContext: { page: undefined as unknown as StoryboardPage, baseUrl: config.baseUrl ?? "", screenshotsDir: config.screenshotsDir, config }, phases: config.scenarios.map((entry, scenarioIndex) => ({ name: entry.title, config: { iterations: 1, mode: "sequential", metadata: { scenarioIndex } } satisfies PhaseConfig<StoryboardContext> })) as Phase<StoryboardContext>[], handler: (payload) => this.capture(payload) };
    super(scenario); this.performanceScenario = scenario;
  }
  async runWithPage(page: StoryboardPage, baseUrl?: string) { this.performanceScenario.baseContext = { page, baseUrl: this.config.baseUrl ?? baseUrl ?? "", screenshotsDir: this.config.screenshotsDir, config: this.config }; return this.run(); }
  buildGuide(results: PhaseResult<StoryboardContext>[]) { return renderStoryboardGuide(this.config, results); }
  protected override shouldRenderCanvas() { return false; }
  protected override async logSummary(results: PhaseResult<StoryboardContext>[]) { const file = path.resolve(process.cwd(), this.config.guideFile); await mkdir(path.dirname(file), { recursive: true }); const existing = await frontmatter(file); await writeFile(file, `${existing ? `${existing}\n\n` : ""}${this.buildGuide(results)}`, "utf8"); }
  private async capture(payload: HandlerPayload<StoryboardContext>): Promise<HandlerResult> {
    const entry = payload.context.config.scenarios[Number(payload.config.metadata?.["scenarioIndex"] ?? 0)]; const browser = payload.context.page.context().browser(); if (!browser) throw new Error("Storyboard requires a Playwright page attached to a browser");
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: entry.viewport ?? this.config.viewport ?? DESKTOP_VIEWPORT }); const page: StoryboardPage = await context.newPage(); const warnings: string[] = []; let step = "setup";
    try { return await withTimeout((async () => { await installTranslations(page, this.config.translations); await page.context().addInitScript(() => { localStorage.clear(); sessionStorage.clear(); }); if (entry.setup) await entry.setup(page, this.config); const url = /^https?:\/\//.test(entry.route) ? entry.route : `${payload.context.baseUrl}${entry.route}`; step = `navigate to ${url}`; await page.goto(url, { waitUntil: entry.waitUntil ?? "networkidle", timeout: OPERATION_TIMEOUT_MS }); step = "actions"; for (const action of entry.actions ?? []) await applyStoryboardAction(page, action); if (entry.settleMs) await page.waitForTimeout(entry.settleMs); const highlights = entry.highlights ?? []; const scrollTo = entry.scrollTo ?? highlights[0]?.selector; if (scrollTo) await target(page, scrollTo).scrollIntoViewIfNeeded({ timeout: OPERATION_TIMEOUT_MS }).catch(() => undefined); step = "highlights"; warnings.push(...await drawHighlights(page, highlights, entry.numbering ?? highlights.length > 1, entry.labels ?? false)); step = "screenshot"; const screenshot = path.resolve(process.cwd(), this.config.screenshotsDir, `${entry.id}.png`); await mkdir(path.dirname(screenshot), { recursive: true }); await page.screenshot({ path: screenshot, fullPage: entry.fullPage ?? false, timeout: OPERATION_TIMEOUT_MS }); return { success: true, meta: { scenarioId: entry.id, section: entry.section, title: entry.title, description: entry.description ?? "", notes: entry.notes ?? [], alt: entry.alt ?? entry.title, screenshot, numbering: entry.numbering ?? highlights.length > 1, labels: entry.labels ?? false, highlighted: highlights.length - warnings.length, requested: highlights.length, warnings } }; })(), entry.scenarioTimeoutMs ?? this.config.scenarioTimeoutMs ?? 120_000, () => `scenario "${entry.id}" timed out during ${step}`); } finally { await clearHighlights(page); if (entry.teardown) await entry.teardown(page, this.config); await context.close(); }
  }
}
