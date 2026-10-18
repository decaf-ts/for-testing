import { ExpectationCore } from "./expectation-core";
import { it } from "./it";

/**
 * @description Registers an `it`/`it.skip` block that reports the error
 * object of a failing handler before rethrowing
 * @summary Retrocompatible wrapper over {@link it.report}: when the handler
 * throws, its `message` and `cause` are persisted through the test-scoped
 * reporter (see {@link getReporter}) so the failure shows up in the evidence
 * report, then the error is rethrown to fail the test
 * @param {string} name the test name
 * @param {function(): (unknown | Promise<unknown>)} handler the test body
 * @param {boolean} [skip=false] register with `it.report.skip` instead of
 * `it.report`
 * @return {Promise<void>} resolves once the test block was registered
 * @deprecated use `it.report(name, fn)` / `it.report.skip(name, fn)` instead
 * @memberOf module:for-testing
 */
export async function itReportsOnFailure(
  name: string,
  handler: () => unknown | Promise<unknown>,
  skip: boolean = false
) {
  if (skip) {
    it.report.skip(name, handler);
    return;
  }
  it.report(name, handler);
}

/**
 * @description Chain-style assertion accumulator for reported e2e checks
 * @summary Retrocompatible skin over {@link ExpectationCore}. Collects
 * human-readable assertion messages into a report while recording failures, so
 * a whole chain of checks produces one persisted report (via
 * {@link reportObjects}) and one final pass/fail verdict instead of aborting on
 * the first failed `expect`. Use {@link ReportExpect#not} in front of an
 * assertion to negate it.
 *
 * @example
 * const report = new ReportExpect();
 * report.assertToBe(200, response.status, "status");
 * report.assertToContain(body, "created", "body");
 * await reportObjects(getReporter(), report, response);
 * @deprecated use `expect(actual).referredToAs("property").to....` instead
 * @memberOf module:for-testing
 */
export class ReportExpect extends ExpectationCore {}
