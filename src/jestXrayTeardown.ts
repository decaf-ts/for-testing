import { runPosttest, type ProviderPayload } from "./posttest/core";
import { createXrayUploader } from "./posttest/xray";

/**
 * @description Represents the Xray-specific execution import envelope
 * @summary Alias of the shared provider payload
 * @typedef {Object} XrayPayload
 * @property {Array<Omit<ParsedTestCase, "preconditions">>} tests the parsed
 * test results to import
 * @property {string} [testExecutionKey] the Xray Test Execution issue
 * @memberOf module:for-testing
 */
export type XrayPayload = ProviderPayload;

/**
 * @description The Xray teardown: converts the JUnit report and evidence
 * directory into an Xray execution import payload and uploads it
 * @summary Gated by `ENABLE_XRAY_REPORT === "true"`. Delegates parsing,
 * payload building and writing to the shared post-test engine, then uploads
 * and verifies the parsed preconditions. The local payload is always written
 * to `workdocs/reports/evidences/tests/xray.json`; without Xray credentials
 * the local payload is the final artifact.
 * @return {Promise<void>} resolves when the teardown completed
 * @throws {Error} when the JUnit file is missing or the Xray calls fail
 * @memberOf module:for-testing
 */
export const runJestXrayTeardown = async (): Promise<void> => {
  const reportEnabled = process.env.ENABLE_XRAY_REPORT === "true";
  if (!reportEnabled) {
    console.log("🦘🦘🦘 Xray reporting is disabled; skipping teardown. 🦘🦘🦘");
    return;
  }

  const uploader = createXrayUploader();
  const result = await runPosttest("xray", uploader, { upload: true });
  await uploader.syncPreconditions(result.tests);
};

export default runJestXrayTeardown;
