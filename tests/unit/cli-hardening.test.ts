import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { confineCliPath, parseBrowser } from "../../src/cli-module";
import {
  boundResponseBody,
  PROVIDER_RESPONSE_MAX,
} from "../../src/posttest/core";
import { fetchXrayToken } from "../../src/posttest/xray";

const PROJECT_ROOT_ENV = "DECAF_TEST_PROJECT_ROOT";
const ALLOWED_ROOTS_ENV = "DECAF_TEST_ALLOWED_ROOTS";

describe("CLI hardening", () => {
  const originalCwd = process.cwd();
  const originalProjectRoot = process.env[PROJECT_ROOT_ENV];
  const originalAllowedRoots = process.env[ALLOWED_ROOTS_ENV];
  let projectRoot: string;
  let outsideRoot: string;

  function restoreEnv(
    key: string,
    value: string | undefined
  ): void {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  function makeTempDir(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  }

  beforeEach(() => {
    projectRoot = makeTempDir("decaf-cli-project-");
    outsideRoot = makeTempDir("decaf-cli-outside-");
    process.chdir(projectRoot);
    delete process.env[PROJECT_ROOT_ENV];
    delete process.env[ALLOWED_ROOTS_ENV];
  });

  afterEach(() => {
    process.chdir(originalCwd);
    restoreEnv(PROJECT_ROOT_ENV, originalProjectRoot);
    restoreEnv(ALLOWED_ROOTS_ENV, originalAllowedRoots);
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  });

  describe("confineCliPath", () => {
    it("accepts project-relative and in-root absolute paths", () => {
      expect(confineCliPath("reports/out.json", "--out")).toBe(
        path.join(projectRoot, "reports", "out.json")
      );
      expect(
        confineCliPath(path.join(projectRoot, "nested", "junit.xml"), "--junit")
      ).toBe(path.join(projectRoot, "nested", "junit.xml"));
    });

    it("rejects parent-directory and absolute escapes", () => {
      expect(() => confineCliPath("../escape.json", "--out")).toThrow(
        /outside the allowed project roots/
      );
      expect(() =>
        confineCliPath(path.join(outsideRoot, "out.json"), "--out")
      ).toThrow(/outside the allowed project roots/);
    });

    it("rejects a symlink that escapes the project root", () => {
      const linkPath = path.join(projectRoot, "link");
      try {
        fs.symlinkSync(outsideRoot, linkPath, "dir");
      } catch {
        return;
      }

      expect(() => confineCliPath("link/out.json", "--out")).toThrow(
        /outside the allowed project roots/
      );
    });

    it("rejects a symlink whose missing nested output directory hides the escape (S2)", () => {
      const linkPath = path.join(projectRoot, "link");
      try {
        fs.symlinkSync(outsideRoot, linkPath, "dir");
      } catch {
        return;
      }

      expect(() =>
        confineCliPath("link/missing-subdir/out.json", "--out")
      ).toThrow(/outside the allowed project roots/);
    });

    it("accepts a not-yet-existing nested output path inside the project root", () => {
      expect(
        confineCliPath("reports/missing-subdir/out.json", "--out")
      ).toBe(path.join(projectRoot, "reports", "missing-subdir", "out.json"));
    });

    it("honours DECAF_TEST_PROJECT_ROOT as the confinement root", () => {
      const otherRoot = makeTempDir("decaf-cli-env-root-");
      try {
        process.env[PROJECT_ROOT_ENV] = otherRoot;

        expect(
          confineCliPath(path.join(otherRoot, "out.json"), "--out")
        ).toBe(path.join(otherRoot, "out.json"));
        expect(() =>
          confineCliPath(path.join(projectRoot, "out.json"), "--out")
        ).toThrow(/outside the allowed project roots/);
      } finally {
        fs.rmSync(otherRoot, { recursive: true, force: true });
      }
    });

    it("accepts roots listed in DECAF_TEST_ALLOWED_ROOTS", () => {
      const secondRoot = makeTempDir("decaf-cli-allowed-");
      try {
        process.env[ALLOWED_ROOTS_ENV] = [outsideRoot, secondRoot].join(
          path.delimiter
        );

        expect(
          confineCliPath(path.join(outsideRoot, "out.json"), "--out")
        ).toBe(path.join(outsideRoot, "out.json"));
        expect(
          confineCliPath(path.join(secondRoot, "junit.xml"), "--junit")
        ).toBe(path.join(secondRoot, "junit.xml"));
      } finally {
        fs.rmSync(secondRoot, { recursive: true, force: true });
      }
    });
  });

  describe("parseBrowser", () => {
    it.each(["chromium", "firefox", "webkit"] as const)(
      "accepts %s",
      (browser) => {
        expect(parseBrowser(browser)).toBe(browser);
      }
    );

    it("defaults to chromium", () => {
      expect(parseBrowser()).toBe("chromium");
    });

    it.each(["safari", "chrome", "chromium-headless", ""])(
      "rejects %p",
      (browser) => {
        expect(() => parseBrowser(browser)).toThrow(/Unsupported browser/);
      }
    );
  });

  describe("boundResponseBody", () => {
    it("keeps bodies at or under the limit intact", () => {
      const atLimit = "x".repeat(PROVIDER_RESPONSE_MAX);

      expect(PROVIDER_RESPONSE_MAX).toBe(2000);
      expect(boundResponseBody(atLimit)).toBe(atLimit);
      expect(boundResponseBody("  trimmed  ")).toBe("trimmed");
    });

    it("truncates bodies beyond 2000 characters with a marker", () => {
      const body = "y".repeat(PROVIDER_RESPONSE_MAX + 25);
      const bounded = boundResponseBody(body);

      expect(bounded.startsWith("y".repeat(PROVIDER_RESPONSE_MAX))).toBe(true);
      expect(bounded).toContain("…");
      expect(bounded).toContain("[truncated 25 characters]");
      expect(bounded).not.toContain("y".repeat(PROVIDER_RESPONSE_MAX + 1));
    });

    it("supports a custom maximum", () => {
      expect(boundResponseBody("abcdef", 3)).toBe(
        "abc… [truncated 3 characters]"
      );
    });

    it("bounds provider response bodies echoed into error messages", async () => {
      const body = "z".repeat(PROVIDER_RESPONSE_MAX + 40);
      const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => body,
      } as unknown as Response);

      try {
        await expect(fetchXrayToken("id", "secret")).rejects.toThrow(
          /truncated 40 characters/
        );
      } finally {
        fetchSpy.mockRestore();
      }
    });
  });
});
