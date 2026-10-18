import type {
  FrameworkAdapter,
  JestConcurrentSignature,
  JestEachSignature,
  PrimitiveMatcher,
  TestFn,
} from "../types";

/**
 * @description Loosely-typed shape of jest's `it`/`test` and `expect` globals
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
  fixme?: (...args: any[]) => any;
  info?: () => { titlePath?: string[]; title?: string };
  getState?: () => { currentTestName?: string };
};

/**
 * @description The it/expect pair the adapter delegates to
 * @typedef {Object} FrameworkGlobals
 */
type FrameworkGlobals = { itFn: AnyFn; expectFn: AnyFn };

/**
 * @description Reads the global scope as a function registry
 * @return {Record<string, AnyFn | undefined>} the global scope
 */
function globalScope(): Record<string, AnyFn | undefined> {
  return globalThis as unknown as Record<string, AnyFn | undefined>;
}

/**
 * @description Resolves jest-injected `it`/`expect` globals
 * @summary Works when jest injects its globals into the module scope
 * @return {FrameworkGlobals | undefined} the globals, or undefined
 */
function resolveJestGlobals(): FrameworkGlobals | undefined {
  const scope = globalScope();
  const itFn = scope.it ?? scope.test;
  const expectFn = scope.expect;
  if (typeof itFn === "function" && typeof expectFn === "function") {
    return { itFn, expectFn };
  }
  return undefined;
}

/**
 * @description Loads `it`/`expect` from `@jest/globals` via CJS require
 * @summary Fallback for repositories whose modules do not receive jest
 * globals
 * @return {FrameworkGlobals | undefined} the globals, or undefined
 */
function loadJestGlobalsModule(): FrameworkGlobals | undefined {
  try {
    if (typeof require !== "function") return undefined;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("@jest/globals") as {
      it?: AnyFn;
      expect?: AnyFn;
    };
    if (typeof mod?.it === "function" && typeof mod?.expect === "function") {
      return { itFn: mod.it, expectFn: mod.expect };
    }
  } catch {
    // The globals fallback below covers repositories without @jest/globals.
  }
  return undefined;
}

/**
 * @description Applies a primitive matcher to a jest `expect` instance
 * @summary Shared by the jest and vitest adapters, which expose the same
 * matcher vocabulary; throws on unknown matcher kinds
 * @param {any} expectInstance the bound `expect(actual)` result
 * @param {boolean} negated whether to route the matcher through `.not`
 * @param {PrimitiveMatcher<unknown>} matcher the matcher to apply
 * @return {void}
 */
export function applyMatcher(
  expectInstance: any,
  negated: boolean,
  matcher: PrimitiveMatcher<unknown>
): void {
  const target = negated ? expectInstance.not : expectInstance;
  switch (matcher.kind) {
    case "toBe":
      target.toBe(matcher.expected);
      return;
    case "toEqual":
      target.toEqual(matcher.expected);
      return;
    case "toContain":
      target.toContain(matcher.expected);
      return;
    case "toBeGreaterThan":
      target.toBeGreaterThan(matcher.expected);
      return;
    case "toBeGreaterThanOrEqual":
      target.toBeGreaterThanOrEqual(matcher.expected);
      return;
    case "toBeLessThan":
      target.toBeLessThan(matcher.expected);
      return;
    case "toBeLessThanOrEqual":
      target.toBeLessThanOrEqual(matcher.expected);
      return;
    case "toBeDefined":
      target.toBeDefined();
      return;
    case "toBeTruthy":
      target.toBeTruthy();
      return;
    default: {
      const unreachable: never = matcher;
      throw new Error(`Unsupported matcher: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * @description Builds the jest adapter over an it/expect pair
 * @summary Proxies `run`/`skip`/`only`/`todo` to the `it` global, applies
 * matchers through the `expect` global and reads the current test name from
 * `expect.getState()`
 * @param {AnyFn} itFn the jest `it`/`test` function
 * @param {AnyFn} expectFn the jest `expect` function
 * @return {FrameworkAdapter} the jest adapter
 */
function buildJestAdapter(
  itFn: AnyFn,
  expectFn: AnyFn
): FrameworkAdapter {
  const each = itFn.each as JestEachSignature | undefined;

  return {
    kind: "jest",
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
    each,
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
 * @description Creates the jest adapter from the first available it/expect
 * source
 * @summary Prefers `@jest/globals` loaded via require, then jest-injected
 * globals; throws when neither is available
 * @return {FrameworkAdapter} the jest adapter
 * @throws {Error} when neither `@jest/globals` nor the jest globals resolve
 */
export function createJestAdapter(): FrameworkAdapter {
  const resolved = loadJestGlobalsModule() ?? resolveJestGlobals();
  if (!resolved) {
    throw new Error(
      "Unable to resolve the jest adapter: neither @jest/globals nor the jest-injected it/expect globals are available."
    );
  }
  return buildJestAdapter(resolved.itFn, resolved.expectFn);
}

/**
 * @description Creates the jest adapter via dynamic import
 * @summary ESM-friendly variant of {@link createJestAdapter}; falls back to
 * the sync resolver and its descriptive error
 * @return {Promise<FrameworkAdapter>} the jest adapter
 */
export async function createJestAdapterAsync(): Promise<FrameworkAdapter> {
  try {
    const jestGlobalsModule = "@jest/globals";
    const mod = (await import(jestGlobalsModule)) as unknown as {
      it?: AnyFn;
      expect?: AnyFn;
    };
    if (typeof mod?.it === "function" && typeof mod?.expect === "function") {
      return buildJestAdapter(mod.it, mod.expect);
    }
  } catch {
    // Fall through to the sync resolver and its descriptive error.
  }
  return createJestAdapter();
}
