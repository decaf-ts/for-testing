import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = path.resolve(__dirname, "../..");
const reporterModule = pathToFileURL(
  path.join(projectRoot, "src", "index.ts")
).href;

describe("TestReporter ESM helper bridge", () => {
  it("loads the real jest-html-reporters helper under Node ESM and persists a message", () => {
    const tempRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "saa998-esm-bridge-")
    );
    const tempReports = path.join(tempRoot, "jest-html-reporters-temp");
    const basePath = path.join(tempRoot, "base");

    try {
      const script = `
import { TestReporter } from ${JSON.stringify(reporterModule)};
const reporter = new TestReporter("esm-bridge", ${JSON.stringify(basePath)});
await reporter.reportMessage("esm bridge", "bridge message body");
console.log("BRIDGE_OK");
`;

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", script],
        {
          cwd: projectRoot,
          env: {
            ...process.env,
            JEST_HTML_REPORTERS_TEMP_DIR_PATH: tempReports,
          },
          encoding: "utf8",
          timeout: 120000,
        }
      );

      expect(result.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("BRIDGE_OK");

      const dataDir = path.join(tempReports, "data");
      const files = fs
        .readdirSync(dataDir)
        .filter((file) => file.endsWith(".json"));
      expect(files.length).toBeGreaterThan(0);

      const persisted = files.map(
        (file) =>
          JSON.parse(
            fs.readFileSync(path.join(dataDir, file), "utf8")
          ) as Record<string, unknown>
      );
      expect(
        persisted.some((entry) =>
          String(entry.description).includes("bridge message body")
        )
      ).toBe(true);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
