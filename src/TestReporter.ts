import path from "path";
import fs from "fs";
import { installIfNotAvailable } from "@decaf-ts/utils";
import type { SimpleDependencyMap } from "@decaf-ts/utils";
import type { MdTableDefinition } from "./vendor/md";

/**
 * @interface AddAttachParams
 * @description Parameters for adding an attachment to a report
 * @summary Interface for attachment parameters
 * @memberOf module:for-testing
 */
export interface AddAttachParams {
  attach: string | Buffer;
  description: string | object;
  context?: any;
  bufferFormat?: string;
}

/**
 * @interface AddMsgParams
 * @description Parameters for adding a message to a report
 * @summary Interface for message parameters
 * @memberOf module:for-testing
 */
export interface AddMsgParams {
  message: string | object;
  context?: any;
}

/**
 * @typedef {("json"|"image"|"text"|"md")} PayloadType
 * @description Types of payloads that can be handled
 * @summary Union type for payload types
 * @memberOf module:for-testing
 */
export type PayloadType = "json" | "image" | "text" | "md";

/**
 * @typedef {Object} EvidenceData
 * @description Describes a single stored evidence artifact
 * @summary Shape of one evidence file read back from the evidence directory
 * @property {string} name - File name of the evidence artifact
 * @property {string|Buffer} content - File content (UTF-8 string for text artifacts, Buffer otherwise)
 * @property {string} path - Absolute path of the evidence file
 * @memberOf module:for-testing
 */
export type EvidenceData = {
  name: string;
  content: string | Buffer;
  path: string;
};

/**
 * @description Environment variable key for Jest HTML reporters temporary directory path
 * @summary Constant defining the environment variable key for Jest HTML reporters
 * @const JestReportersTempPathEnvKey
 * @memberOf module:for-testing
 */
export const JestReportersTempPathEnvKey = "JEST_HTML_REPORTERS_TEMP_DIR_PATH";

/**
 * @description Environment variable key to enable file-based evidence storage
 * @summary Constant defining the environment variable key for storage enablement
 * @const TestReporterStorageEnabledEnvKey
 * @memberOf module:for-testing
 */
export const TestReporterStorageEnabledEnvKey = "TEST_REPORTER_STORAGE_ENABLED";

/**
 * @description Environment variable key for the base path of evidence storage
 * @summary Constant defining the environment variable key for storage path
 * @const TestReporterStoragePathEnvKey
 * @memberOf module:for-testing
 */
export const TestReporterStoragePathEnvKey = "TEST_REPORTER_STORAGE_PATH";

/**
 * @description Array of dependencies required by the test reporter
 * @summary List of npm packages needed for reporting functionality
 * @const dependencies
 * @memberOf module:for-testing
 */
const dependencies = ["jest-html-reporters", "json2md", "chartjs-node-canvas"];

/**
 * @description Normalizes imports to handle both CommonJS and ESModule formats
 * @summary Utility function to handle module import differences between formats
 * @template T - Type of the imported module
 * @param {Promise<T>} importPromise - Promise returned by dynamic import
 * @return {Promise<T>} Normalized module
 * @function normalizeImport
 * @memberOf module:for-testing
 */
async function normalizeImport<T>(importPromise: Promise<T>): Promise<T> {
  // CommonJS's `module.exports` is wrapped as `default` in ESModule.
  return importPromise.then((m: any) => (m.default || m) as T);
}

/**
 * @description Test reporting utility class for managing test results and evidence
 * @summary A comprehensive test reporter that handles various types of test artifacts including messages,
 * attachments, data, images, tables, and graphs. It provides methods to report and store test evidence
 * in different formats and manages dependencies for reporting functionality.
 *
 * @template T - Type of data being reported
 * @param {string} [testCase="tests"] - Name of the test case
 * @param {string} [basePath] - Base path for storing test reports
 * @class
 *
 * @example
 * ```typescript
 * const reporter = new TestReporter('login-test');
 *
 * // Report test messages
 * await reporter.reportMessage('Test Started', 'Login flow initiated');
 *
 * // Report test data
 * await reporter.reportData('user-credentials', { username: 'test' }, 'json');
 *
 * // Report test results table
 * await reporter.reportTable('test-results', {
 *   headers: ['Step', 'Status'],
 *   rows: [
 *     { Step: 'Login', Status: 'Pass' },
 *     { Step: 'Validation', Status: 'Pass' }
 *   ]
 * });
 *
 * // Report test evidence
 * await reporter.reportAttachment('Screenshot', screenshotBuffer);
 * ```
 *
 * @mermaid
 * sequenceDiagram
 *   participant Client
 *   participant TestReporter
 *   participant FileSystem
 *   participant Dependencies
 *
 *   Client->>TestReporter: new TestReporter(testCase, basePath)
 *   TestReporter->>FileSystem: Create report directory
 *
 *   alt Report Message
 *     Client->>TestReporter: reportMessage(title, message)
 *     TestReporter->>Dependencies: Import helpers
 *     TestReporter->>FileSystem: Store message
 *   else Report Data
 *     Client->>TestReporter: reportData(reference, data, type)
 *     TestReporter->>Dependencies: Process data
 *     TestReporter->>FileSystem: Store formatted data
 *   else Report Table
 *     Client->>TestReporter: reportTable(reference, tableDef)
 *     TestReporter->>Dependencies: Convert to MD format
 *     TestReporter->>FileSystem: Store table
 *   end
 */
export class TestReporter {
  /**
   * @description Function for adding messages to the test report
   * @summary Static handler for processing and storing test messages
   * @type {function(AddMsgParams): Promise<void>}
   */
  protected static addMsgFunction: (params: AddMsgParams) => Promise<void>;

  /**
   * @description Function for adding attachments to the test report
   * @summary Static handler for processing and storing test attachments
   * @type {function(AddAttachParams): Promise<void>}
   */
  protected static addAttachFunction: (
    params: AddAttachParams
  ) => Promise<void>;

  /**
   * @description Map of dependencies required by the reporter
   * @summary Stores the current state of dependencies
   * @type {SimpleDependencyMap}
   */
  private deps?: SimpleDependencyMap;

  /**
   * @description Checks if storage is enabled via environment variables
   * @summary Static getter for storage enablement status
   * @type {boolean}
   */
  public static get storageEnabled(): boolean {
    return (
      process.env[TestReporterStorageEnabledEnvKey] === "true" ||
      process.env["TEST_REPORTER_STORE_EVIDENCE"] === "true"
    );
  }

  /**
   * @description Gets the base path for evidence storage from environment variables or default
   * @summary Static getter for evidence storage base path
   * @type {string}
   */
  public static get storagePath(): string {
    return (
      process.env[TestReporterStoragePathEnvKey] ||
      path.join(process.cwd(), "workdocs", "reports", "evidences")
    );
  }

  constructor(
    protected testCase: string = "tests",
    protected basePath = TestReporter.storagePath
  ) {
    const parentPath = basePath;
    this.basePath = path.join(basePath, this.testCase);
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(parentPath, { recursive: true });
    }
  }

  /**
   * @description Retrieves all evidences for a given describe and it name
   * @summary Searches the storage directory for matching evidences using string inclusion
   * @param {string} describeName - Name of the describe block to match
   * @param {string} itName - Name of the it block to match
   * @return {EvidenceData[]} Array of matching evidences
   */
  public static getEvidencesOf(
    describeName: string,
    itName: string
  ): EvidenceData[] {
    const root = TestReporter.storagePath;
    if (!fs.existsSync(root)) return [];

    const evidences: {
      name: string;
      content: string | Buffer;
      path: string;
    }[] = [];

    const normalize = (s: string) => s.toLowerCase().replace(/[- ]/g, "");
    const nDescribe = normalize(describeName);
    const nIt = normalize(itName);

    const describeDirs = fs
      .readdirSync(root)
      .filter((d) => normalize(d).includes(nDescribe));

    for (const dDir of describeDirs) {
      const dPath = path.join(root, dDir);
      if (!fs.statSync(dPath).isDirectory()) continue;

      const itDirs = fs
        .readdirSync(dPath)
        .filter((i) => normalize(i).includes(nIt));
      for (const iDir of itDirs) {
        const iPath = path.join(dPath, iDir);
        if (!fs.statSync(iPath).isDirectory()) continue;

        const files = fs.readdirSync(iPath);
        for (const file of files) {
          const filePath = path.join(iPath, file);
          if (fs.statSync(filePath).isFile()) {
            const content = fs.readFileSync(filePath);
            const isText = [".json", ".txt", ".md"].some((ext) =>
              file.endsWith(ext)
            );
            evidences.push({
              name: file,
              path: filePath,
              content: isText ? content.toString("utf-8") : content,
            });
          }
        }
      }
    }
    return evidences;
  }

  /**
   * @description Imports required helper functions
   * @summary Ensures all necessary dependencies are available and imports helper functions
   * @return {Promise<void>} Promise that resolves when helpers are imported
   */
  private async importHelpers(): Promise<void> {
    this.ensureJestHtmlReportersTempDirs();
    this.deps = await installIfNotAvailable([dependencies[0]], this.deps);
    // if (!process.env[JestReportersTempPathEnvKey])
    //   process.env[JestReportersTempPathEnvKey] = './workdocs/reports';
    const helper = await normalizeImport(import(`${dependencies[0]}/helper`));
    const { addMsg, addAttach } = helper as {
      addMsg: typeof TestReporter.addMsgFunction;
      addAttach: typeof TestReporter.addAttachFunction;
      tempDirPath?: string;
      dataDirPath?: string;
      attachDirPath?: string;
    };
    this.overrideJestHtmlReportersTempPaths(helper as Record<string, unknown>);
    TestReporter.addMsgFunction = addMsg;
    TestReporter.addAttachFunction = addAttach;
  }

  private getJestHtmlReportersTempDir(): string {
    return (
      process.env[JestReportersTempPathEnvKey] ||
      path.join(this.basePath, "jest-html-reporters-temp")
    );
  }

  private ensureJestHtmlReportersTempDirs() {
    const tempDir = this.getJestHtmlReportersTempDir();
    fs.mkdirSync(path.join(tempDir, "data"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "images"), { recursive: true });
  }

  private overrideJestHtmlReportersTempPaths(helper: Record<string, unknown>) {
    const tempDir = this.getJestHtmlReportersTempDir();
    helper.tempDirPath = tempDir;
    helper.dataDirPath = path.join(tempDir, "data");
    helper.attachDirPath = path.join(tempDir, "images");
  }

  /**
   * @description Reports a message to the test report
   * @summary Adds a formatted message to the test report with an optional title
   * @param {string} title - Title of the message
   * @param {string | object} message - Content of the message
   * @return {Promise<void>} Promise that resolves when the message is reported
   */
  async reportMessage(title: string, message: string | object): Promise<void> {
    if (!TestReporter.addMsgFunction) await this.importHelpers();
    const msg = `${title}${message ? `\n${message}` : ""}`;
    await TestReporter.addMsgFunction({ message: msg });
  }

  /**
   * @description Reports an attachment to the test report
   * @summary Adds a formatted message to the test report with an optional title
   * @param {string} title - Title of the message
   * @param {string | Buffer} attachment - Content of the message
   * @return {Promise<void>} Promise that resolves when the message is reported
   */
  async reportAttachment(
    title: string,
    attachment: string | Buffer
  ): Promise<void> {
    if (!TestReporter.addAttachFunction) await this.importHelpers();
    await TestReporter.addAttachFunction({
      attach: attachment,
      description: title,
    });
  }

  /**
   * @description Reports data with specified type
   * @summary Processes and stores data in the test report with formatting
   * @param {string} reference - Reference identifier for the data
   * @param {string | number | object} data - Data to be reported
   * @param {PayloadType} type - Type of the payload
   * @param {boolean} [trim=false] - Whether to trim the data
   * @return {Promise<void>} Promise that resolves when data is reported
   */
  protected async report(
    reference: string,
    data: string | number | object | Buffer,
    type: PayloadType,
    trim: boolean = false
  ) {
    try {
      let attachFunction:
        | typeof this.reportMessage
        | typeof this.reportAttachment = this.reportMessage.bind(this);
      let extension: ".png" | ".txt" | ".md" | ".json" = ".txt";

      let finalData = data;

      switch (type) {
        case "image":
          finalData = Buffer.from(data as Buffer);
          extension = ".png";
          attachFunction = this.reportAttachment.bind(this);
          break;
        case "json":
          if (trim) {
            // we clone to avoid modifying the original if it was an object passed by reference
            const dataToTrim = JSON.parse(JSON.stringify(data));
            if (dataToTrim.request) delete dataToTrim.request;
            if (dataToTrim.config) delete dataToTrim.config;
            finalData = dataToTrim;
          }
          finalData = JSON.stringify(finalData, null, 2);
          extension = ".json";
          break;
        case "md":
          extension = ".md";
          break;
        case "text":
          extension = ".txt";
          break;
        default:
          console.log(`Unsupported type ${type}. assuming text`);
      }

      const refWithExt =
        reference.includes("\n") || reference.includes(extension)
          ? reference
          : `${reference}${extension}`;

      await attachFunction(refWithExt, finalData as Buffer | string);

      if (TestReporter.storageEnabled) {
        await this.storeEvidence(reference, finalData, type, extension);
      }
    } catch (e: unknown) {
      throw new Error(
        `Could not store attach artifact ${reference} under to test report ${this.testCase} - ${e}`
      );
    }
  }

  /**
   * @description Turns a caller-supplied evidence reference into a containment-safe file name
   * @summary `path.basename` strips any directory components (so "../x" becomes "x"),
   * the `[^A-Za-z0-9._-]` replacement neutralizes characters that have no business
   * in a file name, and leading dots are dropped so a reference can never resolve
   * to a hidden or parent entry. The result is always a single path segment that
   * stays inside the evidence directory.
   * @param {string} reference - Untrusted caller-supplied reference identifier
   * @param {string} extension - File extension appended when the reference does not already end with it
   * @return {string} Single-segment, containment-safe file name
   */
  private sanitizeEvidenceFileName(
    reference: string,
    extension: string
  ): string {
    const rawName = reference.includes(extension)
      ? reference
      : `${reference}${extension}`;
    const baseName = path.basename(rawName);
    const sanitized = baseName
      .replace(/[^A-Za-z0-9._-]/g, "-")
      .replace(/^[.-]+/, "");
    return sanitized || `evidence${extension}`;
  }

  /**
   * @description Stores evidence to a file in the specified directory structure
   * @summary Internal method to handle file-based storage of test artifacts.
   * The file name is derived from the untrusted `reference` through
   * {@link TestReporter.sanitizeEvidenceFileName}, and the resolved write path
   * is verified to stay under the evidence base path before anything is written.
   * @param {string} reference - Reference identifier for the data
   * @param {any} data - Data to be stored
   * @param {PayloadType} type - Type of the payload
   * @param {string} extension - File extension to use
   * @return {Promise<void>}
   * @throws {Error} when the resolved evidence path escapes the evidence root
   */
  private async storeEvidence(
    reference: string,
    data: any,
    type: PayloadType,
    extension: string
  ): Promise<void> {
    let itName = "unknown-it";
    try {
      const state = (global as any).expect?.getState();
      if (state?.currentTestName) {
        itName = state.currentTestName;
        if (itName.startsWith(this.testCase)) {
          itName = itName.substring(this.testCase.length).trim();
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      // Ignore
    }

    const sanitizedItName =
      itName.replace(/[/\\?%*:|"<>]/g, "-") || "unknown-it";
    const evidenceDir = path.join(this.basePath, sanitizedItName);

    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }

    const fileName = this.sanitizeEvidenceFileName(reference, extension);
    const filePath = path.join(evidenceDir, fileName);

    // Defense in depth: even with a single-segment file name, refuse to write
    // anywhere outside the configured evidence root.
    const resolvedBase = path.resolve(this.basePath);
    const resolvedFile = path.resolve(filePath);
    if (
      resolvedFile !== resolvedBase &&
      !resolvedFile.startsWith(resolvedBase + path.sep)
    ) {
      throw new Error(
        `Refusing to store evidence for reference "${reference}": resolved path "${resolvedFile}" escapes evidence root "${resolvedBase}"`
      );
    }

    if (type === "image" || Buffer.isBuffer(data)) {
      fs.writeFileSync(filePath, data);
    } else {
      fs.writeFileSync(
        filePath,
        typeof data === "string" ? data : JSON.stringify(data, null, 2)
      );
    }
  }

  /**
   * @description Reports data with a specified type
   * @summary Wrapper method for reporting various types of data
   *
   * Contract: `reference` is an untrusted display identifier, not a path. When
   * file-based evidence storage is enabled, the stored file name is derived
   * from `reference` by stripping directory components and replacing every
   * character outside `[A-Za-z0-9._-]` with `-`, then the resolved write path
   * is verified to stay under the configured evidence base path. A reference
   * can therefore never write outside the evidence root: path traversal such
   * as `../escape` is neutralized rather than honored.
   *
   * @param {string} reference - Reference identifier for the data
   * @param {string | number | object} data - Data to be reported
   * @param {PayloadType} [type="json"] - Type of the payload
   * @param {boolean} [trim=false] - Whether to trim the data
   * @return {Promise<void>} Promise that resolves when data is reported
   */
  async reportData(
    reference: string,
    data: string | number | object,
    type: PayloadType = "json",
    trim = false
  ) {
    return this.report(reference, data, type, trim);
  }

  /**
   * @description Reports a JSON object
   * @summary Convenience method for reporting JSON objects
   * @param {string} reference - Reference identifier for the object
   * @param {object} json - JSON object to be reported
   * @param {boolean} [trim=false] - Whether to trim the object
   * @return {Promise<void>} Promise that resolves when object is reported
   */
  async reportObject(reference: string, json: object, trim = false) {
    return this.report(reference, json, "json", trim);
  }

  /**
   * @description Reports a table in markdown format
   * @summary Converts and stores a table definition in markdown format
   * @param {string} reference - Reference identifier for the table
   * @param {MdTableDefinition} tableDef - Table definition object
   * @return {Promise<void>} Promise that resolves when table is reported
   */
  async reportTable(reference: string, tableDef: MdTableDefinition) {
    this.deps = await installIfNotAvailable([dependencies[1]], this.deps);
    let txt: string;
    try {
      const json2md = await normalizeImport(import(`${dependencies[1]}`));
      txt = json2md([{ table: tableDef }]);
    } catch (e: unknown) {
      throw new Error(`Could not convert JSON to Markdown - ${e}`);
    }

    return this.report(reference, txt, "md");
  }

  /**
   * @description Reports a graph using Chart.js
   * @summary Generates and stores a graph visualization
   * @param {string} reference - Reference identifier for the graph
   * @param {any} config - Chart.js configuration object
   * @return {Promise<void>} Promise that resolves when graph is reported
   */
  async reportGraph(
    reference: string,
    config: any,
    width = 1200,
    height = 600
  ): Promise<Buffer> {
    this.deps = await installIfNotAvailable([dependencies[2]], this.deps);
    const { ChartJSNodeCanvas } = await normalizeImport(
      import(dependencies[2])
    );

    const backgroundColour = "white"; // Uses https://www.w3schools.com/tags/canvas_fillstyle.asp
    const chartJSNodeCanvas = new ChartJSNodeCanvas({
      width,
      height,
      backgroundColour,
    });

    const image = await chartJSNodeCanvas.renderToBuffer(config);
    await this.reportImage(reference, image);
    return image;
  }
  /**
   * @description Reports an image to the test report
   * @summary Stores an image buffer in the test report
   * @param {string} reference - Reference identifier for the image
   * @param {Buffer} buffer - Image data buffer
   * @return {Promise<void>} Promise that resolves when image is reported
   */
  async reportImage(reference: string, buffer: Buffer) {
    return this.report(reference, buffer, "image");
  }
}
