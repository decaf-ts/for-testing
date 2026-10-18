import {
  TestReporter,
  TestReporterStorageEnabledEnvKey,
  TestReporterStoragePathEnvKey,
} from "./TestReporter";

export { getReporter, setReporter } from "./registry";


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
