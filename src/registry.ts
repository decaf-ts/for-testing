import type { TestReporter } from "./TestReporter";

let reporter: TestReporter | undefined;

/**
 * @description Installs the test-scoped reporter instance
 * @summary Records the {@link TestReporter} later returned by
 * {@link getReporter}, typically in a jest setup file
 * @param {TestReporter} rep the reporter to install
 * @return {void}
 * @memberOf module:for-testing
 */
export function setReporter(rep: TestReporter): void {
  reporter = rep;
}

/**
 * @description Returns the test-scoped reporter instance
 * @summary Yields the {@link TestReporter} previously installed through
 * {@link setReporter}
 * @return {TestReporter} the installed reporter (undefined when never set)
 * @memberOf module:for-testing
 */
export function getReporter(): TestReporter {
  return reporter as TestReporter;
}
