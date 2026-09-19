import * as fs from "fs";
import * as path from "path";
import { runAndReport, TestReporter } from "../../src";
import type { MdTableDefinition } from "../../src/vendor/md";
import * as utils from "@decaf-ts/utils";
import { StandardOutputWriter } from "../../src";

// Mock dependencies
jest.mock("fs");
jest.mock("path");
jest.mock("@decaf-ts/utils", () => {
  const actual = jest.requireActual("@decaf-ts/utils");
  return { ...actual, installIfNotAvailable: jest.fn() };
});

// Mock imports that will be dynamically loaded
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

describe("TestReporter", () => {
  let reporter: TestReporter;
  const mockBasePath = "/mock/base/path";
  const mockTestCase = "mock-test-case";
  const mockFullPath = "/mock/base/path/mock-test-case";

  beforeEach(() => {
    jest.clearAllMocks();

    // Reset static state polluted by other test files (e.g. reporter.test.ts)
    // that invoke the real importHelpers(), so the virtual mocks below apply.
    (TestReporter as any).addMsgFunction = undefined;
    (TestReporter as any).addAttachFunction = undefined;

    // Mock path.join to return predictable paths
    (path.join as jest.Mock).mockImplementation((...args) => {
      if (args.includes(mockTestCase)) {
        return mockFullPath;
      }
      return mockBasePath;
    });

    // Mock fs.existsSync and fs.mkdirSync
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.mkdirSync as jest.Mock).mockReturnValue(undefined);

    // Mock installIfNotAvailable
    (utils.installIfNotAvailable as jest.Mock).mockResolvedValue({
      "jest-html-reporters": "mocked-path",
      json2md: "mocked-path",
      "chartjs-node-canvas": "mocked-path",
    });

    // Create a new reporter instance for each test
    reporter = new TestReporter(mockTestCase, mockBasePath);
  });

  describe("constructor", () => {
    it("should create directory if it does not exist", () => {
      expect(fs.existsSync).toHaveBeenCalledWith(mockFullPath);
      expect(fs.mkdirSync).toHaveBeenCalledWith(mockBasePath, {
        recursive: true,
      });
    });

    it("should not create directory if it already exists", () => {
      jest.clearAllMocks();
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      new TestReporter(mockTestCase, mockBasePath);

      expect(fs.existsSync).toHaveBeenCalledWith(mockFullPath);
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it("should use default values if not provided", () => {
      jest.clearAllMocks();

      // Mock process.cwd()
      const originalCwd = process.cwd;
      process.cwd = jest.fn().mockReturnValue("/mock/cwd");

      new TestReporter();

      expect(path.join).toHaveBeenCalledWith(
        "/mock/cwd",
        "workdocs",
        "reports",
        "evidences"
      );

      // Restore original process.cwd
      process.cwd = originalCwd;
    });
  });

  describe("importHelpers", () => {
    it("should import helper functions and set static properties", async () => {
      // Access the private method using type assertion
      await (reporter as any).importHelpers();

      expect(utils.installIfNotAvailable).toHaveBeenCalledWith(
        ["jest-html-reporters"],
        undefined
      );

      // Verify that static functions are set
      expect(TestReporter["addMsgFunction"]).toBeDefined();
      expect(TestReporter["addAttachFunction"]).toBeDefined();
    });
  });

  describe("addReportMessage", () => {
    it("should handle object messages", async () => {
      const title = "Test Title";
      const message = { key: "value" };

      await reporter.reportObject(title, message);

      expect(TestReporter["addMsgFunction"]).toHaveBeenCalledWith({
        message: `${title}.json\n${JSON.stringify(message, undefined, 2)}`,
      });
    });

    it("should handle empty messages", async () => {
      const title = "Test Title";

      await reporter.reportMessage(title, "");

      expect(TestReporter["addMsgFunction"]).toHaveBeenCalledWith({
        message: `${title}`,
      });
    });
  });

  describe("addReportAttachment", () => {
    it("should import helpers if not already imported and add attachment", async () => {
      const title = "Test Title";
      const attachment = "Test Attachment";

      await reporter.reportAttachment(title, attachment);

      expect(TestReporter["addAttachFunction"]).toHaveBeenCalledWith({
        attach: attachment,
        description: title,
      });
    });

    it("should handle Buffer attachments", async () => {
      const title = "Test Title";
      const attachment = Buffer.from("Test Buffer");

      await reporter.reportAttachment(title, attachment);

      expect(TestReporter["addAttachFunction"]).toHaveBeenCalledWith({
        attach: attachment,
        description: title,
      });
    });
  });

  describe("outputPayload", () => {
    it("should call report with correct parameters", async () => {
      const reference = "test-reference";
      const data = { key: "value" };
      const reportSpy = jest
        .spyOn(reporter as any, "report")
        .mockResolvedValue(undefined);

      await reporter.reportData(reference, data);

      expect(reportSpy).toHaveBeenCalledWith(reference, data, "json", false);

      reportSpy.mockRestore();
    });

    it("should use provided type and trim parameters", async () => {
      const reference = "test-reference";
      const data = { key: "value" };
      const reportSpy = jest
        .spyOn(reporter as any, "report")
        .mockResolvedValue(undefined);

      await reporter.reportData(reference, data, "text", true);

      expect(reportSpy).toHaveBeenCalledWith(reference, data, "text", true);

      reportSpy.mockRestore();
    });
  });

  describe("outputJSON", () => {
    it("should call report with json type", async () => {
      const reference = "test-reference";
      const data = { key: "value" };
      const reportSpy = jest
        .spyOn(reporter as any, "report")
        .mockResolvedValue(undefined);

      await reporter.reportObject(reference, data);

      expect(reportSpy).toHaveBeenCalledWith(reference, data, "json", false);

      reportSpy.mockRestore();
    });

    it("should use provided trim parameter", async () => {
      const reference = "test-reference";
      const data = { key: "value" };
      const reportSpy = jest
        .spyOn(reporter as any, "report")
        .mockResolvedValue(undefined);

      await reporter.reportObject(reference, data, true);

      expect(reportSpy).toHaveBeenCalledWith(reference, data, "json", true);

      reportSpy.mockRestore();
    });
  });

  describe("outputMDTable", () => {
    it("should convert table definition to markdown and call report", async () => {
      const reference = "test-reference";
      const tableDef: MdTableDefinition = {
        headers: ["Col1", "Col2"],
        rows: [{ Col1: "val1", Col2: "val2" }],
      };
      const reportSpy = jest
        .spyOn(reporter as any, "report")
        .mockResolvedValue(undefined);

      await reporter.reportTable(reference, tableDef);

      expect(reportSpy).toHaveBeenCalledWith(
        reference,
        "mocked-markdown",
        "md"
      );

      reportSpy.mockRestore();
    });
  });

  describe("outputGraph", () => {
    it("should render chart and call reportImage", async () => {
      const reference = "test-reference";
      const config = { type: "bar", data: {} };
      const outputImageSpy = jest
        .spyOn(reporter, "reportImage")
        .mockResolvedValue(undefined);

      await reporter.reportGraph(reference, config);

      expect(outputImageSpy).toHaveBeenCalledWith(
        reference,
        Buffer.from("mocked-image")
      );

      outputImageSpy.mockRestore();
    });
  });

  describe("outputImage", () => {
    it("should call report with image type", async () => {
      const reference = "test-reference";
      const buffer = Buffer.from("image-data");
      const reportSpy = jest
        .spyOn(reporter as any, "report")
        .mockResolvedValue(undefined);

      await reporter.reportImage(reference, buffer);

      expect(reportSpy).toHaveBeenCalledWith(reference, buffer, "image");

      reportSpy.mockRestore();
    });
  });

  describe("output command", () => {
    it("should call report message with command result", async () => {
      const cmd = runAndReport(
        'echo "lalala"',
        {},
        StandardOutputWriter,
        reporter
      );

      await expect(cmd.promise).resolves.toBeDefined();

      expect(TestReporter["addMsgFunction"]).toHaveBeenCalledWith({
        message: expect.stringMatching(
          `TestReporter output command should call report message with command result - echo \\"lalala\\".txt`
        ),
      });
    });

    it("should call report message with command error", async () => {
      const cmd = runAndReport('sdasdasd"', {}, StandardOutputWriter, reporter);

      await expect(cmd.promise).rejects.toThrow();

      expect(TestReporter["addMsgFunction"]).toHaveBeenCalledWith({
        message: expect.stringMatching(
          `TestReporter output command should call report message with command error - sdasdasd\\".txt`
        ),
      });
    });
  });
});
