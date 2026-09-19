import fs from "node:fs";
import path from "node:path";
import { InternalError } from "@decaf-ts/db-decorators";
import {
  buildAssetBuckets,
  DEFAULT_ASSETS_PATH,
  DEFAULT_JUNIT_PATH,
  parseJunitFile,
  type ParsedTestCase,
} from "./jestTestImporter";

/**
 * @description Represents the provider-specific AgileTest import envelope.
 * Failure and provider constants are intentionally provider-scoped, mirroring
 * the xray teardown's `XrayPayload`.
 * @summary The AgileTest payload: the parsed test cases (without the Xray-only
 * preconditions) and, optionally, the target Test Execution issue key.
 * @typedef {Object} AgileTestPayload
 * @property {Array<Omit<ParsedTestCase, "preconditions">>} tests The parsed
 * test cases to import.
 * @property {string} [testExecutionKey] The Test Execution issue to attach the
 * results to, when provided through
 * `AGILETEST_TEST_EXECUTION_KEY`/`TEST_EXECUTION_KEY`.
 * @memberOf module:for-testing
 */
export type AgileTestPayload = {
  tests: Array<Omit<ParsedTestCase, "preconditions">>;
  testExecutionKey?: string;
};

const DEFAULT_AGILETEST_BASE_PATH = "/rest/agiletest/1.0";
const DEFAULT_AGILETEST_IMPORT_PATH = "/test/import";

const getAgileTestCredentials = (): {
  host: string;
  email: string;
  apiToken: string;
  basePath: string;
} | null => {
  const host = process.env.AGILETEST_HOST?.trim();
  const email = process.env.AGILETEST_EMAIL?.trim();
  const apiToken = process.env.AGILETEST_API_TOKEN?.trim();

  if (!host || !email || !apiToken) {
    console.warn(
      "⚠️ AGILETEST_HOST/AGILETEST_EMAIL and/or AGILETEST_API_TOKEN are missing; skipping AgileTest synchronization."
    );
    return null;
  }

  return {
    host,
    email,
    apiToken,
    basePath:
      process.env.AGILETEST_BASE_PATH?.trim() || DEFAULT_AGILETEST_BASE_PATH,
  };
};

const authHeader = (email: string, apiToken: string): string => {
  const token = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return `Basic ${token}`;
};

const pushPayloadToAgileTest = async (
  payloadPath: string,
  credentials: {
    host: string;
    email: string;
    apiToken: string;
    basePath: string;
  } | null
): Promise<void> => {
  if (!credentials) return;

  const importPath =
    process.env.AGILETEST_IMPORT_PATH?.trim() || DEFAULT_AGILETEST_IMPORT_PATH;
  const payload = fs.readFileSync(payloadPath, "utf8");
  const response = await fetch(
    `${credentials.host}${credentials.basePath}${importPath}`,
    {
      method: "POST",
      headers: {
        Authorization: authHeader(credentials.email, credentials.apiToken),
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: payload,
    }
  );
  const responseText = await response.text();
  if (!response.ok) {
    throw new InternalError(
      `Failed to upload results to AgileTest (${response.status}): ${responseText}`
    );
  }
  console.log(
    `✅ Uploaded payload to AgileTest (${response.status} ${response.statusText}).`
  );
};

const writePayload = (payload: AgileTestPayload, target: string): void => {
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
};

/**
 * @description The AgileTest teardown — the free-tier analog of
 * {@link runJestXrayTeardown}. Reads the same JUnit report and evidence
 * directory, builds the same provider-agnostic test-case model, and uploads
 * it to an AgileTest tenant. AgileTest (DevSamurai) is a Jira Cloud app
 * mounted at `/rest/agiletest/1.0` and authenticated with Jira Cloud basic
 * auth (account email + API token), so unlike Xray there is no separate
 * OAuth client-id/secret handshake.
 * @summary The upload is skipped when no AgileTest credentials are configured
 * (`AGILETEST_HOST`/`AGILETEST_EMAIL`/`AGILETEST_API_TOKEN`), mirroring the
 * xray teardown's behaviour. The payload is always written to
 * `workdocs/reports/evidences/tests/agiletest.json` so results are never
 * lost even when credentials are absent.
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

  const assetsPathRaw =
    process.env.ASSETS__PATH ||
    process.env.TEST_REPORTER_STORAGE_PATH ||
    DEFAULT_ASSETS_PATH;
  const junitPathRaw = process.env.JUNIT_PATH || DEFAULT_JUNIT_PATH;

  const assetsPath = path.resolve(assetsPathRaw);
  const junitPath = path.resolve(junitPathRaw);

  if (!fs.existsSync(junitPath)) {
    throw new InternalError(`JUnit file not found at ${junitPath}`);
  }

  const buckets = buildAssetBuckets(assetsPath);
  const tests = await parseJunitFile(junitPath, buckets);

  const payload: AgileTestPayload = {
    tests: tests.map((test) => {
      const payloadTest = { ...test } as Partial<ParsedTestCase>;
      delete payloadTest.preconditions;
      return payloadTest as Omit<ParsedTestCase, "preconditions">;
    }),
  };
  const executionKey =
    process.env.AGILETEST_TEST_EXECUTION_KEY || process.env.TEST_EXECUTION_KEY;
  if (executionKey) {
    payload.testExecutionKey = executionKey;
  }

  const outputPath = path.resolve(
    "workdocs/reports/evidences/tests/agiletest.json"
  );
  writePayload(payload, outputPath);
  const credentials = getAgileTestCredentials();
  await pushPayloadToAgileTest(outputPath, credentials);
};

export default runJestAgileTestTeardown;
