import fs from "node:fs";
import path from "node:path";
import {
  buildAssetBuckets,
  DEFAULT_ASSETS_PATH,
  DEFAULT_JUNIT_PATH,
  parseJunitFile,
  type ParsedTestCase,
} from "../testImporter";

/**
 * @typedef {"xray"|"agiletest"} PosttestTarget
 * @description The supported test-management providers
 * @memberOf module:for-testing
 */
export type PosttestTarget = "xray" | "agiletest";

/**
 * @typedef {Object} ProviderPayload
 * @description The shared provider import envelope
 * @summary Xray and AgileTest consume the same payload shape; only the
 * upload transport differs
 * @property {Array<Omit<ParsedTestCase, "preconditions">>} tests the parsed
 * test results to import
 * @property {string} [testExecutionKey] the provider Test Execution issue key
 * @memberOf module:for-testing
 */
export type ProviderPayload = {
  tests: Array<Omit<ParsedTestCase, "preconditions">>;
  testExecutionKey?: string;
};

/**
 * @description Default payload output paths by provider
 * @constant DEFAULT_OUTPUT_PATHS
 * @type {Record<PosttestTarget, string>}
 * @memberOf module:for-testing
 */
export const DEFAULT_OUTPUT_PATHS: Record<PosttestTarget, string> = {
  xray: "workdocs/reports/evidences/tests/xray.json",
  agiletest: "workdocs/reports/evidences/tests/agiletest.json",
};

/**
 * @description Maximum number of characters of a provider response body that
 * is echoed into an error message
 * @constant PROVIDER_RESPONSE_MAX
 * @type {number}
 * @memberOf module:for-testing
 */
export const PROVIDER_RESPONSE_MAX = 2000;

/**
 * @description Bounds a provider-controlled response body before it is
 * embedded in an error message
 * @summary Provider errors can echo arbitrarily large (or hostile) bodies into
 * CLI output and logs. The body is trimmed and truncated to
 * {@link PROVIDER_RESPONSE_MAX}, with the discarded length reported.
 * @param {string} body the response body
 * @param {number} [max=PROVIDER_RESPONSE_MAX] the maximum retained length
 * @return {string} the bounded body
 * @memberOf module:for-testing
 */
export function boundResponseBody(
  body: string,
  max: number = PROVIDER_RESPONSE_MAX
): string {
  const text = typeof body === "string" ? body.trim() : String(body ?? "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [truncated ${text.length - max} characters]`;
}

/**
 * @interface PosttestOptions
 * @description Options for the shared post-test engine
 * @summary Every knob falls back to its environment variable, then to the
 * built-in defaults
 * @property {string} [junitPath] JUnit XML emitted by jest, vitest or
 * Playwright
 * @property {string} [evidenceRoot] root of the stored evidence files
 * @property {string} [outputPath] destination of the generated provider
 * payload
 * @property {string} [executionKey] provider Test Execution issue key
 * @property {boolean} [upload] upload the payload to the provider (requires
 * credentials)
 * @property {boolean} [dryRun] parse only; do not write or upload
 * @memberOf module:for-testing
 */
export interface PosttestOptions {
  /** JUnit XML emitted by jest, vitest or Playwright */
  junitPath?: string;
  /** root of the stored evidence files */
  evidenceRoot?: string;
  /** destination of the generated provider payload */
  outputPath?: string;
  /** provider Test Execution issue key */
  executionKey?: string;
  /** upload the payload to the provider (requires credentials) */
  upload?: boolean;
  /** parse only; do not write or upload */
  dryRun?: boolean;
}

/**
 * @interface PosttestResult
 * @description Outcome of a post-test run
 * @summary Reports where the inputs were read from, what was parsed, and
 * whether the payload was written and/or uploaded
 * @property {PosttestTarget} target the provider the run targeted
 * @property {string} junitPath the resolved JUnit report path
 * @property {string} evidenceRoot the resolved evidence root
 * @property {string} outputPath the resolved payload output path
 * @property {ParsedTestCase[]} tests the parsed test cases
 * @property {ProviderPayload} payload the built import envelope
 * @property {boolean} written whether the payload was written to disk
 * @property {boolean} uploaded whether the payload was uploaded
 * @memberOf module:for-testing
 */
export interface PosttestResult {
  target: PosttestTarget;
  junitPath: string;
  evidenceRoot: string;
  outputPath: string;
  tests: ParsedTestCase[];
  payload: ProviderPayload;
  written: boolean;
  uploaded: boolean;
}

/**
 * @description Resolves the JUnit report path
 * @summary Falls back to `JUNIT_PATH`, then {@link DEFAULT_JUNIT_PATH}
 * @param {string} [explicit] explicit path from the caller
 * @return {string} the absolute JUnit report path
 * @memberOf module:for-testing
 */
export function resolveJunitPath(explicit?: string): string {
  return path.resolve(explicit || process.env.JUNIT_PATH || DEFAULT_JUNIT_PATH);
}

/**
 * @description Resolves the evidence root directory
 * @summary Falls back to `ASSETS__PATH`, then
 * `TEST_REPORTER_STORAGE_PATH`, then {@link DEFAULT_ASSETS_PATH}
 * @param {string} [explicit] explicit root from the caller
 * @return {string} the absolute evidence root
 * @memberOf module:for-testing
 */
export function resolveEvidenceRoot(explicit?: string): string {
  return path.resolve(
    explicit ||
      process.env.ASSETS__PATH ||
      process.env.TEST_REPORTER_STORAGE_PATH ||
      DEFAULT_ASSETS_PATH
  );
}

/**
 * @description Resolves the payload output path for a provider
 * @summary Falls back to the provider entry of {@link DEFAULT_OUTPUT_PATHS}
 * @param {PosttestTarget} target the provider
 * @param {string} [explicit] explicit path from the caller
 * @return {string} the absolute output path
 * @memberOf module:for-testing
 */
export function resolveOutputPath(
  target: PosttestTarget,
  explicit?: string
): string {
  return path.resolve(explicit || DEFAULT_OUTPUT_PATHS[target]);
}

/**
 * @description Resolves the Test Execution issue key for a provider
 * @summary Falls back to the provider-specific env var
 * (`XRAY_TEST_EXECUTION_KEY` / `AGILETEST_TEST_EXECUTION_KEY`), then the
 * shared `TEST_EXECUTION_KEY`
 * @param {PosttestTarget} target the provider
 * @param {string} [explicit] explicit key from the caller
 * @return {string | undefined} the execution key, or undefined
 * @memberOf module:for-testing
 */
export function executionKeyFor(
  target: PosttestTarget,
  explicit?: string
): string | undefined {
  const fromEnv =
    target === "xray"
      ? process.env.XRAY_TEST_EXECUTION_KEY
      : process.env.AGILETEST_TEST_EXECUTION_KEY;
  return explicit || fromEnv || process.env.TEST_EXECUTION_KEY || undefined;
}

/**
 * @function parse
 * @description Parses a JUnit report into the provider-agnostic test-case
 * model
 * @summary The parsed cases are enriched
 * with the evidence buckets stored under `evidenceRoot`.
 * @param {string} junitPath the absolute JUnit report path
 * @param {string} evidenceRoot the absolute evidence root
 * @return {Promise<ParsedTestCase[]>} the parsed and enriched test cases
 * @throws {Error} when the JUnit file is missing
 * @memberOf module:for-testing
 */
export async function parse(
  junitPath: string,
  evidenceRoot: string
): Promise<ParsedTestCase[]> {
  if (!fs.existsSync(junitPath)) {
    throw new Error(`JUnit file not found at ${junitPath}`);
  }
  const buckets = buildAssetBuckets(evidenceRoot);
  return parseJunitFile(junitPath, buckets);
}

/**
 * @function buildProviderPayload
 * @description Builds a provider import envelope from the parsed test cases
 * @summary Promotion
 * targets (Xray and AgileTest) consume the same model, so the payload shape is
 * shared and only the upload transport differs.
 * @param {ParsedTestCase[]} tests the parsed test cases
 * @param {string} [executionKey] the Test Execution issue key, when known
 * @return {ProviderPayload} the import envelope
 * @memberOf module:for-testing
 */
export function buildProviderPayload(
  tests: ParsedTestCase[],
  executionKey?: string
): ProviderPayload {
  const payload: ProviderPayload = {
    tests: tests.map((test) => {
      const payloadTest = { ...test } as Partial<ParsedTestCase>;
      delete payloadTest.preconditions;
      return payloadTest as Omit<ParsedTestCase, "preconditions">;
    }),
  };
  if (executionKey) payload.testExecutionKey = executionKey;
  return payload;
}

/**
 * @description Writes the provider payload to disk
 * @summary Creates the output directory when missing, serializes the payload
 * as pretty-printed JSON and logs a summary with the evidence count
 * @param {ProviderPayload} payload the import envelope
 * @param {string} target the absolute output path
 * @return {void}
 * @memberOf module:for-testing
 */
export function writePayload(payload: ProviderPayload, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(payload, null, 2));
  const evidenceCount = payload.tests.reduce(
    (sum, test) =>
      sum +
      ((test.evidence && test.evidence.length) || 0) +
      test.steps.reduce(
        (stepSum, step) =>
          stepSum + ((step.evidences && step.evidences.length) || 0),
        0
      ),
    0
  );
  console.log(
    `✅ Wrote ${target} (${payload.tests.length} tests, ${evidenceCount} evidences).`
  );
}

/**
 * @description Upload transport supplied by each provider
 * @summary Receives the written payload path and pushes it to the provider
 * @memberOf module:for-testing
 */
export type ProviderUploader = (payloadPath: string) => Promise<void>;

/**
 * @function runPosttest
 * @description Shared post-test engine behind the file/library teardowns and
 * the `decaf test report xray|agiletest` CLI commands
 * @summary Parsing, payload building and
 * writing live here; each provider only supplies an uploader.
 * @param {PosttestTarget} target the provider to build the payload for
 * @param {ProviderUploader} uploader the provider upload transport
 * @param {PosttestOptions} [options] path/execution-key/upload overrides
 * @return {Promise<PosttestResult>} the run outcome
 * @throws {Error} when the JUnit file is missing or the upload fails
 * @memberOf module:for-testing
 */
export async function runPosttest(
  target: PosttestTarget,
  uploader: ProviderUploader,
  options: PosttestOptions = {}
): Promise<PosttestResult> {
  const junitPath = resolveJunitPath(options.junitPath);
  const evidenceRoot = resolveEvidenceRoot(options.evidenceRoot);
  const outputPath = resolveOutputPath(target, options.outputPath);
  const tests = await parse(junitPath, evidenceRoot);
  const payload = buildProviderPayload(
    tests,
    executionKeyFor(target, options.executionKey)
  );

  if (options.dryRun) {
    return {
      target,
      junitPath,
      evidenceRoot,
      outputPath,
      tests,
      payload,
      written: false,
      uploaded: false,
    };
  }

  writePayload(payload, outputPath);
  let uploaded = false;
  if (options.upload) {
    await uploader(outputPath);
    uploaded = true;
  }

  return {
    target,
    junitPath,
    evidenceRoot,
    outputPath,
    tests,
    payload,
    written: true,
    uploaded,
  };
}
