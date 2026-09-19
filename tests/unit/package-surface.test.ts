import { loadWorkspaceModule } from "../workspace-target";

describe("for-testing package surface", () => {
  it("resolves the root export and the ui subpath export", async () => {
    const root: any = await import("@decaf-ts/for-testing");

    expect(root.TestReporter).toBeDefined();
    expect(root.itReportsOnFailure).toBeDefined();
    expect(root.ReportExpect).toBeDefined();
    expect(root.JestPerformanceRunner).toBeDefined();
    expect(root.runAndReport).toBeDefined();
    expect(root.ui).toBeDefined();

    const uiSubpath: any = await import("@decaf-ts/for-testing/ui");
    expect(uiSubpath).toBeDefined();

    // (a) The `ui` named export and the `./ui` subpath must resolve to the
    // same module surface, so either import path exposes identical helpers.
    expect(root.ui).toBe(uiSubpath);
    expect(Object.keys(root.ui).sort()).toEqual(Object.keys(uiSubpath).sort());
  });

  it("re-exports every @decaf-ts/utils/tests export from the root surface", async () => {
    const root: any = await import("@decaf-ts/for-testing");
    const utilsTests: any = await import("@decaf-ts/utils/tests");

    const utilsKeys = Object.keys(utilsTests).filter((key) => key !== "default");
    expect(utilsKeys.length).toBeGreaterThan(0);

    // (b) Parity: the new package is the relocation of `@decaf-ts/utils/tests`,
    // so no helper may be dropped from the root surface.
    for (const key of utilsKeys) {
      expect(root).toHaveProperty(key);
      expect(root[key]).toBeDefined();
    }
  });

  it("resolves the normalized root default export through the workspace target", async () => {
    const root = await loadWorkspaceModule();

    expect(root.TestReporter).toBeDefined();
    expect(root.ReportExpect).toBeDefined();
    expect(root.JestPerformanceRunner).toBeDefined();
    expect(root.ui).toBeDefined();
  });
});
