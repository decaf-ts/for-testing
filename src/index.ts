/**
 * @module for-testing
 * @description Backend test-support toolkit for decaf-ts packages. Re-exports the
 * {@link TestReporter} evidence pipeline, the jest helpers (`itReportsOnFailure`,
 * `ReportExpect`), the consumer/producer runners and the Xray/AgileTest teardowns
 * that convert JUnit reports and evidence directories into provider import
 * payloads.
 * @summary Backend testing toolkit for decaf-ts packages, with the UI testing
 * surface exposed separately through the `ui` named export.
 *
 * The package is split into two surfaces:
 * 1. The backend testing toolkit, exported directly from this entrypoint
 *    (`Consumer`, `TestReporter`, jest helpers, performance runner, teardowns).
 * 2. The UI testing toolkit, exported as the `ui` namespace and available as the
 *    `@decaf-ts/for-testing/ui` subpath, so browser/component helpers can
 *    evolve without widening the backend surface.
 *
 * Individual exports are documented in their source files.
 */
export * from "./Consumer";
export * from "./TestReporter";
export * from "./utils";
export * from "./jestPerformanceRunner";
export * from "./reporter";
export * from "./jest";
export * from "./jestXrayTeardown";
export * from "./jestAgileTestTeardown";

/**
 * @description UI testing toolkit namespace.
 * @summary Groups UI-specific test helpers under a single namespace so browser and
 * component helpers can be added without polluting the backend toolkit surface.
 * @namespace ui
 * @memberOf module:for-testing
 */
export * as ui from "./ui";

/**
 * @description Represents the current version of the module.
 * @summary Stores the version for the @decaf-ts/for-testing package. The build
 * replaces the placeholder with the actual version number at publish time.
 * @const VERSION
 * @memberOf module:for-testing
 */
export const VERSION = "##VERSION##";

/**
 * @description Represents the current commit hash of the module build.
 * @summary Stores the current git commit hash for the @decaf-ts/for-testing
 * package. The build replaces the placeholder with the actual commit hash at
 * publish time.
 * @const COMMIT
 * @memberOf module:for-testing
 */
export const COMMIT = "##COMMIT##";

/**
 * @description Represents the full version string of the module.
 * @summary Stores the semver version and commit hash for the
 * @decaf-ts/for-testing package. The build replaces the placeholder with the
 * actual `<version>-<commit>` value at publish time.
 * @const FULL_VERSION
 * @memberOf module:for-testing
 */
export const FULL_VERSION = "##FULL_VERSION##";

/**
 * @description Represents the current package name of the module.
 * @summary Stores the package name for the @decaf-ts/for-testing package. The
 * build replaces the placeholder with the actual package name at publish time.
 * @const PACKAGE_NAME
 * @memberOf module:for-testing
 */
export const PACKAGE_NAME = "##PACKAGE##";
