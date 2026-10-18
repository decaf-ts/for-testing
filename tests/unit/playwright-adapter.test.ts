import { configure, resetAdapter } from "../../src";
import { it } from "../../src/it";
import { createPlaywrightAdapter } from "../../src/frameworks/playwright/adapter";

interface MockPlaywright {
  registered: Array<{ mode: string; name: string }>;
  test: any;
  expect: any;
}

const mockPlaywright: MockPlaywright = {
  registered: [],
  test: undefined,
  expect: undefined,
};

const record = (mode: string) => (name: string) => {
  mockPlaywright.registered.push({ mode, name });
};

mockPlaywright.test = Object.assign(record("run"), {
  skip: record("skip"),
  only: record("only"),
  fixme: record("fixme"),
  info: () => ({ titlePath: ["playwright adapter suite", "it.each"] }),
});

mockPlaywright.expect = (actual: unknown) => ({
  toBe: (expected: unknown) => {
    if (actual !== expected) throw new Error("toBe failed");
  },
  toEqual: (expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error("toEqual failed");
  },
  toContain: (expected: unknown) => {
    if (!(actual as Array<unknown>).includes(expected))
      throw new Error("toContain failed");
  },
  toBeGreaterThan: (expected: number) => {
    if (!((actual as number) > expected)) throw new Error("toBeGreaterThan failed");
  },
  toBeGreaterThanOrEqual: (expected: number) => {
    if (!((actual as number) >= expected))
      throw new Error("toBeGreaterThanOrEqual failed");
  },
  toBeLessThan: (expected: number) => {
    if (!((actual as number) < expected)) throw new Error("toBeLessThan failed");
  },
  toBeLessThanOrEqual: (expected: number) => {
    if (!((actual as number) <= expected))
      throw new Error("toBeLessThanOrEqual failed");
  },
  toBeDefined: () => {
    if (actual === undefined) throw new Error("toBeDefined failed");
  },
  toBeTruthy: () => {
    if (!actual) throw new Error("toBeTruthy failed");
  },
});

jest.mock(
  "@playwright/test",
  () => ({ test: mockPlaywright.test, expect: mockPlaywright.expect }),
  { virtual: true }
);

describe("Playwright adapter it.each", () => {
  afterEach(() => {
    configure({});
    resetAdapter();
  });

  it("does not expose an each capability", () => {
    const adapter = createPlaywrightAdapter();

    expect(adapter.kind).toBe("playwright");
    expect(adapter.each).toBeUndefined();
    expect(adapter.currentTestName()).toBe(
      "playwright adapter suite › it.each"
    );
  });

  it("raises a descriptive error for the unsupported it.each facade", () => {
    configure({ framework: "playwright" });
    resetAdapter();

    expect(() => it.each).toThrow(
      "The playwright adapter does not support it.each. Use the framework's native API for this capability."
    );
  });

  it("raises a descriptive error for the unsupported it.concurrent facade", () => {
    configure({ framework: "playwright" });
    resetAdapter();

    expect(() => it.concurrent).toThrow(
      "The playwright adapter does not support it.concurrent. Use the framework's native API for this capability."
    );
  });
});
