import { Command } from "commander";
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
  const config = await loadStoryboardConfig(file, options);
  let playwright: any;
  try { const packageName = "playwright"; playwright = await import(packageName); } catch { throw new Error("Running a storyboard requires the optional peer dependency \"playwright\". Install it in the consuming project: npm install -D playwright"); }
  const browser = await playwright[options.browser ?? "chromium"].launch({ headless: !options.headed }); const context = await browser.newContext();
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

  if (resolved === "xray") {
    const uploader = createXrayUploader();
    const result = await runPosttest(resolved, uploader, {
      junitPath: options.junit,
      evidenceRoot: options.evidences,
      outputPath: options.out,
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
    junitPath: options.junit,
    evidenceRoot: options.evidences,
    outputPath: options.out,
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
