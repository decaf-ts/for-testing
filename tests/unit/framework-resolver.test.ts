import { configure } from "../../src/frameworks/types";
import {
  getAdapter,
  resetAdapter,
  resolveAdapter,
  resolveAdapterSync,
} from "../../src/frameworks/resolver";

jest.mock("@jest/globals", () => ({}));

const FRAMEWORK_ENV_KEY = "DECAF_TEST_FRAMEWORK";
const SNIFF_KEYS = [
  "JEST_WORKER_ID",
  "TEST_WORKER_INDEX",
  "TEST_PARALLEL_INDEX",
  "VITEST",
  "VITEST_WORKSPACE_ID",
  "VITEST_MODE",
  "PLAYWRIGHT_TEST",
  "PLAYWRIGHT_TEST_BASE_URL",
  "PLAYWRIGHT_BROWSERS_PATH",
];

type AnyFn = ((...args: any[]) => any) & {
  skip?: (...args: any[]) => any;
  only?: (...args: any[]) => any;
  todo?: (...args: any[]) => any;
  each?: (...args: any[]) => any;
  getState?: () => { currentTestName?: string };
};

interface GlobalSnapshot {
  it?: unknown;
  test?: unknown;
  expect?: unknown;
}

function fakeTestFn(): AnyFn {
  const fn = (() => undefined) as AnyFn;
  fn.skip = () => undefined;
  fn.only = () => undefined;
  fn.todo = () => undefined;
  fn.each = () => () => undefined;
  return fn;
}

function clearSniffEnv(): void {
  for (const key of SNIFF_KEYS) delete process.env[key];
  delete process.env[FRAMEWORK_ENV_KEY];
}

describe("framework adapter resolver", () => {
  const originalEnv = { ...process.env };
  const globalScope = globalThis as unknown as Record<string, unknown>;
  let originalGlobals: GlobalSnapshot;

  beforeEach(() => {
    originalGlobals = {
      it: globalScope.it,
      test: globalScope.test,
      expect: globalScope.expect,
    };
    process.env = { ...originalEnv };
    clearSniffEnv();
    configure({});
    resetAdapter();
  });

  afterEach(() => {
    globalScope.it = originalGlobals.it;
    globalScope.test = originalGlobals.test;
    globalScope.expect = originalGlobals.expect;
    process.env = originalEnv;
    configure({});
    resetAdapter();
  });

  function installFakeGlobals(): void {
    globalScope.it = fakeTestFn();
    globalScope.test = fakeTestFn();
    globalScope.expect = globalScope.expect ?? fakeTestFn();
  }

  function installPlaywrightShapedGlobals(): void {
    delete globalScope.it;
    globalScope.test = fakeTestFn();
    globalScope.expect = globalScope.expect ?? fakeTestFn();
  }

  it("uses the explicit configure({ framework }) selection over env and sniffing", () => {
    installFakeGlobals();
    process.env[FRAMEWORK_ENV_KEY] = "jest";
    process.env.JEST_WORKER_ID = "1";
    configure({ framework: "vitest" });

    expect(resolveAdapterSync().kind).toBe("vitest");
    expect(getAdapter().kind).toBe("vitest");
  });

  it("prefers DECAF_TEST_FRAMEWORK over a conflicting sniff", () => {
    installFakeGlobals();
    process.env[FRAMEWORK_ENV_KEY] = "jest";
    process.env.VITEST = "true";
    configure({});

    expect(resolveAdapterSync().kind).toBe("jest");
  });

  it("falls back to globalThis.it/.expect when the framework module is unavailable", async () => {
    installFakeGlobals();
    process.env.JEST_WORKER_ID = "1";

    expect(resolveAdapterSync().kind).toBe("jest");
    resetAdapter();
    await expect(resolveAdapter().then((adapter) => adapter.kind)).resolves.toBe(
      "jest"
    );
  });

  it("resolves playwright, never jest, from Playwright-shaped globals without markers (SAA-969 repro)", () => {
    installPlaywrightShapedGlobals();
    process.env = { ...originalEnv };
    clearSniffEnv();

    expect(resolveAdapterSync().kind).toBe("playwright");
    expect(getAdapter().kind).toBe("playwright");
  });

  it.each([
    ["JEST_WORKER_ID", "jest"],
    ["VITEST", "vitest"],
    ["VITEST_WORKSPACE_ID", "vitest"],
    ["VITEST_MODE", "vitest"],
    ["TEST_WORKER_INDEX", "playwright"],
    ["TEST_PARALLEL_INDEX", "playwright"],
    ["PLAYWRIGHT_TEST", "playwright"],
    ["PLAYWRIGHT_TEST_BASE_URL", "playwright"],
    ["PLAYWRIGHT_BROWSERS_PATH", "playwright"],
  ] as const)("sniffs %s as %s", (envKey, expectedKind) => {
    installFakeGlobals();
    process.env[envKey] = "1";

    expect(resolveAdapterSync().kind).toBe(expectedKind);
  });

  it("throws a descriptive error naming every framework and both override knobs", () => {
    configure({});
    clearSniffEnv();

    let caught: unknown;
    jest.isolateModules(() => {
      const unavailable = () => {
        throw new Error("framework unavailable");
      };
      jest.doMock("../../src/frameworks/jest/adapter", () => ({
        createJestAdapter: unavailable,
        createJestAdapterAsync: async () => unavailable(),
      }));
      jest.doMock("../../src/frameworks/vitest/adapter", () => ({
        createVitestAdapter: unavailable,
        createVitestAdapterAsync: async () => unavailable(),
      }));
      jest.doMock("../../src/frameworks/playwright/adapter", () => ({
        createPlaywrightAdapter: unavailable,
        createPlaywrightAdapterAsync: async () => unavailable(),
      }));

      const isolated = jest.requireActual("../../src/frameworks/resolver") as typeof import("../../src/frameworks/resolver");
      isolated.resetAdapter();
      try {
        isolated.resolveAdapterSync(true);
      } catch (error) {
        caught = error;
      }
    });

    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("jest");
    expect(message).toContain("vitest");
    expect(message).toContain("playwright");
    expect(message).toContain("configure({ framework })");
    expect(message).toContain(FRAMEWORK_ENV_KEY);
  });
});
