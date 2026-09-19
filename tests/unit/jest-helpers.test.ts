import {
  ensureReporterCollectsEvidencesConfig,
  getReporter,
  reportObjects,
  ReportExpect,
  setReporter,
  waitForConfiguredSleep,
} from "../../src";
import {
  TestReporter,
  TestReporterStorageEnabledEnvKey,
  TestReporterStoragePathEnvKey,
} from "../../src/TestReporter";

describe("shared jest helpers", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[TestReporterStorageEnabledEnvKey];
    delete process.env[TestReporterStoragePathEnvKey];
    delete process.env.TEST_REPORTER_STORE_EVIDENCE;
    delete process.env.SLEEP;
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it("configures the reporter storage defaults", async () => {
    await ensureReporterCollectsEvidencesConfig();

    expect(process.env[TestReporterStorageEnabledEnvKey]).toBe("false");
    expect(process.env[TestReporterStoragePathEnvKey]).toContain(
      "workdocs/reports/evidences"
    );
  });

  it("preserves legacy store evidence enablement", async () => {
    process.env.TEST_REPORTER_STORE_EVIDENCE = "true";

    await ensureReporterCollectsEvidencesConfig();

    expect(process.env[TestReporterStorageEnabledEnvKey]).toBe("true");
  });

  it("reports assertion failures and propagates them", async () => {
    const reporter = {
      reportObject: jest.fn().mockResolvedValue(undefined),
    } as any;
    const report = new ReportExpect();

    report.assertToBe(1, 2, "value");

    await expect(
      reportObjects(reporter, report, { status: 500, data: { foo: "bar" } }, {
        extra: 123,
      })
    ).rejects.toThrow("One or more assertions failed. See the report for details.");

    expect(reporter.reportObject).toHaveBeenCalledTimes(2);
    expect(reporter.reportObject).toHaveBeenNthCalledWith(1, "response", {
      status: "Failed",
      report: report.getReport(),
    });
    expect(reporter.reportObject).toHaveBeenNthCalledWith(2, "report", {
      status: 500,
      report: report.getReport(),
      response: { foo: "bar" },
      extra: 123,
    });
  });

  it("waits only when SLEEP is configured", async () => {
    const spy = jest.spyOn(globalThis, "setTimeout");
    process.env.SLEEP = "0";

    await waitForConfiguredSleep();

    expect(spy).not.toHaveBeenCalled();
  });

  it("installs and returns the test-scoped reporter", () => {
    const rep = { marker: true } as unknown as TestReporter;

    setReporter(rep);

    expect(getReporter()).toBe(rep);
  });
});
