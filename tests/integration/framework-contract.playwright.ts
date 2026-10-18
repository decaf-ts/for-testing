/**
 * Playwright entry for the shared framework contract spec.
 *
 * ES module dependencies are evaluated in declaration order, so the setup
 * module installs Playwright's `test`/`expect`/`describe` globals before the
 * shared spec registers its tests.
 */
import "./framework-contract.playwright.setup";
import "./framework-contract.test";

export {};
