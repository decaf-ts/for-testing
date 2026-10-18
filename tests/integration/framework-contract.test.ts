import {
  configure,
  resetAdapter,
  resolveAdapterSync,
  type FrameworkKind,
  type PrimitiveMatcher,
} from "../../src";

interface MatcherCase {
  name: string;
  actual: unknown;
  matcher: PrimitiveMatcher<unknown>;
  negated?: boolean;
}

const PASSING_CASES: MatcherCase[] = [
  { name: "toBe", actual: 2, matcher: { kind: "toBe", expected: 2 } },
  {
    name: "toEqual",
    actual: { a: 1 },
    matcher: { kind: "toEqual", expected: { a: 1 } },
  },
  {
    name: "toContain",
    actual: [1, 2],
    matcher: { kind: "toContain", expected: 2 },
  },
  {
    name: "toBeGreaterThan",
    actual: 2,
    matcher: { kind: "toBeGreaterThan", expected: 1 },
  },
  {
    name: "toBeGreaterThanOrEqual",
    actual: 2,
    matcher: { kind: "toBeGreaterThanOrEqual", expected: 2 },
  },
  {
    name: "toBeLessThan",
    actual: 2,
    matcher: { kind: "toBeLessThan", expected: 3 },
  },
  {
    name: "toBeLessThanOrEqual",
    actual: 2,
    matcher: { kind: "toBeLessThanOrEqual", expected: 2 },
  },
  { name: "toBeDefined", actual: 0, matcher: { kind: "toBeDefined" } },
  { name: "toBeTruthy", actual: "yes", matcher: { kind: "toBeTruthy" } },
];

const FAILING_CASES: MatcherCase[] = [
  { name: "toBe", actual: 3, matcher: { kind: "toBe", expected: 2 } },
  {
    name: "toEqual",
    actual: { a: 2 },
    matcher: { kind: "toEqual", expected: { a: 1 } },
  },
  {
    name: "toContain",
    actual: [1, 2],
    matcher: { kind: "toContain", expected: 3 },
  },
  {
    name: "toBeGreaterThan",
    actual: 2,
    matcher: { kind: "toBeGreaterThan", expected: 3 },
  },
  {
    name: "toBeGreaterThanOrEqual",
    actual: 2,
    matcher: { kind: "toBeGreaterThanOrEqual", expected: 3 },
  },
  {
    name: "toBeLessThan",
    actual: 2,
    matcher: { kind: "toBeLessThan", expected: 1 },
  },
  {
    name: "toBeLessThanOrEqual",
    actual: 2,
    matcher: { kind: "toBeLessThanOrEqual", expected: 1 },
  },
  {
    name: "toBeDefined",
    actual: undefined,
    matcher: { kind: "toBeDefined" },
  },
  { name: "toBeTruthy", actual: 0, matcher: { kind: "toBeTruthy" } },
];

function canResolve(specifier: string): boolean {
  try {
    require.resolve(specifier);
    return true;
  } catch {
    return false;
  }
}

function runningFramework(): FrameworkKind | undefined {
  if (process.env.JEST_WORKER_ID) return "jest";
  if (process.env.VITEST || process.env.VITEST_WORKSPACE_ID) return "vitest";
  if (process.env.PLAYWRIGHT_TEST || process.env.PLAYWRIGHT_TEST_BASE_URL) {
    return "playwright";
  }
  return undefined;
}

const RUNNING = runningFramework();
const AVAILABLE: Record<FrameworkKind, boolean> = {
  jest: RUNNING === "jest",
  vitest: RUNNING === "vitest" && canResolve("vitest"),
  playwright: RUNNING === "playwright" && canResolve("@playwright/test"),
};

function frameworkContract(kind: FrameworkKind): void {
  const describeFor = AVAILABLE[kind] ? describe : describe.skip;

  describeFor(`${kind} adapter contract`, () => {
    beforeEach(() => {
      configure({ framework: kind });
      resetAdapter();
    });

    afterEach(() => {
      configure({});
      resetAdapter();
    });

    it("resolves the requested adapter", () => {
      const adapter = resolveAdapterSync();
      expect(adapter.kind).toBe(kind);
      expect(typeof adapter.currentTestName()).toBe("string");
      expect(adapter.currentTestName()).toContain("adapter contract");
    });

    it.each(PASSING_CASES.map((entry) => [entry.name, entry] as const))(
      "accepts a passing %s assertion",
      (_name, entry) => {
        const adapter = resolveAdapterSync();
        expect(() =>
          adapter.assert(entry.actual, entry.matcher, entry.negated ?? false)
        ).not.toThrow();
      }
    );

    it.each(FAILING_CASES.map((entry) => [entry.name, entry] as const))(
      "rejects a failing %s assertion",
      (_name, entry) => {
        const adapter = resolveAdapterSync();
        expect(() =>
          adapter.assert(entry.actual, entry.matcher, entry.negated ?? false)
        ).toThrow();
      }
    );

    it.each(FAILING_CASES.map((entry) => [entry.name, entry] as const))(
      "accepts a negated failing %s assertion",
      (_name, entry) => {
        const adapter = resolveAdapterSync();
        expect(() =>
          adapter.assert(entry.actual, entry.matcher, true)
        ).not.toThrow();
      }
    );
  });
}

frameworkContract("jest");
frameworkContract("vitest");
frameworkContract("playwright");

describe("framework availability", () => {
  it("skips vitest and playwright cleanly when their packages are absent", () => {
    if (canResolve("vitest")) expect(AVAILABLE.vitest).toBe(RUNNING === "vitest");
    else expect(AVAILABLE.vitest).toBe(false);

    if (canResolve("@playwright/test")) {
      expect(AVAILABLE.playwright).toBe(RUNNING === "playwright");
    } else {
      expect(AVAILABLE.playwright).toBe(false);
    }
  });
});
