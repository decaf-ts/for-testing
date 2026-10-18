import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { StoryboardRunner, type StoryboardConfig } from "./ui";
import {
  runPosttest,
  type PosttestTarget,
} from "./posttest/core";
import { createXrayUploader } from "./posttest/xray";
import { createAgileTestUploader } from "./posttest/agiletest";

/**
 * @interface ScenarioRunOptions
 * @description CLI options of the `decaf test scenario run` command
 * @property {string} [baseUrl] base URL used for relative routes
 * @property {string} [guideFile] override the Markdown output path
 * @property {string} [screenshotsDir] override screenshot output directory
 * @property {string} [browser] Playwright browser: chromium, firefox, or
 * webkit
 * @property {boolean} [headed] show the browser while capturing
 * @property {string} [timeout] default timeout per storyboard entry
 * @memberOf module:for-testing
 */
export interface ScenarioRunOptions { baseUrl?: string; guideFile?: string; screenshotsDir?: string; browser?: string; headed?: boolean; timeout?: string }

/**
 * @description Supported Playwright browser names
 * @constant PLAYWRIGHT_BROWSERS
 */
const PLAYWRIGHT_BROWSERS = ["chromium", "firefox", "webkit"] as const;

/**
 * @description A Playwright browser name accepted by `--browser`
 * @summary One of {@link PLAYWRIGHT_BROWSERS}, as validated by
 * {@link parseBrowser}
 * @typedef {("chromium"|"firefox"|"webkit")} PlaywrightBrowser
 * @memberOf module:for-testing
 */
type PlaywrightBrowser = (typeof PLAYWRIGHT_BROWSERS)[number];

/**
 * @description Environment variable overriding the project root used to
 * confine CLI paths
 * @constant PROJECT_ROOT_ENV_KEY
 */
const PROJECT_ROOT_ENV_KEY = "DECAF_TEST_PROJECT_ROOT";

/**
 * @description Environment variable listing additional allowed path roots,
 * separated by the platform path delimiter
 * @constant ALLOWED_ROOTS_ENV_KEY
 */
const ALLOWED_ROOTS_ENV_KEY = "DECAF_TEST_ALLOWED_ROOTS";

/**
 * @description Validates the `--browser` option
 * @summary Restricts the value to the Playwright browsers the storyboard
 * runner supports, so an unknown value fails with a clear error instead of a
 * property lookup on the Playwright module
 * @param {string} [value] the requested browser name
 * @return {PlaywrightBrowser} the validated browser name
 * @throws {Error} when the value is not a supported browser
 * @memberOf module:for-testing
 */
export function parseBrowser(value?: string): PlaywrightBrowser {
  const browser = (value ?? "chromium").trim().toLowerCase();
  if ((PLAYWRIGHT_BROWSERS as readonly string[]).includes(browser)) {
    return browser as PlaywrightBrowser;
  }
  throw new Error(
    `Unsupported browser "${value}". Expected one of: ${PLAYWRIGHT_BROWSERS.join(", ")}.`
  );
}

/**
 * @description Resolves a path to its real location when possible
 * @summary Existing paths are resolved through `realpath`; for a path that
 * does not exist yet (an output file) the parent directory is resolved. This
 * keeps symlinks from escaping the configured roots.
 * @param {string} target the absolute path to resolve
 * @return {string} the real (or best-effort) path
 */
function realPath(target: string): string {
  const absolute = path.resolve(target);
  const missing: string[] = [];
  let current = absolute;
  while (true) {
    try {
      const real = fs.realpathSync(current);
      return missing.length ? path.join(real, ...missing.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return absolute;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * @description Builds the roots a CLI path may resolve inside
 * @summary The project root (cwd by default) plus any roots listed in
 * {@link ALLOWED_ROOTS_ENV_KEY}
 * @return {string[]} the allowed roots, real-resolved
 */
function allowedPathRoots(): string[] {
  const projectRoot = path.resolve(
    process.env[PROJECT_ROOT_ENV_KEY] || process.cwd()
  );
  const extra = (process.env[ALLOWED_ROOTS_ENV_KEY] || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
  return [projectRoot, ...extra].map(realPath);
}

/**
 * @description Confines a CLI output/input path to the project roots
 * @summary `--junit`, `--evidences` and `--out` come from the command line;
 * resolving them without confinement lets them read or write anywhere the
 * invoking user can. This rejects paths outside the project root (or the
 * roots listed in {@link ALLOWED_ROOTS_ENV_KEY}) before the engine sees them.
 * @param {string} value the caller-supplied path
 * @param {string} option the option name, used in the error message
 * @return {string} the absolute, confined path
 * @throws {Error} when the path escapes every allowed root
 * @memberOf module:for-testing
 */
export function confineCliPath(value: string, option: string): string {
  const resolved = path.resolve(value);
  const candidate = realPath(resolved);
  const roots = allowedPathRoots();
  const within = roots.some(
    (root) => candidate === root || candidate.startsWith(root + path.sep)
  );
  if (!within) {
    throw new Error(
      `Refusing ${option} path "${value}": resolved path "${candidate}" is outside the allowed project roots (${roots.join(", ")}). ` +
        `Use a project-relative path, set ${PROJECT_ROOT_ENV_KEY}, or list additional roots in ${ALLOWED_ROOTS_ENV_KEY}.`
    );
  }
  return resolved;
}

/**
 * @description Merges CLI options over a storyboard configuration
 * @summary Only provided options override the loaded
 * {@link StoryboardConfig}
 * @param {StoryboardConfig} config the loaded storyboard configuration
 * @param {ScenarioRunOptions} options the CLI options
 * @return {StoryboardConfig} the merged configuration
 * @memberOf module:for-testing
 */
export const scenarioRunOptions = (config: StoryboardConfig, options: ScenarioRunOptions): StoryboardConfig => ({ ...config, baseUrl: options.baseUrl ?? config.baseUrl, guideFile: options.guideFile ?? config.guideFile, screenshotsDir: options.screenshotsDir ?? config.screenshotsDir, scenarioTimeoutMs: options.timeout ? Number(options.timeout) : config.scenarioTimeoutMs });

/**
 * @description Loads a storyboard module and merges the CLI options
 * @summary Accepts a default, `storyboard` or `config` export (plain object
 * or factory) and validates the required `scenarios`, `guideFile` and
 * `screenshotsDir` fields
 * @param {string} file the storyboard module path
 * @param {ScenarioRunOptions} [options] the CLI options
 * @return {Promise<StoryboardConfig>} the merged storyboard configuration
 * @throws {Error} when the module does not export a valid
 * {@link StoryboardConfig}
 * @memberOf module:for-testing
 */
export async function loadStoryboardConfig(file: string, options: ScenarioRunOptions = {}): Promise<StoryboardConfig> {
  const mod = await import(pathToFileURL(path.resolve(file)).href);
  const candidate = mod.default ?? mod.storyboard ?? mod.config;
  const config = typeof candidate === "function" ? await candidate(options) : candidate;
  if (!config || !Array.isArray(config.scenarios) || !config.guideFile || !config.screenshotsDir) throw new Error(`Storyboard module ${file} must export a StoryboardConfig (default, storyboard, or config).`);
  return scenarioRunOptions(config, options);
}

async function runStoryboard(file: string, options: ScenarioRunOptions) {
  const browserName = parseBrowser(options.browser);
  const config = await loadStoryboardConfig(file, options);
  let playwright: any;
  try { const packageName = "playwright"; playwright = await import(packageName); } catch { throw new Error("Running a storyboard requires the optional peer dependency \"playwright\". Install it in the consuming project: npm install -D playwright"); }
  const browser = await playwright[browserName].launch({ headless: !options.headed }); const context = await browser.newContext();
  try { await new StoryboardRunner(config).runWithPage(await context.newPage(), config.baseUrl); } finally { await context.close(); await browser.close(); }
}

/**
 * @interface TestReportOptions
 * @description CLI options of the `decaf test report` command
 * @property {string} [junit] JUnit XML report path
 * @property {string} [evidences] evidence root directory
 * @property {string} [out] payload output file
 * @property {string} [executionKey] provider Test Execution issue key
 * @property {boolean} [dryRun] parse only; do not write or upload the payload
 * @property {boolean} [upload] upload the payload to the provider
 * @memberOf module:for-testing
 */
export interface TestReportOptions {
  junit?: string;
  evidences?: string;
  out?: string;
  executionKey?: string;
  dryRun?: boolean;
  upload?: boolean;
}

const SUPPORTED_REPORT_TARGETS: PosttestTarget[] = ["xray", "agiletest"];

/**
 * @description Validates and narrows a report target argument
 * @param {string} target the raw CLI target
 * @return {PosttestTarget} the validated target
 * @throws {Error} when the target is not a supported provider
 */
function parseTarget(target: string): PosttestTarget {
  if ((SUPPORTED_REPORT_TARGETS as string[]).includes(target)) {
    return target as PosttestTarget;
  }
  throw new Error(
    `Unsupported test report target "${target}". Expected one of: ${SUPPORTED_REPORT_TARGETS.join(", ")}.`
  );
}

/**
 * @description Runs the `decaf test report` command action
 * @summary Delegates to {@link runPosttest} with the provider-specific
 * uploader, verifies preconditions after an Xray upload and logs a summary
 * for dry runs
 * @param {string} target the provider target (`xray` or `agiletest`)
 * @param {TestReportOptions} options the CLI options
 * @return {Promise<void>} resolves once the report run completed
 */
async function runTestReport(target: string, options: TestReportOptions) {
  const resolved = parseTarget(target);
  const junitPath = options.junit
    ? confineCliPath(options.junit, "--junit")
    : undefined;
  const evidenceRoot = options.evidences
    ? confineCliPath(options.evidences, "--evidences")
    : undefined;
  const outputPath = options.out
    ? confineCliPath(options.out, "--out")
    : undefined;

  if (resolved === "xray") {
    const uploader = createXrayUploader();
    const result = await runPosttest(resolved, uploader, {
      junitPath,
      evidenceRoot,
      outputPath,
      executionKey: options.executionKey,
      dryRun: options.dryRun,
      upload: options.upload,
    });
    if (result.uploaded) {
      await uploader.syncPreconditions(result.tests);
    }
    if (!result.written) {
      console.log(
        `Parsed ${result.tests.length} tests from ${result.junitPath}; payload would be written to ${result.outputPath}.`
      );
    }
    return;
  }

  const result = await runPosttest(resolved, createAgileTestUploader(), {
    junitPath,
    evidenceRoot,
    outputPath,
    executionKey: options.executionKey,
    dryRun: options.dryRun,
    upload: options.upload,
  });
  if (!result.written) {
    console.log(
      `Parsed ${result.tests.length} tests from ${result.junitPath}; payload would be written to ${result.outputPath}.`
    );
  }
}

/**
 * @function test
 * @description Decaf CLI module: storyboards plus
 * `decaf test report xray|agiletest`
 * @summary Builds the commander module registered under the `test` command
 * name with a `scenario` alias for backwards compatibility
 * @return {Command} the CLI module
 * @memberOf module:for-testing
 */
export default function test() {
  const module = new Command()
    .name("test")
    .alias("scenario")
    .description(
      "Test tooling: screenshot storyboards and JUnit/evidence report imports"
    );

  const scenario = module
    .command("run <storyboard>")
    .description("Run a storyboard and write its Markdown tutorial")
    .option("--base-url <url>", "base URL used for relative routes")
    .option("--guide-file <file>", "override the Markdown output path")
    .option("--screenshots-dir <directory>", "override screenshot output directory")
    .option("--browser <name>", "Playwright browser: chromium, firefox, or webkit", "chromium")
    .option("--headed", "show the browser while capturing")
    .option("--timeout <milliseconds>", "default timeout per storyboard entry");
  scenario.action(runStoryboard);

  const report = module
    .command("report <target>")
    .description("Build a provider import payload from a JUnit report")
    .option("--junit <path>", "JUnit XML report path")
    .option("--evidences <directory>", "evidence root directory")
    .option("--out <file>", "payload output file")
    .option("--execution-key <key>", "provider Test Execution issue key")
    .option("--dry-run", "parse only; do not write or upload the payload")
    .option("--upload", "upload the payload to the provider");
  report.action(runTestReport);

  return module;
}
