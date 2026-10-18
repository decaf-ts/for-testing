import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFallbackJunit, parseJunitFile } from "../../src/testImporter";

const JUNIT_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<testsuites>",
  '  <testsuite name="PTP-123">',
  '    <testcase classname="PTP-123" name="STEP 1 - passes"></testcase>',
  '    <testcase classname="PTP-123" name="STEP 2 - fails">',
  '      <failure message="expected true">stack trace here</failure>',
  "    </testcase>",
  '    <testcase classname="PTP-123" name="STEP 3 - errors">',
  "      <error>error detail</error>",
  "    </testcase>",
  '    <testcase classname="PTP-123" name="STEP 4 - skipped">',
  "      <skipped/>",
  "    </testcase>",
  "  </testsuite>",
  "</testsuites>",
].join("\n");

const MIXED_SELF_CLOSING_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<testsuites>",
  '  <testsuite name="PTP-123">',
  '    <testcase classname="PTP-123" name="STEP 1 - passes"/>',
  '    <testcase classname="PTP-123" name="STEP 2 - fails">',
  "      <failure>stack trace here</failure>",
  "    </testcase>",
  "  </testsuite>",
  "</testsuites>",
].join("\n");

const INTERLEAVED_SELF_CLOSING_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<testsuites>",
  '  <testsuite name="PTP-123">',
  '    <testcase classname="PTP-123" name="STEP 1 - fails">',
  "      <failure>first failure</failure>",
  "    </testcase>",
  '    <testcase classname="PTP-123" name="STEP 2 - passes"/>',
  '    <testcase classname="PTP-123" name="STEP 3 - passes" />',
  '    <testcase classname="PTP-123" name="STEP 4 - errors">',
  "      <error>last error</error>",
  "    </testcase>",
  "  </testsuite>",
  "</testsuites>",
].join("\n");

describe("JUnit XML fallback parsing", () => {
  it("parses suites, testcases, failure, error and skipped with the regex parser", () => {
    const parsed = parseFallbackJunit(JUNIT_XML) as {
      testsuite: Array<Record<string, any>>;
    };

    expect(parsed.testsuite).toHaveLength(1);
    const suite = parsed.testsuite[0];
    expect(suite["@_name"]).toBe("PTP-123");
    expect(suite.testcase).toHaveLength(4);
    expect(suite.testcase[0]).toMatchObject({
      "@_classname": "PTP-123",
      "@_name": "STEP 1 - passes",
    });
    expect(suite.testcase[0].failure).toBeUndefined();
    expect(suite.testcase[0].error).toBeUndefined();
    expect(suite.testcase[0].skipped).toBeUndefined();
    expect(suite.testcase[1].failure).toBe("stack trace here");
    expect(suite.testcase[2].error).toBe("error detail");
    expect(suite.testcase[3].skipped).toEqual({});
  });

  it("maps failure, error and skipped statuses when parsing a JUnit file", async () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "decaf-junit-fallback-")
    );
    try {
      const junitPath = path.join(directory, "junit.xml");
      fs.writeFileSync(junitPath, JUNIT_XML, "utf8");

      const tests = await parseJunitFile(junitPath, new Map());

      expect(tests).toHaveLength(1);
      expect(tests[0].testKey).toBe("PTP-123");
      expect(tests[0].status).toBe("FAILED");
      expect(tests[0].steps.map((step) => step.status)).toEqual([
        "PASSED",
        "FAILED",
        "FAILED",
        "TODO",
      ]);
      expect(tests[0].steps.map((step) => step.key)).toEqual([
        "STEP-001",
        "STEP-002",
        "STEP-003",
        "STEP-004",
      ]);
      expect(tests[0].steps[1].actualResult).toBe("stack trace here");
      expect(tests[0].steps[2].actualResult).toBe("error detail");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("keeps a self-closing testcase separate from the following paired one", () => {
    const parsed = parseFallbackJunit(MIXED_SELF_CLOSING_XML) as {
      testsuite: Array<Record<string, any>>;
    };

    expect(parsed.testsuite[0].testcase).toHaveLength(2);
    expect(parsed.testsuite[0].testcase[0]).toMatchObject({
      "@_name": "STEP 1 - passes",
    });
    expect(parsed.testsuite[0].testcase[0].failure).toBeUndefined();
    expect(parsed.testsuite[0].testcase[1]).toMatchObject({
      "@_name": "STEP 2 - fails",
      failure: "stack trace here",
    });
  });

  it("keeps paired and self-closing testcases independent in any order", () => {
    const parsed = parseFallbackJunit(INTERLEAVED_SELF_CLOSING_XML) as {
      testsuite: Array<Record<string, any>>;
    };

    const testcases = parsed.testsuite[0].testcase;
    expect(testcases.map((testcase) => testcase["@_name"])).toEqual([
      "STEP 1 - fails",
      "STEP 2 - passes",
      "STEP 3 - passes",
      "STEP 4 - errors",
    ]);
    expect(testcases[0].failure).toBe("first failure");
    expect(testcases[1].failure).toBeUndefined();
    expect(testcases[2].failure).toBeUndefined();
    expect(testcases[3].error).toBe("last error");
  });

  it("keeps the module free of any fast-xml-parser import or parser type", () => {
    const sourcePath = path.resolve(__dirname, "../../src/testImporter.ts");
    const source = fs.readFileSync(sourcePath, "utf8");

    expect(source).not.toContain("fast-xml-parser");
    expect(source).not.toContain("loadXmlParser");
    expect(source).not.toMatch(/\bXmlParser\b/);

    const packageJson = fs.readFileSync(
      path.resolve(__dirname, "../../package.json"),
      "utf8"
    );
    expect(packageJson).not.toContain("fast-xml-parser");
  });
});
