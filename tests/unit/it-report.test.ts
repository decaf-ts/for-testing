import { configure, getReporter, reportObjects, setReporter } from "../../src";
import { createExpect } from "../../src/expect";
import { expect as reportedExpect } from "../../src/expect";
import { it as reportedIt } from "../../src/it";

const mockAdapterState: { current: any } = { current: undefined };

jest.mock("../../src/frameworks/resolver", () => ({
  resolveAdapterSync: () => mockAdapterState.current,
  getAdapter: () => mockAdapterState.current,
  resolveAdapter: async () => mockAdapterState.current,
  resetAdapter: () => undefined,
}));

const jestExpect = expect;

function matcherAssert(actual: any, matcher: any, negated: boolean): void {
  const target = negated ? jestExpect(actual).not : jestExpect(actual);
  switch (matcher.kind) {
    case "toBe":
      target.toBe(matcher.expected);
      return;
    case "toEqual":
      target.toEqual(matcher.expected);
      return;
    case "toContain":
      target.toContain(matcher.expected);
      return;
    case "toBeGreaterThan":
      target.toBeGreaterThan(matcher.expected);
      return;
    case "toBeGreaterThanOrEqual":
      target.toBeGreaterThanOrEqual(matcher.expected);
      return;
    case "toBeLessThan":
      target.toBeLessThan(matcher.expected);
      return;
    case "toBeLessThanOrEqual":
      target.toBeLessThanOrEqual(matcher.expected);
      return;
    case "toBeDefined":
      target.toBeDefined();
      return;
    case "toBeTruthy":
      target.toBeTruthy();
      return;
    default:
      throw new Error(`Unsupported matcher: ${JSON.stringify(matcher)}`);
  }
}

function installAdapter(): { run: jest.Mock; skip: jest.Mock; only: jest.Mock; todo: jest.Mock } {
  const adapter = {
    kind: "jest",
    run: jest.fn(),
    skip: jest.fn(),
    only: jest.fn(),
    todo: jest.fn(),
    each: undefined,
    concurrent: undefined,
    assert: matcherAssert,
    currentTestName: () => undefined,
  };
  mockAdapterState.current = adapter;
  return adapter;
}

describe("it.report jest adapter contract", () => {
  const originalReporter = getReporter();

  beforeEach(() => {
    configure({ framework: "jest" });
  });

  afterEach(() => {
    setReporter(originalReporter);
    configure({});
    jest.restoreAllMocks();
  });

  it("registers through the adapter, passes the timeout, and runs the body", async () => {
    const adapter = installAdapter();
    const reporter = { reportObject: jest.fn().mockResolvedValue(undefined) };
    let executed = false;

    reportedIt.report(
      "reported test",
      async () => {
        executed = true;
      },
      { reporter: reporter as never, timeout: 4321 }
    );

    expect(adapter.run).toHaveBeenCalledTimes(1);
    const [name, wrapped, timeout] = adapter.run.mock.calls[0];
    expect(name).toBe("reported test");
    expect(timeout).toBe(4321);

    await wrapped();
    expect(executed).toBe(true);
    expect(reporter.reportObject).not.toHaveBeenCalled();
  });

  it("reports {message, cause} through the reporter and rethrows on failure", async () => {
    const adapter = installAdapter();
    const reporter = { reportObject: jest.fn().mockResolvedValue(undefined) };
    const failure = Object.assign(new Error("boom"), { cause: { code: "E42" } });

    reportedIt.report("failing test", async () => Promise.reject(failure), {
      reporter: reporter as never,
    });

    const wrapped = adapter.run.mock.calls[0][1];
    await expect(wrapped()).rejects.toBe(failure);
    expect(reporter.reportObject).toHaveBeenCalledWith("error", {
      message: "boom",
      cause: { code: "E42" },
    });
  });

  it("registers it.report.skip and it.report.only through the matching adapter modes", () => {
    const adapter = installAdapter();
    const reporter = { reportObject: jest.fn() };

    reportedIt.report.skip("skipped reported test", () => undefined, {
      reporter: reporter as never,
    });
    reportedIt.report.only("only reported test", () => undefined, {
      reporter: reporter as never,
    });

    expect(adapter.skip).toHaveBeenCalledWith(
      "skipped reported test",
      expect.any(Function),
      undefined
    );
    expect(adapter.only).toHaveBeenCalledWith(
      "only reported test",
      expect.any(Function),
      undefined
    );
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it("expands the array form of it.report.each with %-tokens", async () => {
    const adapter = installAdapter();
    const calls: number[][] = [];
    setReporter({ reportObject: jest.fn() } as never);

    (reportedIt.report.each as any)([
      [1, 2],
      [3, 4],
    ])("adds %i + %i", (a: number, b: number) => {
      calls.push([a, b]);
    });

    expect(adapter.run).toHaveBeenCalledTimes(2);
    expect(adapter.run.mock.calls.map((call) => call[0])).toEqual([
      "adds 1 + 2",
      "adds 3 + 4",
    ]);
    for (const call of adapter.run.mock.calls) await call[1]();
    expect(calls).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  it("expands the tagged-template form with Jest table semantics", async () => {
    const adapter = installAdapter();
    const calls: Array<{ a: number; b: number }> = [];
    setReporter({ reportObject: jest.fn() } as never);

    (reportedIt.report.each as any)`
      a | b
      ${1} | ${2}
      ${3} | ${4}
    `("adds $a + $b", (row: { a: number; b: number }) => {
      calls.push(row);
    });

    expect(adapter.run).toHaveBeenCalledTimes(2);
    expect(adapter.run.mock.calls.map((call) => call[0])).toEqual([
      "adds 1 + 2",
      "adds 3 + 4",
    ]);
    for (const call of adapter.run.mock.calls) await call[1]();
    expect(calls).toEqual([
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]);
  });

  it("maps plain it.skip, it.only and it.todo to their adapter primitives", () => {
    const adapter = installAdapter();

    reportedIt.skip("plain skip", () => undefined);
    reportedIt.only("plain only", () => undefined);
    reportedIt.todo("plain todo");
    reportedIt("plain todo without handler");

    expect(adapter.skip).toHaveBeenCalledWith(
      "plain skip",
      expect.any(Function),
      undefined
    );
    expect(adapter.only).toHaveBeenCalledWith(
      "plain only",
      expect.any(Function),
      undefined
    );
    expect(adapter.todo.mock.calls.map((call) => call[0])).toEqual([
      "plain todo",
      "plain todo without handler",
    ]);
    expect(adapter.run).not.toHaveBeenCalled();
  });

  it("accumulates standalone expect calls on the reporter and persists them with reportObjects", async () => {
    installAdapter();
    const reporter = {
      expect: createExpect(),
      reportObject: jest.fn().mockResolvedValue(undefined),
    };
    setReporter(reporter as never);

    reportedExpect(2).referredToAs("value").to.be(2);
    reportedExpect({ a: 1 }).referredToAs("payload").to.equal({ a: 1 });

    await reportObjects(reporter as never, reporter.expect, {
      status: 200,
      data: { ok: true },
    });

    expect(reporter.expect.getStatus()).toBe("Passed");
    expect(reporter.expect.getReport()).toContain(
      "Expected value to be 2 and received 2"
    );
    expect(reporter.reportObject).toHaveBeenNthCalledWith(1, "response", {
      status: "Passed",
      report: reporter.expect.getReport(),
    });
    expect(reporter.reportObject).toHaveBeenNthCalledWith(2, "report", {
      status: 200,
      report: reporter.expect.getReport(),
      response: { ok: true },
    });
  });

  it("fails reportObjects when the standalone expect accumulator has errors", async () => {
    installAdapter();
    const reporter = {
      expect: createExpect(),
      reportObject: jest.fn().mockResolvedValue(undefined),
    };
    setReporter(reporter as never);

    reportedExpect(2).referredToAs("value").to.be(3);

    await expect(
      reportObjects(reporter as never, reporter.expect, { status: 500 })
    ).rejects.toThrow(
      "One or more assertions failed. See the report for details."
    );

    expect(reporter.expect.getStatus()).toBe("Failed");
    expect(reporter.expect.getErrors()).toEqual([
      "Expected value to be 3 and received 2",
    ]);
  });
});
