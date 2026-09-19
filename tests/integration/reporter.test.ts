// eslint-disable-next-line @typescript-eslint/no-unused-vars
import * as path from "path";
import { runAndReport, TestReporter } from "../../src";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { addAttach, addMsg } from "jest-html-reporters/helper";

import { StandardOutputWriter } from "../../src";

// process.env.JEST_HTML_REPORTERS_TEMP_DIR_PATH = path.join(
//   __dirname,
//   "../../workdocs/reports"
// );

jest.setTimeout(60000);

describe("TestReporter", () => {
  let reporter: TestReporter;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Create a new reporter instance for each test
    reporter = new TestReporter();

    (reporter as any).importHelpers();
  });

  it("reports", async () => {
    const reporter = new TestReporter();
    await (reporter as any).importHelpers();
    const cmd = runAndReport(
      'echo "laalla"',
      { env: { ...process.env } },
      StandardOutputWriter,
      reporter
    ); // will show in report logs (suite-level)
    const res = await cmd.promise;
    // await reporter.reportAttachment(
    //   "test",
    //   Buffer.from(JSON.stringify(cmd, null, 2), "utf-8")
    // );
    console.log(res);
  });
});
