import { configure } from "../../src/frameworks/types";
import {
  resetAdapter,
  resolveAdapterSync,
} from "../../src/frameworks/resolver";
import {
  createJestAdapter,
  createJestAdapterAsync,
} from "../../src/frameworks/jest/adapter";

jest.mock("@jest/globals", () => {
  const fakeIt = () => undefined;
  const fakeExpect = () => undefined;
  return { it: fakeIt, expect: fakeExpect };
});

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
  "DECAF_TEST_FRAMEWORK",
];

interface GlobalSnapshot {
  hadIt: boolean;
  it?: unknown;
}

describe("jest adapter environment guard (QA F3/F4)", () => {
  const originalEnv = { ...process.env };
  const globalScope = globalThis as unknown as Record<string, unknown>;
  let originalGlobals: GlobalSnapshot;

  function clearSniffEnv(): void {
    for (const key of SNIFF_KEYS) delete process.env[key];
  }

  function removeInjectedIt(): void {
    delete globalScope.it;
  }

  beforeEach(() => {
    originalGlobals = {
      hadIt: Object.prototype.hasOwnProperty.call(globalScope, "it"),
      it: globalScope.it,
    };
    process.env = { ...originalEnv };
    clearSniffEnv();
    configure({});
    resetAdapter();
  });

  afterEach(() => {
    if (originalGlobals.hadIt) {
      globalScope.it = originalGlobals.it;
    } else {
      delete globalScope.it;
    }
    process.env = originalEnv;
    configure({});
    resetAdapter();
  });

  it("refuses the @jest/globals module fallback when JEST_WORKER_ID is empty", async () => {
    removeInjectedIt();
    process.env.JEST_WORKER_ID = "";

    const jestGlobals = jest.requireMock("@jest/globals") as {
      it?: unknown;
      expect?: unknown;
    };
    expect(typeof jestGlobals.it).toBe("function");
    expect(typeof jestGlobals.expect).toBe("function");

    expect(() => createJestAdapter()).toThrow(
      /Unable to resolve the jest adapter/
    );
    await expect(createJestAdapterAsync()).rejects.toThrow(
      /Unable to resolve the jest adapter/
    );
  });

  it("does not accept generic test/expect globals when JEST_WORKER_ID is empty", () => {
    removeInjectedIt();
    process.env.JEST_WORKER_ID = "";

    expect(typeof globalThis.test).toBe("function");
    expect(typeof globalThis.expect).toBe("function");
    expect(() => createJestAdapter()).toThrow(
      /Unable to resolve the jest adapter/
    );
    expect(resolveAdapterSync().kind).not.toBe("jest");
  });

  it.each(["1", "0"])(
    "still resolves jest when JEST_WORKER_ID=%p",
    (workerId) => {
      removeInjectedIt();
      process.env.JEST_WORKER_ID = workerId;

      expect(resolveAdapterSync().kind).toBe("jest");
    }
  );
});
