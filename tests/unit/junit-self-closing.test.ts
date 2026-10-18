import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  extractTagText,
  mapStatusForCase,
  parseFallbackJunit,
  parseJunitFile,
} from "../../src/testImporter";

const SELF_CLOSING_FAILURE_XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  "<testsuites>",
  '  <testsuite name="PTP-1">',
  '    <testcase classname="PTP-1" name="STEP 1 - self closing failure">',
  '      <failure message="boom"/>',
  "    </testcase>",
  '    <testcase classname="PTP-1" name="STEP 2 - self closing error">',
  '      <error message="bad"/>',
  "    </testcase>",
  '    <testcase classname="PTP-1" name="STEP 3 - paired failure">',
  '      <failure message="paired message">paired text</failure>',
  "    </testcase>",
  '    <testcase classname="PTP-1" name="STEP 4 - skipped">',
  "      <skipped/>",
  "    </testcase>",
  "  </testsuite>",
  "</testsuites>",
].join("\n");

describe("JUnit self-closing failure/error parsing (QA F1)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
    }
  });

  it("extracts the message from a self-closing failure tag", () => {
    expect(extractTagText('<failure message="boom"/>', "failure")).toBe(
      "boom"
    );
    expect(extractTagText("<failure message='boom' />", "failure")).toBe(
      "boom"
    );
  });

  it("extracts the message from a self-closing error tag", () => {
    expect(extractTagText('<error message="bad"/>', "error")).toBe("bad");
    expect(extractTagText('<error type="TimeoutError"/>', "error")).toBe(
      "TimeoutError"
    );
  });

  it("parses self-closing failure and error children into the testcase", () => {
    const parsed = parseFallbackJunit(SELF_CLOSING_FAILURE_XML) as {
      testsuite: Array<Record<string, any>>;
    };

    expect(parsed.testsuite).toHaveLength(1);
    const testcases = parsed.testsuite[0].testcase;
    expect(testcases).toHaveLength(4);
    expect(testcases[0].failure).toBe("boom");
    expect(testcases[0].error).toBeUndefined();
    expect(testcases[1].error).toBe("bad");
    expect(testcases[1].failure).toBeUndefined();
    expect(testcases[2].failure).toBe("paired text");
    expect(testcases[3].skipped).toEqual({});
  });

  it("maps self-closing failure and error testcases to FAILED, not PASSED", async () => {
    expect(mapStatusForCase({ failure: "boom" })).toBe("FAILED");
    expect(mapStatusForCase({ error: "bad" })).toBe("FAILED");
    expect(mapStatusForCase({ skipped: {} })).toBe("TODO");
    expect(mapStatusForCase({})).toBe("PASSED");

    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "decaf-junit-self-closing-")
    );
    tempDirs.push(directory);
    const junitPath = path.join(directory, "junit.xml");
    fs.writeFileSync(junitPath, SELF_CLOSING_FAILURE_XML, "utf8");

    const tests = await parseJunitFile(junitPath, new Map());

    expect(tests).toHaveLength(1);
    expect(tests[0].status).toBe("FAILED");
    expect(tests[0].steps.map((step) => step.status)).toEqual([
      "FAILED",
      "FAILED",
      "FAILED",
      "TODO",
    ]);
    expect(tests[0].steps[0].actualResult).toBe("boom");
    expect(tests[0].steps[1].actualResult).toBe("bad");
    expect(tests[0].steps[2].actualResult).toBe("paired text");
  });
});
