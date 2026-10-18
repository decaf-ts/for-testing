import { getAdapter } from "./frameworks/resolver";

/**
 * @description Builds the prefix shared by every assertion message
 * @summary Renders `Expected <property> [not ] to`, honoring the current
 * negation flag
 * @param {string} [property] the property name being asserted on
 * @param {boolean} [negated=false] whether the assertion is negated
 * @return {string} the message prefix
 * @memberOf module:for-testing
 */
export function messageToBe(property?: string, negated = false): string {
  return `Expected ${property ? `${property}` : ""} ${negated ? "not " : ""}to`;
}

/**
 * @description Shared assertion accumulator for reported assertions
 * @summary Owns the report lines, failure records and negation state used by
 * both the legacy {@link ReportExpect} surface and the chainable
 * `expect(...).referredToAs(...).to....` facade. Moving the message
 * construction here keeps both skins byte-identical.
 * @memberOf module:for-testing
 */
export class ExpectationCore {
  protected report: string[];
  protected hasError: string[] = [];
  protected negated = false;

  constructor(report?: string[]) {
    this.report = report || [];
  }

  /**
   * @description Negates the next assertion in the chain
   * @return {this} this chain instance
 * @memberOf module:for-testing
   */
  get not(): this {
    this.negated = true;
    return this;
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
   * @description Clears the accumulated report lines, failures and negation
   * @return {void}
 * @memberOf module:for-testing
   */
  reset(): void {
    this.report.length = 0;
    this.hasError.length = 0;
    this.negated = false;
  }

  /**
   * @description Records an assertion message and swallows its failure
   * @param {string} message the human-readable assertion message
   * @param {function(): void} assertion the underlying framework assertion
   * @return {void}
 * @memberOf module:for-testing
   */
  protected runAssertion(
    message: string,
    assertion: (adapter: ReturnType<typeof getAdapter>) => void
  ): void {
    const adapter = getAdapter();
    this.report.push(message);
    try {
      assertion(adapter);
    } catch {
      this.hasError.push(message);
    } finally {
      this.negated = false;
    }
  }

  /**
   * @description Builds the prefix of an assertion message
   * @param {string} [property] the property name being asserted on
   * @return {string} the message prefix
 * @memberOf module:for-testing
   */
  messageToBe(property?: string): string {
    return messageToBe(property, this.negated);
  }

  /**
   * @description Asserts expected and actual are strictly equal
   * @param {any} expected the expected value
   * @param {any} actual the received value
   * @param {string} [property] the property name for the message
   * @return {void}
 * @memberOf module:for-testing
   */
  assertToBe(expected: any, actual: any, property?: string): void {
    const message = `${this.messageToBe(property)} be ${expected} and received ${actual}`;
    const negated = this.negated;
    this.runAssertion(message, (adapter) =>
      adapter.assert(actual, { kind: "toBe", expected }, negated)
    );
  }

  /**
   * @description Asserts actual is strictly greater than expected
   * @param {any} expected the bound value
   * @param {any} actual the received value
   * @param {string} [property] the property name for the message
   * @return {void}
 * @memberOf module:for-testing
   */
  assertToBeGreaterThan(expected: any, actual: any, property?: string): void {
    const message = `${this.messageToBe(property)} be greater than ${expected} and received ${actual}`;
    const negated = this.negated;
    this.runAssertion(message, (adapter) =>
      adapter.assert(
        actual,
        { kind: "toBeGreaterThan", expected },
        negated
      )
    );
  }

  /**
   * @description Asserts actual is greater than or equal to expected
   * @param {any} expected the bound value
   * @param {any} actual the received value
   * @param {string} [property] the property name for the message
   * @return {void}
 * @memberOf module:for-testing
   */
  assertToBeGreaterThanOrEqual(
    expected: any,
    actual: any,
    property?: string
  ): void {
    const message = `${this.messageToBe(property)} be greater than or equal ${expected} and received ${actual}`;
    const negated = this.negated;
    this.runAssertion(message, (adapter) =>
      adapter.assert(
        actual,
        { kind: "toBeGreaterThanOrEqual", expected },
        negated
      )
    );
  }

  /**
   * @description Asserts actual is strictly less than expected
   * @param {any} expected the bound value
   * @param {any} actual the received value
   * @param {string} [property] the property name for the message
   * @return {void}
 * @memberOf module:for-testing
   */
  assertToBeLessThan(expected: any, actual: any, property?: string): void {
    const message = `${this.messageToBe(property)} be less than ${expected} and received ${actual}`;
    const negated = this.negated;
    this.runAssertion(message, (adapter) =>
      adapter.assert(actual, { kind: "toBeLessThan", expected }, negated)
    );
  }

  /**
   * @description Asserts actual is less than or equal to expected
   * @param {any} expected the bound value
   * @param {any} actual the received value
   * @param {string} [property] the property name for the message
   * @return {void}
 * @memberOf module:for-testing
   */
  assertToBeLessThanOrEqual(
    expected: any,
    actual: any,
    property?: string
  ): void {
    const message = `${this.messageToBe(property)} be less than or equal ${expected} and received ${actual}`;
    const negated = this.negated;
    this.runAssertion(message, (adapter) =>
      adapter.assert(
        actual,
        { kind: "toBeLessThanOrEqual", expected },
        negated
      )
    );
  }

  /**
   * @description Asserts expected deeply equals actual
   * @param {any} expected the expected value
   * @param {any} actual the received value
   * @param {string} [property] the property name for the message
   * @return {void}
 * @memberOf module:for-testing
   */
  assertToEqual(expected: any, actual: any, property?: string): void {
    const message = `${this.messageToBe(property)} equal ${JSON.stringify(expected, null, 2)} and received ${JSON.stringify(actual, null, 2)}`;
    const negated = this.negated;
    this.runAssertion(message, (adapter) =>
      adapter.assert(actual, { kind: "toEqual", expected }, negated)
    );
  }

  /**
   * @description Asserts expected contains actual
   * @param {any} expected the container value
   * @param {any} actual the value expected to be contained
   * @param {string} [property] the property name for the message
   * @return {void}
 * @memberOf module:for-testing
   */
  assertToContain(expected: any, actual: any, property?: string): void {
    const message = `Expected ${property ? `${property}: ` : ""}${expected} ${this.negated ? "not " : ""}to contain ${JSON.stringify(actual, null, 2)}`;
    const negated = this.negated;
    this.runAssertion(message, (adapter) =>
      adapter.assert(expected, { kind: "toContain", expected: actual }, negated)
    );
  }

  /**
   * @description Asserts the value is defined
   * @param {any} actual the received value
   * @param {string} [property] the property name for the message
   * @return {void}
 * @memberOf module:for-testing
   */
  assertToBeDefined(actual: any, property?: string): void {
    const message = `${this.messageToBe(property)} be defined and received ${typeof actual === "object" ? JSON.stringify(actual) : actual}`;
    const negated = this.negated;
    this.runAssertion(message, (adapter) =>
      adapter.assert(actual, { kind: "toBeDefined" }, negated)
    );
  }

  /**
   * @description Asserts the value is truthy
   * @param {any} actual the received value
   * @param {string} [property] the property name for the message
   * @return {void}
 * @memberOf module:for-testing
   */
  assertToBeTruthy(actual: any, property?: string): void {
    const message = `${this.messageToBe(property)} be truthy and received ${actual}`;
    const negated = this.negated;
    this.runAssertion(message, (adapter) =>
      adapter.assert(actual, { kind: "toBeTruthy" }, negated)
    );
  }
}

