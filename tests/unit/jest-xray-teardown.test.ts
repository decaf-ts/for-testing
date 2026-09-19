import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runJestXrayTeardown } from "../../src";

type MockResponseInit = {
  ok: boolean;
  status: number;
  statusText: string;
  body: string;
};

const makeResponse = ({
  ok,
  status,
  statusText,
  body,
}: MockResponseInit): Response =>
  ({
    ok,
    status,
    statusText,
    text: async () => body,
  }) as Response;

describe("runJestXrayTeardown", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;
  let tempRoot = "";
  const payloadPath = path.join(
    process.cwd(),
    "workdocs",
    "reports",
    "evidences",
    "tests",
    "xray.json"
  );
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env = { ...originalEnv };
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "decaf-xray-"));
    fetchMock = jest.fn();
    globalThis.fetch = fetchMock as typeof fetch;
    jest.spyOn(console, "log").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(payloadPath, { force: true });
  });

  it("skips teardown when reporting is disabled", async () => {
    process.env.ENABLE_XRAY_REPORT = "false";

    await runJestXrayTeardown();

    expect(console.log).toHaveBeenCalledWith(
      "🦘🦘🦘 Xray reporting is disabled; skipping teardown. 🦘🦘🦘"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("writes the payload and uploads it when reporting is enabled", async () => {
    const assetsRoot = path.join(tempRoot, "assets");
    const junitPath = path.join(tempRoot, "junit.xml");
    fs.mkdirSync(path.join(assetsRoot, "PTP-123"), { recursive: true });
    fs.writeFileSync(path.join(assetsRoot, "PTP-123", "evidence.txt"), "hello");
    fs.writeFileSync(
      junitPath,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<testsuites>',
        '  <testsuite name="PTP-123">',
        '    <testcase classname="PTP-123" name="STEP 1 - collects evidence"/>',
        "  </testsuite>",
        "</testsuites>",
      ].join("\n")
    );

    process.env.ENABLE_XRAY_REPORT = "true";
    process.env.XRAY_CLIENT_ID = "client-id";
    process.env.XRAY_CLIENT_SECRET = "client-secret";
    process.env.TEST_REPORTER_STORAGE_PATH = assetsRoot;
    process.env.JUNIT_PATH = junitPath;
    process.env.TEST_EXECUTION_KEY = "XRAY-999";

    fetchMock
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          status: 200,
          statusText: "OK",
          body: '"token"',
        })
      )
      .mockResolvedValueOnce(
        makeResponse({
          ok: true,
          status: 200,
          statusText: "OK",
          body: "{}",
        })
      );

    await runJestXrayTeardown();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://xray.cloud.getxray.app/api/v2/authenticate"
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://xray.cloud.getxray.app/api/v2/import/execution"
    );
    expect(fs.existsSync(payloadPath)).toBe(true);

    const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
    expect(payload.testExecutionKey).toBe("XRAY-999");
    expect(payload.tests).toHaveLength(1);
    expect(payload.tests[0].testKey).toBe("PTP-123");
    expect(payload.tests[0].evidence).toHaveLength(1);
    expect(payload.tests[0].steps).toHaveLength(1);
    expect(payload.tests[0].steps[0].status).toBe("PASSED");
  });

  it("throws when the JUnit file is missing", async () => {
    process.env.ENABLE_XRAY_REPORT = "true";
    process.env.XRAY_CLIENT_ID = "client-id";
    process.env.XRAY_CLIENT_SECRET = "client-secret";
    process.env.JUNIT_PATH = path.join(tempRoot, "missing-junit.xml");

    await expect(runJestXrayTeardown()).rejects.toThrow(
      /JUnit file not found/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
