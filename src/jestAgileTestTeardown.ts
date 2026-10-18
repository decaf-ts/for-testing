import { runPosttest, type ProviderPayload } from "./posttest/core";
import { createAgileTestUploader } from "./posttest/agiletest";

/**
 * @description Represents the provider-specific AgileTest import envelope.
 * @summary Alias of the shared provider payload
 * @typedef {Object} AgileTestPayload
 * @property {Array<Omit<ParsedTestCase, "preconditions">>} tests The parsed
 * test cases to import.
 * @property {string} [testExecutionKey] The Test Execution issue to attach the
 * results to.
 * @memberOf module:for-testing
 */
export type AgileTestPayload = ProviderPayload;

/**
 * @description The AgileTest teardown — the free-tier analog of
 * {@link runJestXrayTeardown}. Reads the same JUnit report and evidence
 * directory, builds the same provider-agnostic test-case model, and uploads it
 * to an AgileTest tenant when credentials are configured. Delegates parsing,
 * payload building and writing to the shared post-test engine.
 * @summary Gated by `ENABLE_AGILETEST_REPORT === "true"`.
 * @return {Promise<void>} resolves when the teardown completed
 * @throws {Error} when the JUnit file is missing or the upload fails
 * @memberOf module:for-testing
 */
export const runJestAgileTestTeardown = async (): Promise<void> => {
  const reportEnabled = process.env.ENABLE_AGILETEST_REPORT === "true";
  if (!reportEnabled) {
    console.log(
      "🦘🦘🦘 AgileTest reporting is disabled; skipping teardown. 🦘🦘🦘"
    );
    return;
  }

  await runPosttest("agiletest", createAgileTestUploader(), { upload: true });
};

export default runJestAgileTestTeardown;
