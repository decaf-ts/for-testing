import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const testingRoot = path.resolve(__dirname, "../..");
const libEsm = path.join(testingRoot, "lib", "esm");

// This suite spawns the compiled ESM entrypoints (cli-module.js and the two
// teardown modules), which are gitignored and only exist after `npm run build`.
// Guard the suite so a clean checkout can still run `npm test`; build first to
// exercise it. (The source-level behaviour of the same code paths is covered by
// the in-process teardown tests.)
const libBuilt = fs.existsSync(path.join(libEsm, "cli-module.js"));
const describeWhenBuilt = libBuilt ? describe : describe.skip;

interface PosttestFixture {
  root: string;
  junitPath: string;
  evidenceRoot: string;
}

interface FetchCall {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

function makeFixture(root: string): PosttestFixture {
  const evidenceRoot = path.join(root, "assets");
  const junitPath = path.join(root, "junit.xml");
  fs.mkdirSync(path.join(evidenceRoot, "PTP-123"), { recursive: true });
  fs.writeFileSync(path.join(evidenceRoot, "PTP-123", "evidence.txt"), "hello");
  fs.writeFileSync(
    junitPath,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<testsuites>",
      '  <testsuite name="PTP-123">',
      '    <testcase classname="PTP-123" name="STEP 1 - collects evidence"/>',
      "  </testsuite>",
      "</testsuites>",
    ].join("\n")
  );
  return { root, junitPath, evidenceRoot };
}

function cleanEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of [
    "JUNIT_PATH",
    "TEST_REPORTER_STORAGE_PATH",
    "TEST_EXECUTION_KEY",
    "XRAY_TEST_EXECUTION_KEY",
    "AGILETEST_TEST_EXECUTION_KEY",
    "ENABLE_XRAY_REPORT",
    "ENABLE_AGILETEST_REPORT",
    "XRAY_CLIENT_ID",
    "XRAY_CLIENT_SECRET",
    "AGILETEST_HOST",
    "AGILETEST_EMAIL",
    "AGILETEST_API_TOKEN",
  ]) {
    delete env[key];
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

const FETCH_MOCK = `
const calls = [];
const record = () => fs.writeFileSync(process.env.CLI_CALLS_FILE, JSON.stringify(calls));
globalThis.fetch = async (url, init) => {
  const call = {
    url: String(url),
    method: init?.method,
    headers: init?.headers,
    body: typeof init?.body === "string" ? init.body : undefined
  };
  calls.push(call);
  record();
  const body = String(url).includes("authenticate") ? '"token"' : "{}";
  return { ok: true, status: 200, statusText: "OK", text: async () => body };
};
`.trim();

function runNode(script: string, cwd: string, env: NodeJS.ProcessEnv): void {
  execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd,
    env,
    stdio: "pipe",
  });
}

function runLibraryTeardown(
  root: string,
  teardown: "xray" | "agiletest",
  env: NodeJS.ProcessEnv
): FetchCall[] {
  const callsFile = path.join(root, `${teardown}-library-calls.json`);
  const entry =
    teardown === "xray" ? "jestXrayTeardown.js" : "jestAgileTestTeardown.js";
  const fn = teardown === "xray" ? "runJestXrayTeardown" : "runJestAgileTestTeardown";
  const script = `
import fs from "node:fs";
${FETCH_MOCK}
const { ${fn} } = await import(${JSON.stringify(
    pathToFileURL(path.join(libEsm, entry)).href
  )});
await ${fn}();
`;
  runNode(script, root, { ...env, CLI_CALLS_FILE: callsFile });
  return readCalls(callsFile);
}

function runCli(
  root: string,
  target: "xray" | "agiletest",
  args: string[],
  env: NodeJS.ProcessEnv
): FetchCall[] {
  const callsFile = path.join(root, `${target}-cli-calls.json`);
  const cliUrl = pathToFileURL(path.join(libEsm, "cli-module.js")).href;
  const argv = ["report", target, ...args];
  const script = `
import fs from "node:fs";
${FETCH_MOCK}
const { default: command } = await import(${JSON.stringify(cliUrl)});
await command().parseAsync(["node", "decaf-test", ${argv
    .map((value) => JSON.stringify(value))
    .join(", ")}]);
`;
  runNode(script, root, { ...env, CLI_CALLS_FILE: callsFile });
  return readCalls(callsFile);
}

function readCalls(file: string): FetchCall[] {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, "utf8")) as FetchCall[];
}

describeWhenBuilt("post-test core and decaf test report CLI parity", () => {
  let tempRoot: string;
  let fixture: PosttestFixture;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "decaf-posttest-"));
    fixture = makeFixture(tempRoot);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it.each(["xray", "agiletest"] as const)(
    "writes identical %s payloads through the teardown and the CLI",
    (target) => {
      const libraryEnv = cleanEnv({
        ENABLE_XRAY_REPORT: target === "xray" ? "true" : undefined,
        ENABLE_AGILETEST_REPORT: target === "agiletest" ? "true" : undefined,
        XRAY_CLIENT_ID: target === "xray" ? "client-id" : undefined,
        XRAY_CLIENT_SECRET: target === "xray" ? "client-secret" : undefined,
        AGILETEST_HOST:
          target === "agiletest" ? "https://acme.atlassian.net" : undefined,
        AGILETEST_EMAIL:
          target === "agiletest" ? "user@acme.example" : undefined,
        AGILETEST_API_TOKEN:
          target === "agiletest" ? "api-token" : undefined,
        TEST_REPORTER_STORAGE_PATH: fixture.evidenceRoot,
        JUNIT_PATH: fixture.junitPath,
        TEST_EXECUTION_KEY: "EXEC-999",
      });
      runLibraryTeardown(tempRoot, target, libraryEnv);

      const libraryPayloadPath = path.join(
        tempRoot,
        "workdocs",
        "reports",
        "evidences",
        "tests",
        `${target}.json`
      );
      const cliPayloadPath = path.join(tempRoot, `cli-${target}.json`);
      runCli(
        tempRoot,
        target,
        [
          "--junit",
          fixture.junitPath,
          "--evidences",
          fixture.evidenceRoot,
          "--out",
          cliPayloadPath,
          "--execution-key",
          "EXEC-999",
        ],
        cleanEnv({})
      );

      expect(fs.existsSync(libraryPayloadPath)).toBe(true);
      expect(fs.existsSync(cliPayloadPath)).toBe(true);
      const libraryPayload = fs.readFileSync(libraryPayloadPath, "utf8");
      const cliPayload = fs.readFileSync(cliPayloadPath, "utf8");
      expect(cliPayload).toBe(libraryPayload);
      expect(JSON.parse(cliPayload)).toMatchObject({
        testExecutionKey: "EXEC-999",
        tests: [
          {
            testKey: "PTP-123",
            evidence: [{ filename: "evidence.txt" }],
            steps: [{ status: "PASSED" }],
          },
        ],
      });
    }
  );

  it.each(["xray", "agiletest"] as const)(
    "writes nothing for %s when --dry-run is set",
    (target) => {
      const outputPath = path.join(tempRoot, `dry-${target}.json`);
      const calls = runCli(
        tempRoot,
        target,
        [
          "--junit",
          fixture.junitPath,
          "--evidences",
          fixture.evidenceRoot,
          "--out",
          outputPath,
          "--dry-run",
        ],
        cleanEnv({})
      );

      expect(fs.existsSync(outputPath)).toBe(false);
      expect(calls).toEqual([]);
    }
  );

  it.each(["xray", "agiletest"] as const)(
    "uses the same credential environment variables for %s uploads",
    (target) => {
      const credentials =
        target === "xray"
          ? {
              XRAY_CLIENT_ID: "client-id",
              XRAY_CLIENT_SECRET: "client-secret",
            }
          : {
              AGILETEST_HOST: "https://acme.atlassian.net",
              AGILETEST_EMAIL: "user@acme.example",
              AGILETEST_API_TOKEN: "api-token",
            };
      const libraryEnv = cleanEnv({
        ...credentials,
        ENABLE_XRAY_REPORT: target === "xray" ? "true" : undefined,
        ENABLE_AGILETEST_REPORT: target === "agiletest" ? "true" : undefined,
        TEST_REPORTER_STORAGE_PATH: fixture.evidenceRoot,
        JUNIT_PATH: fixture.junitPath,
        TEST_EXECUTION_KEY: "EXEC-999",
      });
      const libraryCalls = runLibraryTeardown(tempRoot, target, libraryEnv);

      const cliOutput = path.join(tempRoot, `upload-${target}.json`);
      const cliCalls = runCli(
        tempRoot,
        target,
        [
          "--junit",
          fixture.junitPath,
          "--evidences",
          fixture.evidenceRoot,
          "--out",
          cliOutput,
          "--execution-key",
          "EXEC-999",
          "--upload",
        ],
        cleanEnv(credentials)
      );

      expect(libraryCalls.length).toBeGreaterThan(0);
      expect(cliCalls).toEqual(libraryCalls);
      expect(fs.readFileSync(cliOutput, "utf8")).toBe(
        fs.readFileSync(
          path.join(
            tempRoot,
            "workdocs",
            "reports",
            "evidences",
            "tests",
            `${target}.json`
          ),
          "utf8"
        )
      );

      if (target === "xray") {
        const auth = cliCalls.find((call) => call.url.includes("authenticate"));
        const upload = cliCalls.find((call) =>
          call.url.includes("/import/execution")
        );
        expect(JSON.parse(auth?.body ?? "{}")).toEqual({
          client_id: "client-id",
          client_secret: "client-secret",
        });
        expect(upload?.headers?.Authorization).toBe("Bearer token");
      } else {
        const upload = cliCalls[0];
        expect(upload.url).toBe(
          "https://acme.atlassian.net/rest/agiletest/1.0/test/import"
        );
        expect(upload.headers?.Authorization).toBe(
          `Basic ${Buffer.from("user@acme.example:api-token").toString("base64")}`
        );
      }
    }
  );
});
