import fs from "node:fs";
import path from "node:path";
import {
  buildAssetBuckets,
  DEFAULT_ASSETS_PATH,
  DEFAULT_JUNIT_PATH,
  findExistingAssociatedPrecondition,
  parseJunitFile,
  type ParsedTestCase,
} from "./jestTestImporter";

const XRAY_AUTH_URL = "https://xray.cloud.getxray.app/api/v2/authenticate";
const XRAY_IMPORT_URL = "https://xray.cloud.getxray.app/api/v2/import/execution";
const XRAY_GRAPHQL_URL = "https://xray.cloud.getxray.app/api/v2/graphql";

/**
 * @description Represents the Xray-specific execution import envelope
 * @summary Xray provider payload: the parsed tests (without
 * preconditions, which Xray manages through its own associations) plus an
 * optional test execution key
 * @typedef {Object} XrayPayload
 * @property {Array<Omit<ParsedTestCase, "preconditions">>} tests the
 * parsed test results to import
 * @property {string} [testExecutionKey] the Xray Test Execution issue to
 * attach the results to
 * @memberOf module:for-testing
 */
type XrayPayload = {
  tests: Array<Omit<ParsedTestCase, "preconditions">>;
  testExecutionKey?: string;
};

/**
 * @description Reads the Xray OAuth client credentials from the
 * `XRAY_CLIENT_ID`/`XRAY_CLIENT_SECRET` environment variables
 * @summary Returns null (with a warning) when either variable is missing,
 * so the teardown degrades to a local payload write only
 * @return {object | null} the trimmed credentials, or null
 * @memberOf module:for-testing
 */
const getXrayCredentials = (): { clientId: string; clientSecret: string } | null => {
  const clientId = process.env.XRAY_CLIENT_ID?.trim();
  const clientSecret = process.env.XRAY_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    console.warn(
      "⚠️ XRAY_CLIENT_ID and/or XRAY_CLIENT_SECRET are missing; skipping Xray synchronization."
    );
    return null;
  }

  return { clientId, clientSecret };
};

/**
 * @description Exchanges the OAuth client credentials for an Xray API
 * bearer token
 * @summary Posts the credentials to the Xray authenticate endpoint and
 * returns the raw token text
 * @param {string} clientId the Xray client id
 * @param {string} clientSecret the Xray client secret
 * @return {Promise<string>} the bearer token
 * @throws {Error} when authentication fails
 * @memberOf module:for-testing
 */
const fetchXrayToken = async (
  clientId: string,
  clientSecret: string
): Promise<string> => {
  const response = await fetch(XRAY_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to authenticate with Xray (${response.status}): ${text}`);
  }

  return text.replace(/"/g, "").trim();
};

/**
 * @description Resolves the Xray bearer token when credentials are
 * configured
 * @summary Returns undefined when credentials are missing, skipping the
 * remote upload entirely
 * @return {Promise<string | undefined>} the token, or undefined
 * @memberOf module:for-testing
 */
const getXrayTokenForReporting = async (): Promise<string | undefined> => {
  const credentials = getXrayCredentials();
  if (!credentials) return undefined;
  return fetchXrayToken(credentials.clientId, credentials.clientSecret);
};

/**
 * @description Uploads the written payload to the Xray execution import
 * endpoint
 * @summary No-op without a token; otherwise posts the JSON payload with
 * the bearer token
 * @param {string} payloadPath the path of the written payload file
 * @param {string} [token] the Xray bearer token
 * @return {Promise<void>} resolves once the upload completed
 * @throws {Error} when the upload fails
 * @memberOf module:for-testing
 */
const pushPayloadToXray = async (payloadPath: string, token?: string): Promise<void> => {
  if (!token) return;

  const payload = fs.readFileSync(payloadPath, "utf8");
  const response = await fetch(XRAY_IMPORT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: payload,
  });
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to upload results to Xray (${response.status}): ${responseText}`);
  }
  console.log(`✅ Uploaded payload to Xray (${response.status} ${response.statusText}).`);
};

/**
 * @description Runs a GraphQL query against the Xray API
 * @summary No-op (null) without a token; otherwise posts the query and
 * returns the `data` field of the response
 * @param {string | undefined} token the Xray bearer token
 * @param {string} query the GraphQL query text
 * @param {Record<string, unknown>} [variables] the GraphQL variables
 * @return {Promise<Record<string, unknown> | null>} the response data, or
 * null
 * @throws {Error} when the request fails or the response carries errors
 * @memberOf module:for-testing
 */
const runXrayGraphql = async (
  token: string | undefined,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<Record<string, unknown> | null> => {
  if (!token) return null;

  const response = await fetch(XRAY_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to call Xray GraphQL (${response.status}): ${body}`);
  }

  const parsed = body ? JSON.parse(body) : {};
  if (Array.isArray(parsed.errors) && parsed.errors.length) {
    throw new Error(`Xray GraphQL error: ${JSON.stringify(parsed.errors)}`);
  }

  return parsed.data || null;
};

/**
 * @description Verifies that every parsed precondition is already linked
 * to its test in Xray
 * @summary Looks each test up via GraphQL and warns when a parsed
 * precondition key has no matching existing association — preconditions
 * are expected to be created and linked in Jira/Xray beforehand
 * @param {Array<ParsedTestCase>} tests the parsed test cases
 * @param {string} [token] the Xray bearer token
 * @return {Promise<void>} resolves once every test with preconditions was
 * checked
 * @memberOf module:for-testing
 */
const syncPreconditionsToXray = async (
  tests: ParsedTestCase[],
  token?: string
): Promise<void> => {
  if (!token) return;

  const testsWithPreconditions = tests.filter(
    (test) => Array.isArray(test.preconditions) && test.preconditions.length
  );
  if (!testsWithPreconditions.length) return;

  const lookupQuery = `
    query FindTestByKey($jql: String!) {
      getTests(jql: $jql, limit: 1) {
        results {
          issueId
          testType {
            name
          }
          preconditions(limit: 100) {
            results {
              issueId
              definition
              jira(fields: ["key", "summary"])
            }
          }
        }
      }
    }
  `;

  for (const test of testsWithPreconditions) {
    const lookup = await runXrayGraphql(token, lookupQuery, {
      jql: `key = "${test.testKey}"`,
    });
    const targetTest = (lookup as Record<string, unknown> | null)?.getTests as
      | { results?: Array<{ issueId?: string; preconditions?: { results?: Array<{ jira?: unknown }> } }> }
      | undefined;
    const firstTest = targetTest?.results?.[0];

    if (!firstTest?.issueId) {
      console.warn(
        `⚠️ Unable to locate Xray Test ${test.testKey}; skipping precondition sync.`
      );
      continue;
    }

    for (const precondition of test.preconditions) {
      const existing = findExistingAssociatedPrecondition(
        firstTest.preconditions?.results,
        precondition.key
      );

      if (existing) continue;

      console.warn(
        `⚠️ No linked Xray precondition matched key "${precondition.key}" for ${test.testKey}. Existing preconditions are expected to be created and linked in Jira/Xray already.`
      );
    }
  }
};

/**
 * @description Writes the import payload to disk, creating parent
 * directories as needed
 * @summary Persists the JSON payload and logs the test and evidence counts
 * @param {XrayPayload} payload the payload to write
 * @param {string} target the destination file path
 * @return {void}
 * @memberOf module:for-testing
 */
const writePayload = (payload: XrayPayload, target: string): void => {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(payload, null, 2));
  const evidenceCount = payload.tests.reduce(
    (sum, test) =>
      sum +
      ((test.evidence && test.evidence.length) || 0) +
      test.steps.reduce(
        (stepSum, step) => stepSum + ((step.evidences && step.evidences.length) || 0),
        0
      ),
    0
  );
  console.log(
    `✅ Wrote ${target} (${payload.tests.length} tests, ${evidenceCount} evidences).`
  );
};

/**
 * @description The Xray teardown: converts the Jest JUnit report and
 * evidence directory into an Xray execution import payload and uploads it
 * @summary Gated by `ENABLE_XRAY_REPORT === "true"`; reads the JUnit
 * report (`JUNIT_PATH` fallback {@link DEFAULT_JUNIT_PATH}) and the
 * evidence root (`ASSETS__PATH`/`TEST_REPORTER_STORAGE_PATH` fallback
 * {@link DEFAULT_ASSETS_PATH}), builds the provider-agnostic test-case
 * model, and always writes the payload to
 * `workdocs/reports/evidences/tests/xray.json`. When
 * `XRAY_CLIENT_ID`/`XRAY_CLIENT_SECRET` are configured the payload is
 * uploaded to Xray Cloud and the parsed preconditions are verified against
 * the existing associations; without credentials the local payload is the
 * final artifact. The Test Execution issue can be forced through
 * `XRAY_TEST_EXECUTION_KEY`/`TEST_EXECUTION_KEY`.
 * @return {Promise<void>} resolves when the teardown completed
 * @throws {Error} when the JUnit file is missing or the Xray
 * authentication/upload/GraphQL calls fail
 * @memberOf module:for-testing
 */
export const runJestXrayTeardown = async (): Promise<void> => {
  const reportEnabled = process.env.ENABLE_XRAY_REPORT === "true";
  if (!reportEnabled) {
    console.log("🦘🦘🦘 Xray reporting is disabled; skipping teardown. 🦘🦘🦘");
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
    throw new Error(`JUnit file not found at ${junitPath}`);
  }

  const buckets = buildAssetBuckets(assetsPath);
  const tests = await parseJunitFile(junitPath, buckets);

  const payload: XrayPayload = {
    tests: tests.map((test) => {
      const payloadTest = { ...test } as Partial<ParsedTestCase>;
      delete payloadTest.preconditions;
      return payloadTest as Omit<ParsedTestCase, "preconditions">;
    }),
  };
  const executionKey = process.env.XRAY_TEST_EXECUTION_KEY || process.env.TEST_EXECUTION_KEY;
  if (executionKey) {
    payload.testExecutionKey = executionKey;
  }

  const outputPath = path.resolve("workdocs/reports/evidences/tests/xray.json");
  writePayload(payload, outputPath);
  const xrayToken = await getXrayTokenForReporting();
  await pushPayloadToXray(outputPath, xrayToken);
  await syncPreconditionsToXray(tests, xrayToken);
};

export default runJestXrayTeardown;
