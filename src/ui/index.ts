/**
 * @description UI testing toolkit entrypoint for `@decaf-ts/for-testing`. This
 * surface is intentionally minimal at first release: no UI test helpers currently
 * exist in the relocated backend toolkit, so this module establishes the stable
 * import path (`@decaf-ts/for-testing/ui`, also reachable as the `ui` named
 * export) that future browser, component and end-to-end helpers will populate.
 * @summary UI testing toolkit namespace for decaf-ts packages; currently an empty
 * but stable surface reserved for browser and component test helpers.
 * @module for-testing.ui
 * @memberOf module:for-testing
 *
 * Consumers can already rely on the shape:
 *
 * ```typescript
 * import { ui } from "@decaf-ts/for-testing";
 * import * as uiDirect from "@decaf-ts/for-testing/ui";
 * ```
 *
 * Both resolve to this module, so helpers added here become available through
 * either import path without a breaking change.
 */
export {};
