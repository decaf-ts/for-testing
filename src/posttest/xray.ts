import fs from "node:fs";
import {
  findExistingAssociatedPrecondition,
  type ParsedTestCase,
} from "../testImporter";
import type { ProviderUploader } from "./core";

/**
 * @description Xray Cloud REST endpoints used by the uploader
 * @constant XRAY_AUTH_URL
 */
const XRAY_AUTH_URL = "https://xray.cloud.getxray.app/api/v2/authenticate";
/** @constant XRAY_IMPORT_URL the Xray execution import endpoint */
const XRAY_IMPORT_URL = "https://xray.cloud.getxray.app/api/v2/import/execution";
/** @constant XRAY_GRAPHQL_URL the Xray GraphQL endpoint */
const XRAY_GRAPHQL_URL = "https://xray.cloud.getxray.app/api/v2/graphql";

/**
 * @interface XrayUploader
 * @description The Xray upload transport
 * @summary Adds the precondition verification to the shared
 * {@link ProviderUploader} contract
 * @memberOf module:for-testing
 */
export interface XrayUploader extends ProviderUploader {
  syncPreconditions(tests: ParsedTestCase[]): Promise<void>;
}

/**
 * @description Reads the Xray Cloud credentials from the environment
 * @summary Reads `XRAY_CLIENT_ID` and `XRAY_CLIENT_SECRET`; warns and yields
 * null when either is missing so the local payload remains the final artifact
 * @return {{ clientId: string, clientSecret: string } | null} the
 * credentials, or null when unconfigured
 * @memberOf module:for-testing
 */
export function getXrayCredentials(): {
  clientId: string;
  clientSecret: string;
} | null {
  const clientId = process.env.XRAY_CLIENT_ID?.trim();
  const clientSecret = process.env.XRAY_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    console.warn(
      "⚠️ XRAY_CLIENT_ID and/or XRAY_CLIENT_SECRET are missing; skipping Xray synchronization."
    );
    return null;
  }

  return { clientId, clientSecret };
}

/**
 * @description Authenticates against Xray Cloud
 * @summary Exchanges the client credentials for a bearer token used by the
 * import and GraphQL calls
 * @param {string} clientId the Xray client id
 * @param {string} clientSecret the Xray client secret
 * @return {Promise<string>} the bearer token
 * @throws {Error} when the authentication call fails
 * @memberOf module:for-testing
 */
export async function fetchXrayToken(
  clientId: string,
  clientSecret: string
): Promise<string> {
  const response = await fetch(XRAY_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Failed to authenticate with Xray (${response.status}): ${text}`
    );
  }

  return text.replace(/"/g, "").trim();
}

/**
 * @description Resolves a bearer token for reporting when credentials exist
 * @summary Convenience wrapper over {@link getXrayCredentials} and
 * {@link fetchXrayToken}
 * @return {Promise<string | undefined>} the bearer token, or undefined when
 * unconfigured
 * @memberOf module:for-testing
 */
export async function getXrayTokenForReporting(): Promise<string | undefined> {
  const credentials = getXrayCredentials();
  if (!credentials) return undefined;
  return fetchXrayToken(credentials.clientId, credentials.clientSecret);
}

/**
 * @description Uploads an execution import payload to Xray
 * @summary Posts the JSON payload file with the bearer token; no-op without
 * a token
 * @param {string} payloadPath the written payload file path
 * @param {string} [token] the bearer token
 * @return {Promise<void>} resolves once the upload completed
 * @throws {Error} when the upload call fails
 * @memberOf module:for-testing
 */
export async function pushPayloadToXray(
  payloadPath: string,
  token?: string
): Promise<void> {
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
    throw new Error(
      `Failed to upload results to Xray (${response.status}): ${responseText}`
    );
  }
  console.log(
    `✅ Uploaded payload to Xray (${response.status} ${response.statusText}).`
  );
}

/**
 * @description Calls the Xray GraphQL API
 * @summary No-op (yields null) without a token; throws on transport or
 * GraphQL errors
 * @param {string | undefined} token the bearer token
 * @param {string} query the GraphQL query
 * @param {Record<string, unknown>} [variables] the query variables
 * @return {Promise<Record<string, unknown> | null>} the `data` payload, or
 * null
 * @throws {Error} when the call fails or GraphQL reports errors
 * @memberOf module:for-testing
 */
export async function runXrayGraphql(
  token: string | undefined,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<Record<string, unknown> | null> {
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
}

/**
 * @description Verifies parsed preconditions are linked in Xray
 * @summary For each test with preconditions, looks the test up in Xray and
 * warns when no linked precondition matches the parsed key; no-op without a
 * token. Preconditions themselves are expected to exist and be linked in
 * Jira/Xray already.
 * @param {ParsedTestCase[]} tests the parsed test cases
 * @param {string} [token] the bearer token
 * @return {Promise<void>} resolves once the verification completed
 * @throws {Error} when the GraphQL lookups fail
 * @memberOf module:for-testing
 */
export async function syncPreconditionsToXray(
  tests: ParsedTestCase[],
  token?: string
): Promise<void> {
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
      | {
          results?: Array<{
            issueId?: string;
            preconditions?: { results?: Array<{ jira?: unknown }> };
          }>;
        }
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
}

/**
 * @function createXrayUploader
 * @description Builds the Xray upload transport over the shared post-test
 * engine
 * @summary The
 * bearer token is resolved lazily and memoized so the payload upload and the
 * precondition verification share one authentication round-trip.
 * @return {XrayUploader} the Xray upload transport
 * @memberOf module:for-testing
 */
export function createXrayUploader(): XrayUploader {
  let tokenPromise: Promise<string | undefined> | undefined;
  const token = () => (tokenPromise ??= getXrayTokenForReporting());

  const upload = async (payloadPath: string): Promise<void> => {
    await pushPayloadToXray(payloadPath, await token());
  };

  return Object.assign(upload, {
    async syncPreconditions(tests: ParsedTestCase[]): Promise<void> {
      await syncPreconditionsToXray(tests, await token());
    },
  });
}
