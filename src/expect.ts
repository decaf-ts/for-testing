import { ExpectationCore } from "./expectation-core";
import { getReporter } from "./registry";
import type { TestReporter } from "./TestReporter";

/**
 * @interface ToChain
 * @description Terminal matcher surface of an expectation chain
 * @summary The jest-analog matchers supported by every adapter; each records
 * one report line and swallows its failure into the accumulator
 * @template Actual the type of the asserted value
 * @memberOf module:for-testing
 */
export interface ToChain<Actual> {
  be(expected: Actual): void;
  equal(expected: Actual): void;
  contain(expected: unknown): void;
  beGreaterThan(expected: number): void;
  beGreaterThanOrEqual(expected: number): void;
  beLessThan(expected: number): void;
  beLessThanOrEqual(expected: number): void;
  beDefined(): void;
  beTruthy(): void;
}

/**
 * @interface ExpectationChain
 * @description Chainable entry point of the framework-agnostic expectation
 * facade
 * @summary Binds one actual value: attach a human-readable label with
 * `referredToAs`, then assert through `to` (or the negated `not.to`)
 * @template Actual the type of the asserted value
 * @memberOf module:for-testing
 */
export interface ExpectationChain<Actual> {
  /** human-meaningful label used in report messages (the old `property` param) */
  referredToAs(label: string): ExpectationChain<Actual>;
  readonly not: { readonly to: ToChain<Actual> };
  readonly to: ToChain<Actual>;
}

/**
 * @interface ExpectApi
 * @description Chainable, framework-agnostic assertion facade
 * @summary Like the legacy
 * {@link ExpectationCore} accumulator, a matcher records one report line and
 * one failure entry instead of aborting the test, and `.not` negates only the
 * next matcher.
 * @template Actual the type of the asserted value on the call signature
 * @memberOf module:for-testing
 */
export interface ExpectApi {
  <Actual>(actual: Actual): ExpectationChain<Actual>;
  getStatus(): "Passed" | "Failed";
  getReport(): string;
  checkHasError(): boolean;
  getErrors(): string[];
  reset(): void;
}

/**
 * @class Chain
 * @classdesc Internal implementation of {@link ExpectationChain} binding one
 * actual value and optional report label to the shared accumulator
 * @description Bridges the jest-analog chain syntax onto {@link ExpectationCore}
 * @summary Each matcher delegates to the matching `assertTo*` method of the
 * core, passing the bound actual value and label
 * @param {ExpectationCore} core the shared assertion accumulator
 * @param {Actual} actual the asserted value
 * @param {string} [label] the human-readable label used in report messages
 */
class Chain<Actual> implements ExpectationChain<Actual> {
  constructor(
    private readonly core: ExpectationCore,
    private readonly actual: Actual,
    private label?: string
  ) {}

  referredToAs(label: string): ExpectationChain<Actual> {
    this.label = label;
    return this;
  }

  get not(): { readonly to: ToChain<Actual> } {
    void this.core.not;
    return { to: this.buildTo() };
  }

  get to(): ToChain<Actual> {
    return this.buildTo();
  }

  private buildTo(): ToChain<Actual> {
    const core = this.core;
    const actual = this.actual;
    const label = () => this.label;
    return {
      be: (expected: Actual) => core.assertToBe(expected, actual, label()),
      equal: (expected: Actual) => core.assertToEqual(expected, actual, label()),
      contain: (expected: unknown) =>
        core.assertToContain(actual, expected, label()),
      beGreaterThan: (expected: number) =>
        core.assertToBeGreaterThan(expected, actual, label()),
      beGreaterThanOrEqual: (expected: number) =>
        core.assertToBeGreaterThanOrEqual(expected, actual, label()),
      beLessThan: (expected: number) =>
        core.assertToBeLessThan(expected, actual, label()),
      beLessThanOrEqual: (expected: number) =>
        core.assertToBeLessThanOrEqual(expected, actual, label()),
      beDefined: () => core.assertToBeDefined(actual, label()),
      beTruthy: () => core.assertToBeTruthy(actual, label()),
    };
  }
}

/**
 * @description Accumulators scoped to a reporter instance
 * @summary Keeping the accumulator off the reporter (instead of recreating it
 * per facade) lets every `createExpect(reporter)` call observe the same
 * scenario state, and lets `reportObjects` reset that state in place.
 * @constant reporterCores
 */
const reporterCores = new WeakMap<TestReporter, ExpectationCore>();

/**
 * @description Resolves the accumulator backing a facade
 * @summary Omitting the reporter yields a fresh standalone accumulator; passing
 * one reuses the accumulator already associated with that reporter instance
 * @param {TestReporter} [reporter] the reporter to scope the accumulator to
 * @return {ExpectationCore} the resolved accumulator
 */
function coreFor(reporter?: TestReporter): ExpectationCore {
  if (!reporter) return new ExpectationCore();
  let core = reporterCores.get(reporter);
  if (!core) {
    core = new ExpectationCore();
    reporterCores.set(reporter, core);
  }
  return core;
}

/**
 * @description Creates an isolated expectation facade with its own
 * accumulator
 * @summary Pass a reporter to scope the accumulator to one scenario, or omit
 * it to create a standalone accumulation target. Facades created for the same
 * reporter share one accumulator, matching `reporter.expect`. The returned
 * {@link ExpectApi} never aborts the test; call `reportObjects` to persist
 * the accumulated report.
 * @param {TestReporter} [reporter] the reporter whose accumulator backs the
 * facade
 * @return {ExpectApi} the isolated expectation facade
 * @memberOf module:for-testing
 */
export function createExpect(reporter?: TestReporter): ExpectApi {
  const core = coreFor(reporter);
  const api = (<Actual,>(actual: Actual) =>
    new Chain(core, actual)) as unknown as ExpectApi;
  api.getStatus = () => core.getStatus();
  api.getReport = () => core.getReport();
  api.checkHasError = () => core.checkHasError();
  api.getErrors = () => core.getErrors();
  api.reset = () => {
    core.reset();
  };
  return api;
}

let standalone: ExpectApi | undefined;

/**
 * @description Picks the accumulator the standalone `expect` facade reports
 * into
 * @summary Prefers the installed reporter's own facade, falling back to a
 * lazily-created process-wide accumulator
 * @return {ExpectApi} the active expectation facade
 */
function activeExpect(): ExpectApi {
  const reporter = getReporter();
  if (reporter?.expect) return reporter.expect;
  standalone ??= createExpect();
  return standalone;
}

/**
 * @description The standalone expectation facade bound to the installed
 * reporter
 * @summary All calls share the reporter installed through
 * {@link setReporter}'s accumulator, so a scenario
 * can accumulate several assertions and then persist them with
 * `reportObjects(reporter, expect, response)`. Without an installed reporter
 * a process-wide standalone accumulator is used.
 * @constant expect
 * @type {ExpectApi}
 * @memberOf module:for-testing
 */
export const expect: ExpectApi = (<Actual,>(actual: Actual) =>
  activeExpect()(actual)) as unknown as ExpectApi;

expect.getStatus = () => activeExpect().getStatus();
expect.getReport = () => activeExpect().getReport();
expect.checkHasError = () => activeExpect().checkHasError();
expect.getErrors = () => activeExpect().getErrors();
expect.reset = () => activeExpect().reset();
