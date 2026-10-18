/**
 * @module for-testing/frameworks
 * @description Framework-agnostic seam of the reported-testing API. The module
 * declares the adapter contract implemented by the jest, vitest and Playwright
 * integrations and the configuration knobs used to select one explicitly.
 */
/**
 * @typedef {"jest"|"vitest"|"playwright"} FrameworkKind
 * @description The test frameworks with a built-in adapter
 * @memberOf module:for-testing
 */
export type FrameworkKind = "jest" | "vitest" | "playwright";

/**
 * @typedef {function(): (unknown | Promise<unknown>)} TestFn
 * @description A test body callback
 * @summary Sync or async function registered with the host runner
 * @memberOf module:for-testing
 */
export type TestFn = () => unknown | Promise<unknown>;

/**
 * @typedef {Object} PrimitiveMatcher
 * @description The framework-agnostic matcher vocabulary
 * @summary Discriminated union describing one matcher call, translated by
 * each adapter into its framework's own `expect` matchers
 * @template T the type of the asserted value
 * @property {T} [expected] the expected value, when the matcher takes one
 * @memberOf module:for-testing
 */
export type PrimitiveMatcher<T> =
  | { kind: "toBe"; expected: T }
  | { kind: "toEqual"; expected: T }
  | { kind: "toContain"; expected: unknown }
  | {
      kind:
        | "toBeGreaterThan"
        | "toBeGreaterThanOrEqual"
        | "toBeLessThan"
        | "toBeLessThanOrEqual";
      expected: number;
    }
  | { kind: "toBeDefined" }
  | { kind: "toBeTruthy" };

/**
 * @typedef {ReadonlyArray<any>} EachTable
 * @description Array-form rows of an `each` table
 * @memberOf module:for-testing
 */
export type EachTable = ReadonlyArray<any>;

/**
 * @typedef {function(string, Function, number=): void} EachCallback
 * @description The callback returned by an `each` call
 * @summary Registers one test per table row with the interpolated name
 * @memberOf module:for-testing
 */
export type EachCallback = (
  name: string,
  fn: (...args: any[]) => unknown,
  timeout?: number
) => void;

/**
 * @interface JestEachSignature
 * @description Signature of jest-analog `each` tables
 * @summary Supports the array form and the tagged-template form
 * @memberOf module:for-testing
 */
export interface JestEachSignature {
  (table: EachTable): EachCallback;
  (strings: TemplateStringsArray, ...values: unknown[]): EachCallback;
}

/**
 * @interface JestConcurrentSignature
 * @description Signature of jest-analog `concurrent` registration
 * @summary Optional adapter capability; the `skip` and `only` variants are
 * also optional
 * @memberOf module:for-testing
 */
export interface JestConcurrentSignature {
  (name: string, fn: TestFn, timeout?: number): void;
  skip?: (name: string, fn: TestFn, timeout?: number) => void;
  only?: (name: string, fn: TestFn, timeout?: number) => void;
}

/**
 * @interface FrameworkAdapter
 * @description The only framework-specific seam of the reported-testing API
 * @summary Every adapter
 * proxies registration to the framework's own `it`/`test` primitives and runs
 * matchers through the framework's own `expect`, which keeps assertion
 * semantics identical to the host runner.
 * @memberOf module:for-testing
 */
export interface FrameworkAdapter {
  readonly kind: FrameworkKind;
  run(name: string, fn: TestFn, timeout?: number): void;
  skip(name: string, fn: TestFn, timeout?: number): void;
  only(name: string, fn: TestFn, timeout?: number): void;
  todo(name: string): void;
  each?: JestEachSignature;
  concurrent?: JestConcurrentSignature;
  assert<T>(actual: T, matcher: PrimitiveMatcher<T>, negated: boolean): void;
  currentTestName(): string | undefined;
}

/**
 * @interface FrameworkConfig
 * @description Explicit framework-selection knobs
 * @summary Passed to {@link configure} to pin the adapter instead of relying
 * on sniffing and the fallback order
 * @property {FrameworkKind} [framework] the framework to pin
 * @memberOf module:for-testing
 */
export interface FrameworkConfig {
  framework?: FrameworkKind;
}

const CONFIGURED_FRAMEWORK = Symbol.for(
  "@decaf-ts/for-testing/configured-framework"
);

/**
 * @description Pins the framework used by the adapter resolver
 * @summary Stores the selection on a well-known global symbol so every module
 * instance (including duplicated bundles) observes the same value
 * @param {FrameworkConfig} config the framework to pin
 * @return {void}
 * @memberOf module:for-testing
 */
export function configure(config: FrameworkConfig): void {
  (globalThis as Record<symbol, unknown>)[CONFIGURED_FRAMEWORK] =
    config.framework;
}

/**
 * @description Reads the framework pinned through {@link configure}
 * @return {FrameworkKind | undefined} the pinned framework, or undefined
 * @memberOf module:for-testing
 */
export function configuredFramework(): FrameworkKind | undefined {
  return (globalThis as Record<symbol, unknown>)[CONFIGURED_FRAMEWORK] as
    | FrameworkKind
    | undefined;
}

/**
 * @description Default candidate order tried when no framework is pinned or
 * sniffed
 * @constant FRAMEWORK_ORDER
 * @type {FrameworkKind[]}
 * @memberOf module:for-testing
 */
export const FRAMEWORK_ORDER: FrameworkKind[] = [
  "jest",
  "vitest",
  "playwright",
];
