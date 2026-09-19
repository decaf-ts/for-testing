import { expect, it } from "@jest/globals";
import { getReporter } from "./reporter";

/**
 * @description Registers an `it`/`it.skip` block that reports the error
 * object of a failing handler before rethrowing
 * @summary Jest wrapper mirroring the backend e2e reporting standard:
 * when the handler throws, its `message` and `cause` are persisted through
 * the test-scoped reporter (see {@link getReporter}) so the failure shows
 * up in the evidence report, then the error is rethrown to fail the test
 * @param {string} name the test name
 * @param {function(): (unknown | Promise<unknown>)} handler the test body
 * @param {boolean} [skip=false] register with `it.skip` instead of `it`
 * @return {Promise<void>} resolves once the test block was registered
 * @memberOf module:for-testing
 */
export async function itReportsOnFailure(
  name: string,
  handler: () => unknown | Promise<unknown>,
  skip: boolean = false
) {
  const method = skip ? it.skip : it;

  method(`${name}`, async () => {
    try {
      await handler();
    } catch (error: any) {
      await getReporter().reportObject("error", {
        message: error?.message,
        cause: error?.cause,
      });
      throw error;
    }
  });
}

/**
 * @description Chain-style assertion accumulator for reported e2e checks
 * @summary Collects human-readable assertion messages into a report while
 * recording failures, so a whole chain of checks produces one persisted
 * report (via {@link reportObjects}) and one final pass/fail verdict
 * instead of aborting on the first failed `expect`. Use
 * {@link ReportExpect#not} in front of an assertion to negate it.
 *
 * @example
 * const report = new ReportExpect();
 * report.assertToBe(200, response.status, "status");
 * report.assertToContain(body, "created", "body");
 * await reportObjects(getReporter(), report, response);
 * @memberOf module:for-testing
 */
export class ReportExpect {
  private report: string[];
  private hasError: string[] = [];
  private negated = false;

  /**
   * @description Negates the next assertion in the chain
   * @summary Flips the chain into "not" mode for the next assertion, then
   * resets automatically
   * @return {ReportExpect} this chain instance
   * @memberOf module:for-testing
   */
  get not(): ReportExpect {
    this.negated = true;
    return this;
  }

  /**
   * @description Creates an empty assertion chain, optionally seeded with
   * existing report lines
   * @param {string[]} [report] pre-existing report lines to keep
   * @memberOf module:for-testing
   */
  constructor(report?: string[]) {
    this.report = report || [];
  }

  /**
   * @description Returns the accumulated report lines joined by newlines
   * @return {string} the full report text
   * @memberOf module:for-testing
   */
  getReport(): string {
    return this.report.join("\n");
  }

  /**
   * @description Returns the chain verdict from the recorded failures
   * @return {("Passed"|"Failed")} `Failed` when any assertion failed
   * @memberOf module:for-testing
   */
  getStatus(): "Passed" | "Failed" {
    return this.checkHasError() ? "Failed" : "Passed";
  }

  /**
   * @description Whether any assertion in the chain failed
   * @return {boolean} true when at least one assertion failed
   * @memberOf module:for-testing
   */
  checkHasError(): boolean {
    return this.hasError.length > 0;
  }

  /**
   * @description The messages of every failed assertion in the chain
   * @return {string[]} the failed assertion messages
   * @memberOf module:for-testing
   */
  getErrors(): string[] {
    return this.hasError;
  }

  /**
   * @description Records an assertion message and swallows its failure
   * @summary Pushes the message onto the report, runs the assertion and —
   * unlike a bare `expect` — catches the failure into `hasError` so the
   * chain keeps running; the negation flag always resets afterwards
   * @param {string} message the human-readable assertion message
   * @param {function(): void} assertion the underlying expect call
   * @return {void}
   * @memberOf module:for-testing
   */
  private runAssertion(message: string, assertion: () => void) {
    this.report.push(message);
    try {
      assertion();
    } catch {
      this.hasError.push(message);
    } finally {
      this.negated = false;
    }
  }

  /**
   * @description Builds the prefix of an assertion message
   * @summary Renders `Expected <property> [not ] to`, honoring the current
   * negation flag
   * @param {string} [property] the property name being asserted on
   * @return {string} the message prefix
   * @memberOf module:for-testing
   */
  messageToBe(property?: string): string {
    return `Expected ${property ? `${property}` : ""} ${this.negated ? "not " : ""}to`;
  }

  /**
   * @description Asserts expected and actual are strictly equal
   * @param {any} expected the expected value
   * @param {any} actual the received value
   * @param {string} [property] the property name for the message
   * @return {void}
   * @memberOf module:for-testing
   */
  assertToBe(expected: any, actual: any, property?: string) {
    const message = `${this.messageToBe(property)} be ${expected} and received ${actual}`;
    this.runAssertion(message, () => {
      if (this.negated) {
        expect(expected).not.toBe(actual);
        return;
      }
      expect(expected).toBe(actual);
    });
  }

  /**
   * @description Asserts actual is strictly greater than expected
   * @param {any} expected the bound value
   * @param {any} actual the received value
   * @param {string} [property] the property name for the message
   * @return {void}
   * @memberOf module:for-testing
   */
  assertToBeGreaterThan(expected: any, actual: any, property?: string) {
    const message = `${this.messageToBe(property)} be greater than ${expected} and received ${actual}`;
    this.runAssertion(message, () => {
      if (this.negated) {
        expect(actual).not.toBeGreaterThan(expected);
        return;
      }
      expect(actual).toBeGreaterThan(expected);
    });
  }

  /**
   * @description Asserts actual is greater than or equal to expected
   * @param {any} expected the bound value
   * @param {any} actual the received value
   * @param {string} [property] the property name for the message
   * @return {void}
   * @memberOf module:for-testing
   */
  assertToBeGreaterThanOrEqual(expected: any, actual: any, property?: string) {
    const message = `${this.messageToBe(property)} be greater than or equal ${expected} and received ${actual}`;
    this.runAssertion(message, () => {
      if (this.negated) return expect(actual).not.toBeGreaterThanOrEqual(expected);
      expect(actual).toBeGreaterThanOrEqual(expected);
    });
  }

  /**
   * @description Asserts actual is strictly less than expected
   * @param {any} expected the bound value
   * @param {any} actual the received value
   * @param {string} [property] the property name for the message
   * @return {void}
   * @memberOf module:for-testing
   */
  assertToBeLessThan(expected: any, actual: any, property?: string) {
    const message = `${this.messageToBe(property)} be less than ${expected} and received ${actual}`;
    this.runAssertion(message, () => {
      if (this.negated) {
        expect(actual).not.toBeLessThan(expected);
        return;
      }
      expect(actual).toBeLessThan(expected);
    });
  }

  /**
   * @description Asserts actual is less than or equal to expected
   * @param {any} expected the bound value
   * @param {any} actual the received value
   * @param {string} [property] the property name for the message
   * @return {void}
   * @memberOf module:for-testing
   */
  assertToBeLessThanOrEqual(expected: any, actual: any, property?: string) {
    const message = `${this.messageToBe(property)} be less than or equal ${expected} and received ${actual}`;
    this.runAssertion(message, () => {
      if (this.negated) return expect(actual).not.toBeLessThanOrEqual(expected);
      expect(actual).toBeLessThanOrEqual(expected);
    });
  }

  /**
   * @description Asserts expected deeply equals actual
   * @param {any} expected the expected value
   * @param {any} actual the received value
   * @param {string} [property] the property name for the message
   * @return {void}
   * @memberOf module:for-testing
   */
  assertToEqual(expected: any, actual: any, property?: string) {
    const message = `${this.messageToBe(property)} equal ${JSON.stringify(expected, null, 2)} and received ${JSON.stringify(actual, null, 2)}`;
    this.runAssertion(message, () => {
      if (this.negated) {
        expect(expected).not.toEqual(actual);
        return;
      }
      expect(expected).toEqual(actual);
    });
  }

  /**
   * @description Asserts expected contains actual
   * @param {any} expected the container value
   * @param {any} actual the value expected to be contained
   * @param {string} [property] the property name for the message
   * @return {void}
   * @memberOf module:for-testing
   */
  assertToContain(expected: any, actual: any, property?: string) {
    const message = `Expected ${property ? `${property}: ` : ""}${expected} ${this.negated ? "not " : ""}to contain ${JSON.stringify(actual, null, 2)}`;
    this.runAssertion(message, () => {
      if (this.negated) {
        expect(expected).not.toContain(actual);
        return;
      }
      expect(expected).toContain(actual);
    });
  }

  /**
   * @description Asserts the value is defined
   * @param {any} actual the received value
   * @param {string} [property] the property name for the message
   * @return {void}
   * @memberOf module:for-testing
   */
  assertToBeDefined(actual: any, property?: string) {
    const message = `${this.messageToBe(property)} be defined and received ${typeof actual === "object" ? JSON.stringify(actual) : actual}`;
    this.runAssertion(message, () => {
      if (this.negated) return expect(actual).not.toBeDefined();
      expect(actual).toBeDefined();
    });
  }

  /**
   * @description Asserts the value is truthy
   * @param {any} actual the received value
   * @param {string} [property] the property name for the message
   * @return {void}
   * @memberOf module:for-testing
   */
  assertToBeTruthy(actual: any, property?: string) {
    const message = `${this.messageToBe(property)} be truthy and received ${actual}`;
    this.runAssertion(message, () => {
      if (this.negated) return expect(actual).not.toBeTruthy();
      expect(actual).toBeTruthy();
    });
  }
}
