import {
  getReporter,
  itReportsOnFailure,
  setReporter,
  type TestReporter,
} from "../../src";

const mockAdapterState: { current: any } = { current: undefined };

jest.mock("../../src/frameworks/resolver", () => ({
  resolveAdapterSync: () => mockAdapterState.current,
  getAdapter: () => mockAdapterState.current,
  resolveAdapter: async () => mockAdapterState.current,
  resetAdapter: () => undefined,
}));

function installAdapter(): {
  run: jest.Mock;
  skip: jest.Mock;
  only: jest.Mock;
  todo: jest.Mock;
} {
  const adapter = {
    kind: "jest",
    run: jest.fn(),
    skip: jest.fn(),
    only: jest.fn(),
    todo: jest.fn(),
    each: undefined,
    concurrent: undefined,
    assert: jest.fn(),
    currentTestName: () => undefined,
  };
  mockAdapterState.current = adapter;
  return adapter;
}

describe("itReportsOnFailure legacy wrapper", () => {
  const originalReporter = getReporter();

  afterEach(() => {
    setReporter(originalReporter);
    jest.restoreAllMocks();
  });

  it("delegates to it.report and persists {message, cause} before rethrowing", async () => {
    const adapter = installAdapter();
    const reporter = { reportObject: jest.fn().mockResolvedValue(undefined) };
    setReporter(reporter as unknown as TestReporter);
    const failure = Object.assign(new Error("boom"), {
      cause: { code: "E42" },
    });

    await itReportsOnFailure("legacy failing test", async () => {
      throw failure;
    });

    expect(adapter.run).toHaveBeenCalledTimes(1);
    expect(adapter.skip).not.toHaveBeenCalled();
    expect(adapter.run.mock.calls[0][0]).toBe("legacy failing test");

    const wrapped = adapter.run.mock.calls[0][1];
    await expect(wrapped()).rejects.toBe(failure);
    expect(reporter.reportObject).toHaveBeenCalledWith("error", {
      message: "boom",
      cause: { code: "E42" },
    });
  });

  it("delegates to it.report.skip when the skip flag is true", async () => {
    const adapter = installAdapter();
    const reporter = { reportObject: jest.fn() };
    setReporter(reporter as unknown as TestReporter);

    await itReportsOnFailure("legacy skipped test", () => undefined, true);
    await itReportsOnFailure("legacy default test", () => undefined);

    expect(adapter.skip).toHaveBeenCalledTimes(1);
    expect(adapter.skip.mock.calls[0][0]).toBe("legacy skipped test");
    expect(adapter.run).toHaveBeenCalledTimes(1);
    expect(adapter.run.mock.calls[0][0]).toBe("legacy default test");
  });

  it("no-ops the evidence write when no reporter is installed", async () => {
    // Intentional behavior change from 84bd171: the pre-refactor wrapper
    // called getReporter().reportObject(...) unconditionally, so a missing
    // reporter produced a TypeError ("Cannot read properties of undefined
    // (reading 'reportObject')") that masked the real test failure. The
    // reporter is now optional, so the original failure propagates unchanged.
    const adapter = installAdapter();
    setReporter(undefined as unknown as TestReporter);
    const failure = new Error("real failure");

    await itReportsOnFailure("unreported failing test", async () => {
      throw failure;
    });

    const wrapped = adapter.run.mock.calls[0][1];
    await expect(wrapped()).rejects.toBe(failure);
    expect(getReporter()).toBeUndefined();
  });
});
