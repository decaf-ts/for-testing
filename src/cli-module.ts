import { Command } from "commander";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { StoryboardRunner, type StoryboardConfig } from "./ui";

export interface ScenarioRunOptions { baseUrl?: string; guideFile?: string; screenshotsDir?: string; browser?: string; headed?: boolean; timeout?: string }
export const scenarioRunOptions = (config: StoryboardConfig, options: ScenarioRunOptions): StoryboardConfig => ({ ...config, baseUrl: options.baseUrl ?? config.baseUrl, guideFile: options.guideFile ?? config.guideFile, screenshotsDir: options.screenshotsDir ?? config.screenshotsDir, scenarioTimeoutMs: options.timeout ? Number(options.timeout) : config.scenarioTimeoutMs });

export async function loadStoryboardConfig(file: string, options: ScenarioRunOptions = {}): Promise<StoryboardConfig> {
  const mod = await import(pathToFileURL(path.resolve(file)).href);
  const candidate = mod.default ?? mod.storyboard ?? mod.config;
  const config = typeof candidate === "function" ? await candidate(options) : candidate;
  if (!config || !Array.isArray(config.scenarios) || !config.guideFile || !config.screenshotsDir) throw new Error(`Storyboard module ${file} must export a StoryboardConfig (default, storyboard, or config).`);
  return scenarioRunOptions(config, options);
}

async function runStoryboard(file: string, options: ScenarioRunOptions) {
  const config = await loadStoryboardConfig(file, options);
  let playwright: any;
  try { const packageName = "playwright"; playwright = await import(packageName); } catch { throw new Error("Running a storyboard requires the optional peer dependency \"playwright\". Install it in the consuming project: npm install -D playwright"); }
  const browser = await playwright[options.browser ?? "chromium"].launch({ headless: !options.headed }); const context = await browser.newContext();
  try { await new StoryboardRunner(config).runWithPage(await context.newPage(), config.baseUrl); } finally { await context.close(); await browser.close(); }
}

/** Decaf CLI module: `decaf scenario run ./storyboard.mjs --base-url http://localhost:4200`. */
export default function scenario() {
  const module = new Command()
    .name("scenario")
    .description("Generate screenshot tutorials from storyboard definitions");
  module
    .command("run <storyboard>")
    .description("Run a storyboard and write its Markdown tutorial")
    .option("--base-url <url>", "base URL used for relative routes")
    .option("--guide-file <file>", "override the Markdown output path")
    .option("--screenshots-dir <directory>", "override screenshot output directory")
    .option("--browser <name>", "Playwright browser: chromium, firefox, or webkit", "chromium")
    .option("--headed", "show the browser while capturing")
    .option("--timeout <milliseconds>", "default timeout per storyboard entry")
    .action(runStoryboard);
  return module;
}
