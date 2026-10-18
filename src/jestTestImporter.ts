/**
 * @module for-testing/jestTestImporter
 * @description Retrocompatible module path for the framework-agnostic JUnit
 * importer, which now lives in `./testImporter`. JUnit XML is emitted by jest,
 * vitest and Playwright alike, so parse time is framework-independent.
 * @deprecated import from `@decaf-ts/for-testing` or `./testImporter` instead
 */
export * from "./testImporter";
