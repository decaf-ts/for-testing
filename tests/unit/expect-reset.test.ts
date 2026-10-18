import { createExpect } from "../../src/expect";
import { reportObjects } from "../../src/reporter";

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
    default:
      throw new Error(`Unsupported matcher: ${JSON.stringify(matcher)}`);
  }
}

function installAdapter(): void {
  mockAdapterState.current = {
    kind: "jest",
    assert: matcherAssert,
    currentTestName: () => undefined,
  };
}

function makeReporter(): { reporter: any; reportObject: jest.Mock } {
  const reporter: any = {
    reportObject: jest.fn().mockResolvedValue(undefined),
  };
  reporter.expect = createExpect(reporter);
  return { reporter, reportObject: reporter.reportObject };
}

describe("reporter-scoped expectation accumulator", () => {
  beforeEach(() => {
    installAdapter();
  });

  afterEach(() => {
    mockAdapterState.current = undefined;
    jest.restoreAllMocks();
  });

  it("shares one accumulator across createExpect(reporter) facades and reporter.expect", () => {
    const { reporter } = makeReporter();
    const first = createExpect(reporter);
    const second = createExpect(reporter);

    first(2).referredToAs("value").to.be(2);

    expect(reporter.expect.getReport()).toContain(
      "Expected value to be 2 and received 2"
    );
    expect(second.getReport()).toContain(
      "Expected value to be 2 and received 2"
    );

    second(4).referredToAs("other").to.be(5);

    expect(first.getStatus()).toBe("Failed");
    expect(reporter.expect.getErrors()).toEqual([
      "Expected other to be 5 and received 4",
    ]);
    expect(first.getErrors()).toBe(second.getErrors());
  });

  it("yields independent accumulators when the reporter is omitted", () => {
    const first = createExpect();
    const second = createExpect();

    first(1).referredToAs("value").to.be(1);

    expect(first.getStatus()).toBe("Passed");
    expect(second.getReport()).toBe("");
    expect(second.getStatus()).toBe("Passed");
    expect(second.getErrors()).toEqual([]);
  });

  it("resets the accumulator after a passing reportObjects write", async () => {
    const { reporter, reportObject } = makeReporter();

    reporter.expect(2).referredToAs("value").to.be(2);

    const renderedReport = reporter.expect.getReport();
    await reportObjects(reporter, reporter.expect, {
      status: 200,
      data: { ok: true },
    });

    expect(reportObject).toHaveBeenNthCalledWith(1, "response", {
      status: "Passed",
      report: renderedReport,
    });
    expect(reportObject).toHaveBeenNthCalledWith(2, "report", {
      status: 200,
      report: renderedReport,
      response: { ok: true },
    });
    expect(reporter.expect.getStatus()).toBe("Passed");
    expect(reporter.expect.getReport()).toBe("");
    expect(reporter.expect.getErrors()).toEqual([]);
  });

  it("resets the accumulator after failed assertions while persisting the Failed report", async () => {
    const { reporter, reportObject } = makeReporter();

    reporter.expect(2).referredToAs("value").to.be(3);

    const renderedReport = reporter.expect.getReport();
    await expect(
      reportObjects(reporter, reporter.expect, { status: 500 })
    ).rejects.toThrow(
      "One or more assertions failed. See the report for details."
    );

    expect(renderedReport).toContain(
      "Expected value to be 3 and received 2"
    );
    expect(reportObject).toHaveBeenNthCalledWith(1, "response", {
      status: "Failed",
      report: renderedReport,
    });
    expect(reportObject).toHaveBeenNthCalledWith(2, "report", {
      status: 500,
      report: renderedReport,
      response: undefined,
    });
    expect(reporter.expect.getReport()).toBe("");
    expect(reporter.expect.getErrors()).toEqual([]);
    expect(reporter.expect.getStatus()).toBe("Passed");
  });

  it("starts the next scenario clean after a report", async () => {
    const { reporter, reportObject } = makeReporter();

    reporter.expect(2).referredToAs("first").to.be(2);
    await reportObjects(reporter, reporter.expect, { status: 200 });

    reporter.expect(5).referredToAs("second").to.be(5);
    await reportObjects(reporter, reporter.expect, { status: 201 });

    const secondReport = reportObject.mock.calls[2][1].report as string;
    expect(secondReport).toContain(
      "Expected second to be 5 and received 5"
    );
    expect(secondReport).not.toContain("first");
    expect(reportObject).toHaveBeenCalledTimes(4);
  });
});
