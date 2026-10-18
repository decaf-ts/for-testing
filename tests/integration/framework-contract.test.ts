import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  configure,
  expect as reportedExpect,
  getReporter,
  it as reportedIt,
  reportObjects,
  resetAdapter,
  resolveAdapterSync,
  setReporter,
  TestReporter,
  type FrameworkKind,
  type PrimitiveMatcher,
} from "../../src";

/**
 * One shared contract spec for every supported runner.
 *
 * The file is evaluated by jest, vitest and `@playwright/test` (the Playwright
 * entry at `framework-contract.playwright.ts` installs the runner's
 * `test`/`expect` globals first). It never imports a runner directly, and it
 * refuses to run when no supported runner is detected, so a misconfigured CI
 * job fails loudly instead of producing a silently empty suite.
 */

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

const RUNNER_ENV_KEYS = [
  "JEST_WORKER_ID",
  "VITEST",
  "VITEST_WORKSPACE_ID",
  "VITEST_MODE",
  "TEST_WORKER_INDEX",
  "TEST_PARALLEL_INDEX",
  "PLAYWRIGHT_TEST",
  "PLAYWRIGHT_TEST_BASE_URL",
  "PLAYWRIGHT_BROWSERS_PATH",
];

const scope = globalThis as unknown as Record<string, any>;

/**
 * Detects the runner evaluating this file from its own worker markers. The
 * resolver uses the same markers, so this is also a mirror of the production
 * detection contract.
 */
function runningFramework(): FrameworkKind | undefined {
  const env = process.env;
  if (env.JEST_WORKER_ID !== undefined) return "jest";
  if (env.VITEST || env.VITEST_WORKSPACE_ID || env.VITEST_MODE) return "vitest";
  if (
    env.TEST_WORKER_INDEX !== undefined ||
    env.TEST_PARALLEL_INDEX !== undefined ||
    env.PLAYWRIGHT_TEST
  ) {
    return "playwright";
  }
  return undefined;
}

const RUNNER = runningFramework();

if (!RUNNER) {
  throw new Error(
    "framework-contract.test.ts must run under jest, vitest or @playwright/test: " +
      "no supported runner marker was found (JEST_WORKER_ID / VITEST* / TEST_WORKER_INDEX)."
  );
}

const hostDescribe = scope.describe;
const hostIt = scope.it ?? scope.test;
const hostExpect = scope.expect;

if (
  typeof hostDescribe !== "function" ||
  typeof hostIt !== "function" ||
  typeof hostExpect !== "function"
) {
  throw new Error(
    `framework-contract.test.ts could not find the ${RUNNER} test/expect globals. ` +
      "The Playwright entry must install them before importing the shared spec."
  );
}

const CONTRACT_SUITE = `${RUNNER} adapter contract`;
const EVIDENCE_ROOT = fs.mkdtempSync(
  path.join(os.tmpdir(), `decaf-contract-${RUNNER}-`)
);

function caseList(): Array<[string, MatcherCase]> {
  return PASSING_CASES.map((entry) => [`passing ${entry.name}`, entry]).concat(
    FAILING_CASES.map((entry) => [`failing ${entry.name}`, entry])
  );
}

/**
 * A host-runner recorder used only to observe what `it.report` registers.
 * Tests registered here are never executed by the host runner; the captured
 * wrapper is invoked directly so the failure/report path can be asserted
 * without failing the real suite.
 */
function recordingHost(): {
  calls: Array<{ name: string; fn: () => unknown }>;
  test: any;
  expect: any;
} {
  const calls: Array<{ name: string; fn: () => unknown }> = [];
  const test = Object.assign(
    (name: string, fn: () => unknown) => {
      calls.push({ name, fn });
    },
    {
      skip: () => undefined,
      only: () => undefined,
      todo: () => undefined,
      fixme: () => undefined,
      each: undefined,
      getState: () => ({ currentTestName: "recorded contract test" }),
      info: () => ({ titlePath: ["recorded contract test"] }),
    }
  );
  const expectFn = () => ({ not: {} });
  return { calls, test, expect: expectFn };
}

function withSuppressedRunnerMarkers(fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of RUNNER_ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  try {
    fn();
  } finally {
    for (const key of RUNNER_ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

let reportedTestExecuted = false;

reportedIt.report(
  `${RUNNER} it.report registers and executes through the host runner`,
  async () => {
    reportedTestExecuted = true;
    hostExpect(resolveAdapterSync().kind).toBe(RUNNER);
  },
  { reporter: new TestReporter("contract-reported", EVIDENCE_ROOT) }
);

hostDescribe(CONTRACT_SUITE, () => {
  const originalReporter = getReporter();

  beforeEach(() => {
    configure({});
    resetAdapter();
  });

  afterEach(() => {
    configure({});
    resetAdapter();
    setReporter(originalReporter);
  });

  afterAll(() => {
    fs.rmSync(EVIDENCE_ROOT, { recursive: true, force: true });
  });

  hostIt(`${RUNNER}: auto-resolves its own adapter without configure()`, () => {
    configure({});
    resetAdapter();
    hostExpect(resolveAdapterSync().kind).toBe(RUNNER);
  });

  hostIt(`${RUNNER}: honors an explicit configure({ framework }) selection`, () => {
    configure({ framework: RUNNER });
    resetAdapter();
    const adapter = resolveAdapterSync();
    hostExpect(adapter.kind).toBe(RUNNER);
    const current = adapter.currentTestName();
    hostExpect(typeof current).toBe("string");
    hostExpect(String(current)).toContain(CONTRACT_SUITE);
  });

  hostIt(`${RUNNER}: maps every matcher through the host expect`, () => {
    const adapter = resolveAdapterSync();
    for (const [label, entry] of caseList()) {
      const shouldThrow = label.startsWith("failing");
      const assertion = () =>
        adapter.assert(entry.actual, entry.matcher, entry.negated ?? false);
      if (shouldThrow) hostExpect(assertion).toThrow();
      else hostExpect(assertion).not.toThrow();

      const negated = () =>
        adapter.assert(entry.actual, entry.matcher, true);
      if (shouldThrow) hostExpect(negated).not.toThrow();
      else hostExpect(negated).toThrow();
    }
  });

  hostIt(`${RUNNER}: it.report ran a real test through the host runner`, () => {
    hostExpect(reportedTestExecuted).toBe(true);
  });

  hostIt(`${RUNNER}: it.report persists an error through the reporter and rethrows`, async () => {
    const { calls, test, expect: fakeExpect } = recordingHost();
    const reported: Array<{ reference: string; json: any }> = [];
    const reporter = {
      reportObject: async (reference: string, json: any) => {
        reported.push({ reference, json });
      },
    };
    const failure = Object.assign(new Error("contract failure"), {
      cause: { code: "E_CONTRACT" },
    });

    const original = {
      it: scope.it,
      test: scope.test,
      expect: scope.expect,
    };
    try {
      withSuppressedRunnerMarkers(() => {
        scope.it = test;
        scope.test = test;
        scope.expect = fakeExpect;
        configure({ framework: RUNNER });
        resetAdapter();
        reportedIt.report(
          "recorded failing report",
          async () => {
            throw failure;
          },
          { reporter: reporter as never }
        );
      });
    } finally {
      scope.it = original.it;
      scope.test = original.test;
      scope.expect = original.expect;
      configure({});
      resetAdapter();
    }

    hostExpect(calls.length).toBe(1);
    hostExpect(calls[0].name).toBe("recorded failing report");
    await hostExpect(calls[0].fn()).rejects.toBe(failure);
    hostExpect(reported).toHaveLength(1);
    hostExpect(reported[0].reference).toBe("error");
    hostExpect(reported[0].json).toEqual({
      message: "contract failure",
      cause: { code: "E_CONTRACT" },
    });
  });

  hostIt(`${RUNNER}: expect(...).referredToAs(...).to.* accumulates results`, () => {
    const reporter = new TestReporter("contract-expect", EVIDENCE_ROOT);
    setReporter(reporter);

    reportedExpect(2).referredToAs("value").to.be(2);
    reportedExpect([1, 2]).referredToAs("items").to.contain(2);
    reportedExpect(3).referredToAs("value").not.to.be(2);
    hostExpect(reportedExpect.getStatus()).toBe("Passed");
    hostExpect(reportedExpect.getReport()).toContain(
      "Expected value to be 2 and received 2"
    );
    hostExpect(reportedExpect.checkHasError()).toBe(false);

    reportedExpect(3).referredToAs("value").to.be(2);
    hostExpect(reportedExpect.getStatus()).toBe("Failed");
    hostExpect(reportedExpect.checkHasError()).toBe(true);
    hostExpect(reportedExpect.getErrors().length).toBe(1);
    hostExpect(reportedExpect.getErrors()[0]).toContain(
      "Expected value to be 2 and received 3"
    );

    reportedExpect.reset();
    hostExpect(reportedExpect.getStatus()).toBe("Passed");
    setReporter(undefined as never);
  });

  hostIt(`${RUNNER}: persists passing evidence through the reporter`, async () => {
    const restoreStorage = enableEvidenceStorage();
    const restoreBridges = stubReporterBridges();
    const reporter = new TestReporter("contract-evidence-pass", EVIDENCE_ROOT);
    setReporter(reporter);
    reportedExpect(2).referredToAs("value").to.be(2);

    await reportObjects(
      reporter,
      reportedExpect,
      { status: 200, data: { ok: true } },
      { case: "contract" }
    );

    const files = findEvidenceFiles(
      path.join(EVIDENCE_ROOT, "contract-evidence-pass")
    );
    hostExpect(files.some((file) => file.endsWith("response.json"))).toBe(true);
    hostExpect(files.some((file) => file.endsWith("report.json"))).toBe(true);
    const report = JSON.parse(
      fs.readFileSync(
        files.find((file) => file.endsWith("report.json")) as string,
        "utf-8"
      )
    );
    hostExpect(report.status).toBe(200);
    hostExpect(report.case).toBe("contract");
    hostExpect(report.report).toContain("Expected value to be 2 and received 2");
    restoreBridges();
    restoreStorage();
    setReporter(undefined as never);
  });

  hostIt(`${RUNNER}: persists failing evidence and surfaces the failure`, async () => {
    const restoreStorage = enableEvidenceStorage();
    const restoreBridges = stubReporterBridges();
    const reporter = new TestReporter("contract-evidence-fail", EVIDENCE_ROOT);
    setReporter(reporter);
    reportedExpect(3).referredToAs("value").to.be(2);
    hostExpect(reportedExpect.checkHasError()).toBe(true);

    await hostExpect(
      reportObjects(reporter, reportedExpect, { status: 500, data: {} })
    ).rejects.toThrow("One or more assertions failed");

    const files = findEvidenceFiles(
      path.join(EVIDENCE_ROOT, "contract-evidence-fail")
    );
    const responseFile = files.find((file) =>
      file.endsWith("response.json")
    ) as string;
    hostExpect(Boolean(responseFile)).toBe(true);
    const response = JSON.parse(fs.readFileSync(responseFile, "utf-8"));
    hostExpect(response.status).toBe("Failed");
    hostExpect(response.report).toContain(
      "Expected value to be 2 and received 3"
    );
    restoreBridges();
    restoreStorage();
    setReporter(undefined as never);
  });
});

/**
 * `jest-html-reporters/helper` is imported without a file extension by the
 * reporter bridge, which Node ESM (the Playwright worker) cannot resolve. The
 * contract is about persisted evidence files, so the optional jest-html
 * reporters bridge is stubbed while the evidence storage path stays real.
 */
function stubReporterBridges(): () => void {
  const target = TestReporter as unknown as Record<string, unknown>;
  const previous = {
    addMsgFunction: target.addMsgFunction,
    addAttachFunction: target.addAttachFunction,
  };
  target.addMsgFunction = async () => undefined;
  target.addAttachFunction = async () => undefined;
  return () => {
    target.addMsgFunction = previous.addMsgFunction;
    target.addAttachFunction = previous.addAttachFunction;
  };
}

function enableEvidenceStorage(): () => void {
  const key = "TEST_REPORTER_STORAGE_ENABLED";
  const previous = process.env[key];
  process.env[key] = "true";
  return () => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  };
}

function findEvidenceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(full);
    }
  };
  walk(root);
  return found;
}
