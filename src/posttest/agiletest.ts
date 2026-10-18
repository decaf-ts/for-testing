import fs from "node:fs";
import { InternalError } from "@decaf-ts/db-decorators";
import { boundResponseBody, type ProviderUploader } from "./core";

/**
 * @description Default AgileTest REST base path
 * @constant DEFAULT_AGILETEST_BASE_PATH
 */
const DEFAULT_AGILETEST_BASE_PATH = "/rest/agiletest/1.0";
/**
 * @description Default AgileTest import endpoint path
 * @constant DEFAULT_AGILETEST_IMPORT_PATH
 */
const DEFAULT_AGILETEST_IMPORT_PATH = "/test/import";

/**
 * @interface AgileTestCredentials
 * @description AgileTest tenant credentials read from the environment
 * @property {string} host the tenant base URL
 * @property {string} email the API user email
 * @property {string} apiToken the API token
 * @property {string} basePath the REST base path
 * @memberOf module:for-testing
 */
export interface AgileTestCredentials {
  host: string;
  email: string;
  apiToken: string;
  basePath: string;
}

/**
 * @description Reads the AgileTest credentials from the environment
 * @summary Reads `AGILETEST_HOST`, `AGILETEST_EMAIL` and
 * `AGILETEST_API_TOKEN` (plus the optional `AGILETEST_BASE_PATH`); warns and
 * yields null when any is missing so the local payload remains the final
 * artifact
 * @return {AgileTestCredentials | null} the credentials, or null when
 * unconfigured
 * @memberOf module:for-testing
 */
export function getAgileTestCredentials(): AgileTestCredentials | null {
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
}

/**
 * @description Builds the AgileTest Basic auth header value
 * @summary Base64-encodes `email:apiToken`
 * @param {string} email the API user email
 * @param {string} apiToken the API token
 * @return {string} the `Basic <token>` header value
 */
function authHeader(email: string, apiToken: string): string {
  const token = Buffer.from(`${email}:${apiToken}`).toString("base64");
  return `Basic ${token}`;
}

/**
 * @description Uploads an execution import payload to AgileTest
 * @summary Posts the JSON payload file with Basic auth; no-op without
 * credentials
 * @param {string} payloadPath the written payload file path
 * @param {AgileTestCredentials | null} credentials the tenant credentials
 * @return {Promise<void>} resolves once the upload completed
 * @throws {InternalError} when the upload call fails
 * @memberOf module:for-testing
 */
export async function pushPayloadToAgileTest(
  payloadPath: string,
  credentials: AgileTestCredentials | null
): Promise<void> {
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
      `Failed to upload results to AgileTest (${response.status}): ${boundResponseBody(responseText)}`
    );
  }
  console.log(
    `✅ Uploaded payload to AgileTest (${response.status} ${response.statusText}).`
  );
}

/**
 * @function createAgileTestUploader
 * @description Builds the AgileTest upload transport over the shared
 * post-test engine
 * @summary Credentials are resolved per call so late configuration is picked
 * up
 * @return {ProviderUploader} the AgileTest upload transport
 * @memberOf module:for-testing
 */
export function createAgileTestUploader(): ProviderUploader {
  return async (payloadPath: string): Promise<void> => {
    await pushPayloadToAgileTest(payloadPath, getAgileTestCredentials());
  };
}
