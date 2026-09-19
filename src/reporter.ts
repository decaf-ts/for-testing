import {
  TestReporter,
  TestReporterStorageEnabledEnvKey,
  TestReporterStoragePathEnvKey,
} from "./TestReporter";

/**
 * @description Module-scoped reporter instance installed by
 * {@link setReporter} and consumed by {@link getReporter}
 * @summary Holds the test-scoped {@link TestReporter} used by the jest
 * helpers to persist reports and evidences
 * @memberOf module:for-testing
 */
let reporter: TestReporter;

/**
 * @description Ensures the reporter evidence-storage env vars are set
 * @summary Defaults `TEST_REPORTER_STORAGE_ENABLED` and
 * `TEST_REPORTER_STORAGE_PATH` to the {@link TestReporter} static values
 * when not already configured, so evidence collection is on for tests
 * using the jest helpers
 * @return {Promise<void>} resolves once the env vars are ensured
 * @memberOf module:for-testing
 */
export async function ensureReporterCollectsEvidencesConfig() {
  process.env[TestReporterStorageEnabledEnvKey] =
    process.env[TestReporterStorageEnabledEnvKey] ??
    TestReporter.storageEnabled.toString();
  process.env[TestReporterStoragePathEnvKey] =
    process.env[TestReporterStoragePathEnvKey] ?? TestReporter.storagePath;
}

/**
 * @description Sleeps for the number of milliseconds configured in the
 * `SLEEP` environment variable
 * @summary No-op without `SLEEP`; used to keep containers alive long
 * enough for evidence collection before teardown
 * @return {Promise<void>} resolves once the sleep completed
 * @throws {Error} when `SLEEP` is not a non-negative integer
 * @memberOf module:for-testing
 */
export async function waitForConfiguredSleep() {
  const sleep = process.env["SLEEP"]?.trim();
  if (!sleep) return;

  const sleepMs = Number(sleep);
  if (!Number.isInteger(sleepMs) || sleepMs < 0) {
    throw new Error("SLEEP must be a non-negative integer in milliseconds");
  }

  if (sleepMs === 0) return;
  console.warn(`wait for ${sleepMs}`);
  await new Promise((resolve) => setTimeout(resolve, sleepMs));
}

/**
 * @description Installs the test-scoped reporter instance
 * @summary Records the {@link TestReporter} later returned by
 * {@link getReporter}, typically in a jest setup file
 * @param {TestReporter} rep the reporter to install
 * @return {void}
 * @memberOf module:for-testing
 */
export function setReporter(rep: TestReporter) {
  reporter = rep;
}

/**
 * @description Returns the test-scoped reporter instance
 * @summary Yields the {@link TestReporter} previously installed through
 * {@link setReporter}
 * @return {TestReporter} the installed reporter (undefined when never set)
 * @memberOf module:for-testing
 */
export function getReporter() {
  return reporter;
}

/**
 * @description Reports a chain assertion outcome and throws on failure
 * @summary Writes the response and report objects through the reporter and
 * throws when the report carries at least one failed assertion, so a
 * {@link ReportExpect} chain surfaces as a test failure with the full
 * report attached
 * @param {TestReporter} reporter the reporter to write through
 * @param {object} report the chain report exposing
 * `getStatus`, `getReport` and `checkHasError`
 * @param {any} response the raw response to include in the report object
 * @param {Record<string, any>} [reportKeyValuePairs] extra key/value pairs
 * merged into the report object
 * @return {Promise<void>} resolves once both objects were reported
 * @throws {Error} when the report has errors
 * @memberOf module:for-testing
 */
export async function reportObjects(
  reporter: TestReporter,
  report: { getStatus(): "Passed" | "Failed"; getReport(): string; checkHasError(): boolean },
  response: any,
  reportKeyValuePairs?: Record<string, any>
) {
  await reporter.reportObject("response", {
    status: report?.getStatus(),
    report: report?.getReport(),
  });

  const reportObject: Record<string, any> = {
    status: response?.status,
    report: report?.getReport(),
    response: response?.data,
  };

  if (reportKeyValuePairs) {
    Object.keys(reportKeyValuePairs).forEach((pair) => {
      reportObject[pair] = reportKeyValuePairs[pair];
    });
  }

  await reporter.reportObject("report", reportObject);

  if (report.checkHasError()) {
    throw new Error("One or more assertions failed. See the report for details.");
  }
}
