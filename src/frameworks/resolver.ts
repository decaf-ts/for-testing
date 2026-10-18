import {
  configuredFramework,
  FRAMEWORK_ORDER,
  type FrameworkAdapter,
  type FrameworkKind,
} from "./types";
import { createJestAdapter, createJestAdapterAsync } from "./jest/adapter";
import {
  createVitestAdapter,
  createVitestAdapterAsync,
} from "./vitest/adapter";
import {
  createPlaywrightAdapter,
  createPlaywrightAdapterAsync,
} from "./playwright/adapter";

/**
 * @description Sync and async adapter factories by framework kind
 * @constant FACTORIES
 */
const FACTORIES: Record<FrameworkKind, () => FrameworkAdapter> = {
  jest: createJestAdapter,
  vitest: createVitestAdapter,
  playwright: createPlaywrightAdapter,
};

/**
 * @description Dynamic-import adapter factories for ESM-only frameworks
 * @constant ASYNC_FACTORIES
 */
const ASYNC_FACTORIES: Record<FrameworkKind, () => Promise<FrameworkAdapter>> =
  {
    jest: createJestAdapterAsync,
    vitest: createVitestAdapterAsync,
    playwright: createPlaywrightAdapterAsync,
  };

/**
 * @description Environment variable that pins the framework adapter
 * @summary Accepted values: `jest`, `vitest`, `playwright`
 * @constant FRAMEWORK_ENV_KEY
 */
const FRAMEWORK_ENV_KEY = "DECAF_TEST_FRAMEWORK";

let cached: FrameworkAdapter | undefined;

/**
 * @description Type guard for {@link FrameworkKind} string values
 * @param {string | undefined} value the candidate value
 * @return {boolean} true when the value is a supported framework kind
 */
function isFrameworkKind(value: string | undefined): value is FrameworkKind {
  return (
    value === "jest" || value === "vitest" || value === "playwright"
  );
}

/**
 * @description Detects the running test framework from well-known env vars
 * @summary Recognizes jest (`JEST_WORKER_ID`), vitest (`VITEST*`) and
 * Playwright (`TEST_WORKER_INDEX`, `TEST_PARALLEL_INDEX`, `PLAYWRIGHT_*`)
 * runners. Playwright workers only set the `TEST_*` markers by default.
 * @return {FrameworkKind | undefined} the sniffed framework, or undefined
 */
function sniffFramework(): FrameworkKind | undefined {
  const env = process.env;
  if (env.JEST_WORKER_ID || env.JEST_WORKER_ID === "0") return "jest";
  if (env.VITEST || env.VITEST_WORKSPACE_ID || env.VITEST_MODE)
    return "vitest";
  if (
    env.TEST_WORKER_INDEX !== undefined ||
    env.TEST_PARALLEL_INDEX !== undefined ||
    env.PLAYWRIGHT_TEST ||
    env.PLAYWRIGHT_TEST_BASE_URL ||
    env.PLAYWRIGHT_BROWSERS_PATH
  ) {
    return "playwright";
  }
  return undefined;
}

/**
 * @description Reads the explicitly requested framework
 * @summary Prefers the value pinned through {@link configure}, then the
 * `DECAF_TEST_FRAMEWORK` environment variable
 * @return {FrameworkKind | undefined} the requested framework, or undefined
 */
function requestedFramework(): FrameworkKind | undefined {
  const explicit = configuredFramework();
  if (explicit) return explicit;
  const fromEnv = process.env[FRAMEWORK_ENV_KEY]?.trim().toLowerCase();
  return isFrameworkKind(fromEnv) ? fromEnv : undefined;
}

/**
 * @description Builds the ordered framework candidates for resolution
 * @summary A pinned/requested framework yields a single candidate; otherwise
 * the sniffed framework is tried first, followed by the remaining kinds in
 * {@link FRAMEWORK_ORDER}
 * @return {FrameworkKind[]} the candidate order
 */
function candidates(): FrameworkKind[] {
  const requested = requestedFramework();
  if (requested) return [requested];
  const sniffed = sniffFramework();
  if (sniffed) {
    const ordered = [sniffed];
    for (const kind of FRAMEWORK_ORDER) {
      if (kind !== sniffed) ordered.push(kind);
    }
    return ordered;
  }
  return [...FRAMEWORK_ORDER];
}

/**
 * @description Builds the error raised when no adapter can be constructed
 * @return {Error} the descriptive resolution failure
 */
function unsupportedError(): Error {
  return new Error(
    `Unable to resolve a test framework adapter. Supported frameworks: jest, vitest, playwright. ` +
      `Call configure({ framework }) or set ${FRAMEWORK_ENV_KEY}=jest|vitest|playwright.`
  );
}

/**
 * @function resolveAdapterSync
 * @description Resolves the adapter synchronously, which is what test
 * registration requires
 * @summary `it`/`it.report` must register with the host runner while the test
 * module is
 * being evaluated. Tries the explicitly requested or sniffed framework first,
 * then the remaining supported frameworks in order, and finally raises a
 * descriptive error naming both override knobs.
 * @param {boolean} [force=false] bypass the cached adapter and re-resolve
 * @return {FrameworkAdapter} the resolved adapter
 * @throws {Error} when no supported framework is available
 * @memberOf module:for-testing
 */
export function resolveAdapterSync(force = false): FrameworkAdapter {
  if (cached && !force) return cached;
  const errors: string[] = [];
  for (const kind of candidates()) {
    try {
      cached = FACTORIES[kind]();
      return cached;
    } catch (error: unknown) {
      errors.push(`${kind}: ${(error as Error)?.message ?? String(error)}`);
    }
  }
  throw new Error(
    `${unsupportedError().message}\nResolution attempts:\n${errors
      .map((line) => `- ${line}`)
      .join("\n")}`
  );
}

/**
 * @function resolveAdapter
 * @description Resolves the adapter asynchronously so ESM-only frameworks can
 * be imported dynamically
 * @summary Prefers the shared synchronously-resolved instance when one is
 * already available.
 * @return {Promise<FrameworkAdapter>} the resolved adapter
 * @throws {Error} when no supported framework is available
 * @memberOf module:for-testing
 */
export async function resolveAdapter(): Promise<FrameworkAdapter> {
  if (cached) return cached;
  try {
    return resolveAdapterSync();
  } catch {
    // Continue with the dynamic-import fallback below.
  }
  const errors: string[] = [];
  for (const kind of candidates()) {
    try {
      cached = await ASYNC_FACTORIES[kind]();
      return cached;
    } catch (error: unknown) {
      errors.push(`${kind}: ${(error as Error)?.message ?? String(error)}`);
    }
  }
  throw new Error(
    `${unsupportedError().message}\nResolution attempts:\n${errors
      .map((line) => `- ${line}`)
      .join("\n")}`
  );
}

/**
 * @description Returns the cached-or-resolved adapter
 * @summary Shortcut used by the assertion accumulator to reach the host
 * framework's `expect`
 * @return {FrameworkAdapter} the resolved adapter
 * @memberOf module:for-testing
 */
export function getAdapter(): FrameworkAdapter {
  return resolveAdapterSync();
}

/**
 * @description Clears the cached adapter so the next resolution re-resolves
 * @summary Intended for tests that switch frameworks at runtime
 * @return {void}
 * @memberOf module:for-testing
 */
export function resetAdapter(): void {
  cached = undefined;
}
