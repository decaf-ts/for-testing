import type {
  FrameworkAdapter,
  PrimitiveMatcher,
  TestFn,
} from "../types";
import { applyMatcher } from "../jest/adapter";

/**
 * @description Loosely-typed shape of Playwright's `test` function
 * @typedef {Object} AnyFn
 * @summary Captures the optional `skip`/`only`/`fixme` members and the
 * `info()` hook used to read the current test title
 */
type AnyFn = ((...args: any[]) => any) & {
  skip?: (...args: any[]) => any;
  only?: (...args: any[]) => any;
  fixme?: (...args: any[]) => any;
  info?: () => { titlePath?: string[]; title?: string };
};

/**
 * @description The test/expect pair loaded from `@playwright/test`
 * @typedef {Object} PlaywrightModule
 */
type PlaywrightModule = {
  test?: AnyFn;
  expect?: AnyFn & { configure?: AnyFn };
};

/**
 * @description Resolves Playwright's injected `test`/`expect` globals
 * @summary Works inside Playwright test files that receive the globals
 * @return {PlaywrightModule | undefined} the globals, or undefined
 */
function resolvePlaywrightGlobals(): PlaywrightModule | undefined {
  const scope = globalThis as unknown as Record<string, AnyFn | undefined>;
  const test = scope.test;
  const expect = scope.expect;
  if (typeof test === "function" && typeof expect === "function") {
    return { test, expect };
  }
  return undefined;
}

/**
 * @description Loads `test`/`expect` from `@playwright/test` via CJS require
 * @summary Fallback for consumers that import the package explicitly
 * @return {PlaywrightModule | undefined} the module, or undefined
 */
function loadPlaywrightModule(): PlaywrightModule | undefined {
  try {
    if (typeof require !== "function") return undefined;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@playwright/test") as PlaywrightModule;
    if (typeof mod?.test === "function" && typeof mod?.expect === "function") {
      return { test: mod.test, expect: mod.expect };
    }
  } catch {
    // A missing peer dependency is reported by the caller.
  }
  return undefined;
}

/**
 * @description Builds the Playwright adapter over a test/expect pair
 * @summary Maps `skip`/`only`/`todo` (via `fixme`) onto the `test` global,
 * applies matchers through Playwright's `expect`, and reads the current test
 * name from `test.info()`; `each` is intentionally unsupported
 * @param {PlaywrightModule} mod the resolved test/expect pair
 * @return {FrameworkAdapter} the Playwright adapter
 */
function buildPlaywrightAdapter(mod: PlaywrightModule): FrameworkAdapter {
  const test = mod.test as AnyFn;
  const expectFn = mod.expect as AnyFn;

  return {
    kind: "playwright",
    run(name: string, fn: TestFn) {
      test(name, fn);
    },
    skip(name: string, fn: TestFn) {
      if (typeof test.skip === "function") {
        test.skip(name, fn);
        return;
      }
      test(name, fn);
    },
    only(name: string, fn: TestFn) {
      (test.only ?? test)(name, fn);
    },
    todo(name: string) {
      if (typeof test.fixme === "function") {
        test.fixme(name, () => undefined);
        return;
      }
      (test.skip ?? test)(name, () => undefined);
    },
    // Playwright's runner has no `it.each`; leaving it undefined makes the
    // reported facade raise a descriptive error instead of behaving wrongly.
    each: undefined,
    assert<T>(
      actual: T,
      matcher: PrimitiveMatcher<T>,
      negated: boolean
    ): void {
      applyMatcher(
        expectFn(actual),
        negated,
        matcher as PrimitiveMatcher<unknown>
      );
    },
    currentTestName(): string | undefined {
      try {
        const info = test.info?.();
        const titlePath = info?.titlePath;
        if (Array.isArray(titlePath)) return titlePath.join(" › ");
        return info?.title;
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * @description Creates the Playwright adapter from the first available
 * test/expect source
 * @summary Prefers `@playwright/test` loaded via require, then Playwright's
 * injected globals; throws when neither is available
 * @return {FrameworkAdapter} the Playwright adapter
 * @throws {Error} when `@playwright/test` is not installed
 */
export function createPlaywrightAdapter(): FrameworkAdapter {
  const resolved = loadPlaywrightModule() ?? resolvePlaywrightGlobals();
  if (!resolved) {
    throw new Error(
      "Unable to resolve the @playwright/test adapter: install @playwright/test as a dev dependency of the consuming project."
    );
  }
  return buildPlaywrightAdapter(resolved);
}

/**
 * @description Creates the Playwright adapter via dynamic import
 * @summary ESM-friendly variant of {@link createPlaywrightAdapter}; falls
 * back to the sync resolver and its descriptive error
 * @return {Promise<FrameworkAdapter>} the Playwright adapter
 */
export async function createPlaywrightAdapterAsync(): Promise<FrameworkAdapter> {
  try {
    const playwrightModule = "@playwright/test";
    const mod = (await import(playwrightModule)) as PlaywrightModule;
    if (typeof mod?.test === "function" && typeof mod?.expect === "function") {
      return buildPlaywrightAdapter(mod);
    }
  } catch {
    // Fall through to the sync resolver and its descriptive error.
  }
  return createPlaywrightAdapter();
}
