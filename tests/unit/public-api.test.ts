import * as forTesting from "../../src";

describe("public package entry point", () => {
  it("exports the complete reporter API from the package root", () => {
    expect(typeof forTesting.it).toBe("function");
    expect(typeof forTesting.expect).toBe("function");
    expect(typeof forTesting.createExpect).toBe("function");
    expect(typeof forTesting.itReportsOnFailure).toBe("function");
    expect(typeof forTesting.ReportExpect).toBe("function");
    expect(typeof forTesting.getReporter).toBe("function");
    expect(typeof forTesting.setReporter).toBe("function");
    expect(typeof forTesting.reportObjects).toBe("function");
    expect(typeof forTesting.TestReporter).toBe("function");
  });
});
