import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  TestReporter,
  TestReporterStorageEnabledEnvKey,
} from "../../src/TestReporter";

jest.mock("@decaf-ts/utils", () => {
  const actual = jest.requireActual("@decaf-ts/utils");
  return { ...actual, installIfNotAvailable: jest.fn() };
});

jest.mock(
  "jest-html-reporters/helper",
  () => ({
    addMsg: jest.fn().mockResolvedValue(undefined),
    addAttach: jest.fn().mockResolvedValue(undefined),
  }),
  { virtual: true }
);

jest.mock(
  "json2md",
  () => jest.fn().mockImplementation(() => "mocked-markdown"),
  { virtual: true }
);

jest.mock(
  "chartjs-node-canvas",
  () => ({
    ChartJSNodeCanvas: jest.fn().mockImplementation(() => ({
      renderToBuffer: jest.fn().mockResolvedValue(Buffer.from("mocked-image")),
    })),
  }),
  { virtual: true }
);

function findFilesNamed(root: string, name: string): string[] {
  const found: string[] = [];
  if (!fs.existsSync(root)) return found;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      found.push(...findFilesNamed(entryPath, name));
    } else if (entry.name === name) {
      found.push(entryPath);
    }
  }
  return found;
}

describe("TestReporter evidence path containment", () => {
  const testCase = "path-traversal-regression";
  const tempDirs: string[] = [];
  let originalStorageEnabled: string | undefined;

  beforeEach(() => {
    originalStorageEnabled = process.env[TestReporterStorageEnabledEnvKey];
    process.env[TestReporterStorageEnabledEnvKey] = "true";
    (TestReporter as any).addMsgFunction = undefined;
    (TestReporter as any).addAttachFunction = undefined;
  });

  afterEach(() => {
    if (originalStorageEnabled === undefined) {
      delete process.env[TestReporterStorageEnabledEnvKey];
    } else {
      process.env[TestReporterStorageEnabledEnvKey] = originalStorageEnabled;
    }
  });

  afterAll(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("neutralizes ../ and ../../ evidence references inside the per-test directory", async () => {
    const tmpBasePath = fs.mkdtempSync(
      path.join(os.tmpdir(), "for-testing-evidence-")
    );
    tempDirs.push(tmpBasePath);

    const reporter = new TestReporter(testCase, tmpBasePath);

    await reporter.reportData("../escape", "x");
    await reporter.reportData("../../escape", "x");

    const testCaseRoot = path.join(tmpBasePath, testCase);

    const outsideRoots = [
      path.dirname(tmpBasePath),
      path.dirname(path.dirname(tmpBasePath)),
      path.parse(tmpBasePath).root,
    ];
    for (const dir of outsideRoots) {
      expect(fs.existsSync(path.join(dir, "escape.json"))).toBe(false);
      expect(fs.existsSync(path.join(dir, "escape"))).toBe(false);
    }

    // The reference must not resolve directly under the test-case root either:
    // that is where an unsanitized `../escape.json` would have landed.
    expect(fs.existsSync(path.join(testCaseRoot, "escape.json"))).toBe(false);

    // The evidence must land inside the per-test evidence directory.
    const stored = findFilesNamed(testCaseRoot, "escape.json");
    expect(stored).toHaveLength(1);

    const evidenceDir = path.dirname(stored[0]);
    expect(evidenceDir.startsWith(testCaseRoot + path.sep)).toBe(true);
    expect(evidenceDir).not.toBe(testCaseRoot);
    expect(fs.readFileSync(stored[0], "utf-8")).toBe('"x"');
  });
});
