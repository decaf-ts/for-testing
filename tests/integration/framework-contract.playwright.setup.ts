/**
 * Installs the `@playwright/test` runner primitives as globals before the
 * shared contract spec is evaluated. Playwright does not inject `test`,
 * `expect` or `describe` globally, while jest and vitest do, so this bridge is
 * what lets one runner-agnostic spec execute under all three runners.
 */
import { expect, test } from "@playwright/test";

const scope = globalThis as unknown as Record<string, unknown>;
scope.test = test;
scope.expect = expect;
scope.describe = test.describe.bind(test);
scope.beforeAll = test.beforeAll.bind(test);
scope.beforeEach = test.beforeEach.bind(test);
scope.afterEach = test.afterEach.bind(test);
scope.afterAll = test.afterAll.bind(test);
