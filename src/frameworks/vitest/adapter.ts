import type {
  FrameworkAdapter,
  JestConcurrentSignature,
  JestEachSignature,
  PrimitiveMatcher,
  TestFn,
} from "../types";
import { applyMatcher } from "../jest/adapter";

/**
 * @description Loosely-typed shape of vitest's `it`/`test` and `expect`
 * @typedef {Object} AnyFn
 * @summary Captures the optional `skip`/`only`/`todo`/`each`/`concurrent`
 * members and the `getState` hook used to read the current test name
 */
type AnyFn = ((...args: any[]) => any) & {
  skip?: (...args: any[]) => any;
  only?: (...args: any[]) => any;
  todo?: (...args: any[]) => any;
  each?: JestEachSignature;
  concurrent?: JestConcurrentSignature;
  getState?: () => { currentTestName?: string };
};

/**
 * @description The it/expect pair (with `each`) the adapter delegates to
 * @typedef {Object} FrameworkGlobals
 */
type FrameworkGlobals = {
  itFn: AnyFn;
  expectFn: AnyFn;
  each?: JestEachSignature;
};

/**
 * @description Resolves vitest-injected `it`/`expect` globals
 * @summary Works when the vitest config enables `globals: true`
 * @return {FrameworkGlobals | undefined} the globals, or undefined
 */
function resolveVitestGlobals(): FrameworkGlobals | undefined {
  const scope = globalThis as unknown as Record<string, AnyFn | undefined>;
  const itFn = scope.it ?? scope.test;
  const expectFn = scope.expect;
  if (typeof itFn === "function" && typeof expectFn === "function") {
    return {
      itFn,
      expectFn,
      each: itFn.each as JestEachSignature | undefined,
    };
  }
  return undefined;
}

/**
 * @description Loads `it`/`test`/`expect` from `vitest` via CJS require
 * @summary Fallback for consumers without `globals: true`
 * @return {FrameworkGlobals | undefined} the globals, or undefined
 */
function loadVitestModule(): FrameworkGlobals | undefined {
  try {
    if (typeof require !== "function") return undefined;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("vitest") as {
      it?: AnyFn;
      test?: AnyFn;
      expect?: AnyFn;
    };
    const itFn = mod?.it ?? mod?.test;
    if (typeof itFn === "function" && typeof mod?.expect === "function") {
      return {
        itFn,
        expectFn: mod.expect,
        each: itFn.each as JestEachSignature | undefined,
      };
    }
  } catch {
    // ESM-only vitest builds fall back to globals when `globals: true`.
  }
  return undefined;
}

/**
 * @description Builds the vitest adapter over an it/expect pair
 * @summary Mirrors {@link buildJestAdapter}: proxies registration to the
 * vitest `it`/`test` global and applies matchers through the shared
 * jest-compatible matcher applier
 * @param {FrameworkGlobals} globals the resolved it/expect pair
 * @return {FrameworkAdapter} the vitest adapter
 */
function buildVitestAdapter(globals: FrameworkGlobals): FrameworkAdapter {
  const { itFn, expectFn } = globals;
  return {
    kind: "vitest",
    run(name: string, fn: TestFn, timeout?: number) {
      itFn(name, fn, timeout);
    },
    skip(name: string, fn: TestFn, timeout?: number) {
      (itFn.skip ?? itFn)(name, fn, timeout);
    },
    only(name: string, fn: TestFn, timeout?: number) {
      (itFn.only ?? itFn)(name, fn, timeout);
    },
    todo(name: string) {
      if (typeof itFn.todo === "function") {
        itFn.todo(name);
        return;
      }
      (itFn.skip ?? itFn)(name, () => undefined);
    },
    each: globals.each,
    concurrent: itFn.concurrent as JestConcurrentSignature | undefined,
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
        return expectFn.getState?.().currentTestName;
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * @description Creates the vitest adapter from the first available it/expect
 * source
 * @summary Prefers the `vitest` module loaded via require, then
 * vitest-injected globals; throws when neither is available
 * @return {FrameworkAdapter} the vitest adapter
 * @throws {Error} when neither the vitest module nor its globals resolve
 */
export function createVitestAdapter(): FrameworkAdapter {
  const resolved = loadVitestModule() ?? resolveVitestGlobals();
  if (!resolved) {
    throw new Error(
      "Unable to resolve the vitest adapter: install vitest, or enable `globals: true` in the vitest config so its it/expect globals are available."
    );
  }
  return buildVitestAdapter(resolved);
}

/**
 * @description Creates the vitest adapter via dynamic import
 * @summary ESM-friendly variant of {@link createVitestAdapter}; falls back to
 * the sync resolver and its descriptive error
 * @return {Promise<FrameworkAdapter>} the vitest adapter
 */
export async function createVitestAdapterAsync(): Promise<FrameworkAdapter> {
  try {
    const vitestModule = "vitest";
    const mod = (await import(vitestModule)) as unknown as {
      it?: AnyFn;
      test?: AnyFn;
      expect?: AnyFn;
    };
    const itFn = mod?.it ?? mod?.test;
    if (typeof itFn === "function" && typeof mod?.expect === "function") {
      return buildVitestAdapter({
        itFn,
        expectFn: mod.expect,
        each: itFn.each as JestEachSignature | undefined,
      });
    }
  } catch {
    // Fall through to the sync resolver and its descriptive error.
  }
  return createVitestAdapter();
}
