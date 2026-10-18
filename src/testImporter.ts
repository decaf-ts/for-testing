import fs from "node:fs";
import path from "node:path";
import { style } from "@decaf-ts/logging";

/**
 * @description Pattern matching Xray/AgileTest test keys (`PTP-<number>`)
 * inside JUnit suite and test-case names
 * @summary Case-insensitive test-key pattern used to associate JUnit
 * entries (and evidence directories) with their test-management test
 * @constant TEST_KEY_PATTERN
 * @memberOf module:for-testing
 */
export const TEST_KEY_PATTERN = /PTP-\d+/i;

/**
 * @description Pattern matching numbered step references (`STEP 1`,
 * `STEP-2`, `STEP_3`) and capturing the step number
 * @summary Case-insensitive step-key pattern whose first capture group is
 * the step number
 * @constant STEP_KEY_PATTERN
 * @memberOf module:for-testing
 */
export const STEP_KEY_PATTERN = /STEP[-\s_]*(\d+)/i;

/**
 * @description Pattern matching numbered precondition references
 * (`PRECONDITION 1`, `PRECONDITION-2`) and capturing the number
 * @summary Case-insensitive precondition-key pattern whose first capture
 * group is the precondition number
 * @constant PRECONDITION_KEY_PATTERN
 * @memberOf module:for-testing
 */
export const PRECONDITION_KEY_PATTERN = /PRECONDITION[-\s_]*(\d+)/i;

/**
 * @description Pattern matching a precondition label followed by a jira
 * test key (e.g. `PRECONDITION PTP-123`), capturing the key
 * @summary Precondition pattern whose first capture group is the jira key
 * of the referenced precondition
 * @constant PRECONDITION_JIRA_KEY_PATTERN
 * @memberOf module:for-testing
 */
export const PRECONDITION_JIRA_KEY_PATTERN =
  /PRECONDITION(?:[-\s_]*\d+)?[\s\-:]*?(PTP-\d+)/i;

/**
 * @description Maps evidence file extensions to their MIME content types
 * @summary Internal lookup used when building evidence attachments so
 * uploaded files carry a meaningful `contentType`
 * @constant MIME_MAP
 * @memberOf module:for-testing
 */
const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".txt": "text/plain",
  ".log": "text/plain",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

/**
 * @description Default directory scanned for per-test evidence artifacts
 * @summary Evidence root used when neither `ASSETS__PATH` nor
 * `TEST_REPORTER_STORAGE_PATH` is set
 * @constant DEFAULT_ASSETS_PATH
 * @memberOf module:for-testing
 */
export const DEFAULT_ASSETS_PATH = "workdocs/reports/evidences";

/**
 * @description Default location of the JUnit XML report consumed by the
 * teardowns
 * @summary JUnit report path used when `JUNIT_PATH` is not set
 * @constant DEFAULT_JUNIT_PATH
 * @memberOf module:for-testing
 */
export const DEFAULT_JUNIT_PATH = "workdocs/reports/junit/junit-report.xml";

/**
 * @description Maximum length (in characters) a textual result may reach
 * before it is truncated
 * @summary Truncation threshold applied by {@link shorten} to failure
 * messages and response reports
 * @constant SHORTEN_MAX
 * @memberOf module:for-testing
 */
export const SHORTEN_MAX = 4000;

/**
 * @description File name of the JSON step-response artifact stored inside
 * an evidence directory
 * @summary Name of the `response.json` file read by
 * {@link readStepResponseFromDir} to enrich a step's actual result
 * @constant RESPONSE_FILENAME
 * @memberOf module:for-testing
 */
export const RESPONSE_FILENAME = "response.json";

/**
 * @description Minimal parser contract expected from `fast-xml-parser`
 * @summary Structural type of the XML parser loaded lazily by
 * {@link loadXmlParser}
 * @typedef {Object} XmlParser
 * @property {function(string): unknown} parse parses an XML string into a
 * plain object
 * @memberOf module:for-testing
 */
export type XmlParser = {
  parse(xml: string): unknown;
};

/**
 * @description A single base64-encoded evidence file ready for upload
 * @summary Attachment structure shared by the Xray and AgileTest import
 * payloads
 * @typedef {Object} EvidenceAttachment
 * @property {string} filename the attachment file name
 * @property {string} data the file contents, base64-encoded
 * @property {string} [contentType] the MIME type, when known from
 * {@link MIME_MAP}
 * @memberOf module:for-testing
 */
export type EvidenceAttachment = {
  filename: string;
  data: string;
  contentType?: string;
};

/**
 * @description Status and report parsed from a step's `response.json`
 * @summary Optional enrichment applied to a step or precondition's actual
 * result
 * @typedef {Object} ResponseDetails
 * @property {string | null} status the reported status, lowercased; null
 * when absent
 * @property {string} report the reported free-form text
 * @memberOf module:for-testing
 */
export type ResponseDetails = {
  status: string | null;
  report: string;
};

/**
 * @description The execution item (step or precondition) a JUnit entry or
 * evidence directory belongs to, or null for the test itself
 * @summary Discriminated union produced by {@link extractExecutionItem}
 * @typedef {Object} ExecutionItem
 * @property {"step" | "precondition" | null} kind the item kind, or null
 * when the value references the test as a whole
 * @property {string} key the step/precondition key (e.g. `STEP-001` or a
 * jira key)
 * @memberOf module:for-testing
 */
export type ExecutionItem =
  | { kind: "step"; key: string }
  | { kind: "precondition"; key: string }
  | null;

/**
 * @description Aggregated result of one test key, merging its own outcome
 * with those of its steps and preconditions
 * @summary Provider-agnostic test-case model built by
 * {@link parseJunitFile} and uploaded by the Xray and AgileTest teardowns
 * @typedef {Object} ParsedTestCase
 * @property {string} testKey the test key (e.g. `PTP-123`)
 * @property {"PASSED" | "FAILED" | "TODO"} status the aggregated status
 * @property {string} comment the test-level comment
 * @property {string} actualResult the test-level actual result
 * @property {Array<EvidenceAttachment>} [evidence] test-level evidence
 * attachments
 * @property {Array<ParsedStep>} steps the parsed step results
 * @property {Array<ParsedPrecondition>} preconditions the parsed
 * precondition results
 * @memberOf module:for-testing
 */
export type ParsedTestCase = {
  testKey: string;
  status: "PASSED" | "FAILED" | "TODO";
  comment: string;
  actualResult: string;
  evidence?: EvidenceAttachment[];
  steps: ParsedStep[];
  preconditions: ParsedPrecondition[];
};

/**
 * @description Result of a single step execution
 * @summary Step-level outcome carrying its key, status, comment, actual
 * result and evidences
 * @typedef {Object} ParsedStep
 * @property {string} key the step key (e.g. `STEP-001`)
 * @property {"PASSED" | "FAILED" | "TODO"} status the step status
 * @property {string} comment the step comment
 * @property {string} actualResult the step actual result
 * @property {Array<EvidenceAttachment>} [evidences] step-level evidence
 * attachments
 * @memberOf module:for-testing
 */
export type ParsedStep = {
  key: string;
  status: "PASSED" | "FAILED" | "TODO";
  comment: string;
  actualResult: string;
  evidences?: EvidenceAttachment[];
};

/**
 * @description Result of a single precondition execution
 * @summary Alias of {@link ParsedStep}: preconditions share the step
 * result shape
 * @typedef {ParsedStep} ParsedPrecondition
 * @memberOf module:for-testing
 */
export type ParsedPrecondition = ParsedStep;

/**
 * @description Evidence catalog gathered for one test key
 * @summary Maps an evidence directory tree to general attachments,
 * per-step/per-precondition attachments and per-item response details
 * @typedef {Object} EvidenceBucket
 * @property {Array<EvidenceAttachment>} general attachments not tied to a
 * specific step or precondition
 * @property {Map<string, Array<EvidenceAttachment>>} steps attachments by
 * step key
 * @property {Map<string, Array<EvidenceAttachment>>} preconditions
 * attachments by precondition key
 * @property {Map<string, ResponseDetails>} responses response details by
 * step key
 * @property {Map<string, ResponseDetails>} preconditionResponses response
 * details by precondition key
 * @property {ResponseDetails | null} directResponse response details for
 * the test itself, when present
 * @memberOf module:for-testing
 */
export type EvidenceBucket = {
  general: EvidenceAttachment[];
  steps: Map<string, EvidenceAttachment[]>;
  preconditions: Map<string, EvidenceAttachment[]>;
  responses: Map<string, ResponseDetails>;
  preconditionResponses: Map<string, ResponseDetails>;
  directResponse: ResponseDetails | null;
};

/**
 * @description Outcome of one JUnit entry before it is folded into its
 * owning test case
 * @summary Intermediate result carrying status, comment and actual result
 * @typedef {Object} ExecutionResult
 * @property {"PASSED" | "FAILED" | "TODO"} status the mapped status
 * @property {string} comment the entry comment
 * @property {string} actualResult the entry actual result
 * @property {Array<EvidenceAttachment>} [evidences] evidence attachments
 * resolved for the entry
 * @memberOf module:for-testing
 */
export type ExecutionResult = {
  status: "PASSED" | "FAILED" | "TODO";
  comment: string;
  actualResult: string;
  evidences?: EvidenceAttachment[];
};

/**
 * @description Truncates a value to `max` characters, appending an
 * explicit truncation marker
 * @summary Guards uploaded comments and actual results against oversized
 * payloads; empty values become an empty string
 * @param {string} value the text to shorten
 * @param {number} [max=SHORTEN_MAX] the maximum length before truncation
 * @return {string} the (possibly truncated) text
 * @memberOf module:for-testing
 */
export const shorten = (value: string, max = SHORTEN_MAX): string => {
  if (!value) return "";
  return value.length > max ? `${value.slice(0, max)}\n...(truncated)` : value;
};

/**
 * @description Normalizes an optional single-or-array value to an array
 * @summary XML parsers may collapse single entries; this restores a
 * uniform array shape
 * @template T the element type
 * @param {T | T[] | undefined} value the value to normalize
 * @return {T[]} the value as an array (empty when undefined)
 * @memberOf module:for-testing
 */
export const normalizeArray = <T>(value: T | T[] | undefined): T[] => {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
};

/**
 * @description Extracts the first matching key from a list of values,
 * uppercased
 * @summary Scans the values in order and returns the first (or last) match
 * of the pattern, uppercased
 * @param {unknown[]} values the candidate values (usually suite/test-case
 * names); non-string values are skipped
 * @param {RegExp} pattern the key pattern to match
 * @param {("first"|"last")} [strategy="last"] whether to keep the first or
 * the last match within a single value
 * @return {string | null} the uppercased match, or null when nothing
 * matched
 * @memberOf module:for-testing
 */
export const extractKeyFromValues = (
  values: unknown[],
  pattern: RegExp,
  strategy: "first" | "last" = "last"
): string | null => {
  for (const value of values) {
    if (typeof value !== "string" || !value) continue;
    const matches = Array.from(value.matchAll(new RegExp(pattern, "gi")));
    if (!matches.length) continue;
    const match = strategy === "first" ? matches[0] : matches[matches.length - 1];
    return match[0].toUpperCase();
  }
  return null;
};

/**
 * @description Extracts a numbered key (e.g. `STEP-001`) from a value
 * matching a numbered pattern
 * @summary Matches the pattern, zero-pads the captured number to three
 * digits and prefixes it
 * @param {unknown} value the candidate value; non-strings yield null
 * @param {RegExp} pattern the pattern whose first capture group is the
 * number
 * @param {string} prefix the key prefix (e.g. `STEP`)
 * @return {string | null} the formatted key (`<prefix>-<number>`), or null
 * @memberOf module:for-testing
 */
export const extractNumberedKey = (
  value: unknown,
  pattern: RegExp,
  prefix: string
): string | null => {
  if (typeof value !== "string" || !value) return null;
  const match = value.match(pattern);
  if (!match) return null;
  const number = Number.parseInt(match[1] || "", 10);
  if (Number.isNaN(number)) return null;
  return `${prefix}-${String(number).padStart(3, "0")}`;
};

/**
 * @description Extracts a step key (`STEP-001`) from a value
 * @summary Convenience wrapper over {@link extractNumberedKey} with the
 * step pattern and prefix
 * @param {unknown} value the candidate value
 * @return {string | null} the step key, or null when absent
 * @memberOf module:for-testing
 */
export const extractStepKey = (value: unknown): string | null =>
  extractNumberedKey(value, STEP_KEY_PATTERN, "STEP");

/**
 * @description Extracts a numbered precondition key (`PRECONDITION-001`)
 * from a value
 * @summary Convenience wrapper over {@link extractNumberedKey} with the
 * precondition pattern and prefix
 * @param {unknown} value the candidate value
 * @return {string | null} the precondition key, or null when absent
 * @memberOf module:for-testing
 */
export const extractPreconditionKey = (value: unknown): string | null =>
  extractNumberedKey(value, PRECONDITION_KEY_PATTERN, "PRECONDITION");

/**
 * @description Extracts the jira key referenced by a precondition label
 * @summary Matches `PRECONDITION ... PTP-<number>` and returns the
 * uppercased jira key
 * @param {unknown} value the candidate value
 * @return {string | null} the uppercased jira key, or null when absent
 * @memberOf module:for-testing
 */
export const extractPreconditionJiraKey = (value: unknown): string | null => {
  if (typeof value !== "string" || !value) return null;
  const match = value.match(PRECONDITION_JIRA_KEY_PATTERN);
  return match ? match[1].toUpperCase() : null;
};

/**
 * @description Determines which execution item (step or precondition) a
 * value references
 * @summary Tries step, precondition-jira and numbered-precondition keys in
 * order; returns null when the value references the test itself
 * @param {unknown} value the candidate value (test/suite/directory name)
 * @return {ExecutionItem} the discriminated execution item, or null
 * @memberOf module:for-testing
 */
export const extractExecutionItem = (value: unknown): ExecutionItem => {
  const stepKey = extractStepKey(value);
  if (stepKey) return { kind: "step", key: stepKey };

  const preconditionJiraKey = extractPreconditionJiraKey(value);
  if (preconditionJiraKey)
    return { kind: "precondition", key: preconditionJiraKey };

  const preconditionKey = extractPreconditionKey(value);
  if (preconditionKey) return { kind: "precondition", key: preconditionKey };

  return null;
};

/**
 * @description Reads a file into a base64 evidence attachment
 * @summary Builds an {@link EvidenceAttachment} from a file path, deriving
 * the content type from the extension via {@link MIME_MAP}
 * @param {string} filePath the file to attach
 * @return {EvidenceAttachment} the attachment (without `contentType` when
 * the extension is unknown)
 * @memberOf module:for-testing
 */
export const createEvidenceFromFile = (
  filePath: string
): EvidenceAttachment => {
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_MAP[ext];
  return {
    filename: path.basename(filePath),
    data: buffer.toString("base64"),
    ...(contentType ? { contentType } : {}),
  };
};

/**
 * @description Recursively collects every file under a directory
 * @summary Depth-first walk returning all file paths, optionally skipping
 * step-keyed directories and excluded file names
 * @param {string} directory the directory to walk
 * @param {object} [options] collection options
 * @param {boolean} [options.skipStepDirs] skip directories whose name
 * matches {@link STEP_KEY_PATTERN}
 * @param {string[]} [options.excludeFileNames] file names to skip
 * @return {string[]} the collected file paths
 * @memberOf module:for-testing
 */
export const collectFiles = (
  directory: string,
  options?: { skipStepDirs?: boolean; excludeFileNames?: string[] }
): string[] => {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (options?.skipStepDirs && STEP_KEY_PATTERN.test(entry.name)) continue;
      files.push(...collectFiles(entryPath, options));
      continue;
    }

    if (entry.isFile()) {
      if (options?.excludeFileNames?.includes(entry.name)) continue;
      files.push(entryPath);
    }
  }
  return files;
};

/**
 * @description Collects every file under a directory as evidence
 * attachments
 * @summary Returns an empty array when the path is missing or not a
 * directory; otherwise maps {@link collectFiles} results through
 * {@link createEvidenceFromFile}
 * @param {string} dirPath the evidence directory
 * @param {object} [options] options forwarded to {@link collectFiles}
 * @param {boolean} [options.skipStepDirs] skip step-keyed directories
 * @param {string[]} [options.excludeFileNames] file names to skip
 * @return {Array<EvidenceAttachment>} the collected attachments
 * @memberOf module:for-testing
 */
export const collectEvidenceFromDir = (
  dirPath: string,
  options?: { skipStepDirs?: boolean; excludeFileNames?: string[] }
): EvidenceAttachment[] => {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return [];
  return collectFiles(dirPath, options).map(createEvidenceFromFile);
};

/**
 * @description Reads a step's `response.json` artifact, when present
 * @summary Parses the response file inside an evidence directory and
 * returns its lowercased `status` and `report` text; unparsable or empty
 * files are skipped with a warning
 * @param {string} dirPath the evidence directory possibly holding a
 * {@link RESPONSE_FILENAME} file
 * @return {ResponseDetails | null} the parsed details, or null when absent
 * or invalid
 * @memberOf module:for-testing
 */
export const readStepResponseFromDir = (
  dirPath: string
): ResponseDetails | null => {
  const responsePath = path.join(dirPath, RESPONSE_FILENAME);
  if (!fs.existsSync(responsePath) || !fs.statSync(responsePath).isFile()) {
    return null;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(responsePath, "utf8"));
    const status =
      typeof parsed?.status === "string" && parsed.status.trim()
        ? parsed.status.trim().toLowerCase()
        : null;
    const report =
      typeof parsed?.report === "string" && parsed.report.trim()
        ? parsed.report.trim()
        : "";

    if (!status && !report) return null;
    return { status, report };
  } catch (error: unknown) {
    console.warn(
      `⚠️ Failed to parse ${responsePath}; skipping response enrichment. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
};

/**
 * @description Maps a JUnit test-case record to a test-management status
 * @summary Entries carrying `failure` or `error` map to `FAILED`, `skipped`
 * to `TODO`, everything else to `PASSED`
 * @param {object} testcase the parsed test-case record
 * @param {unknown} [testcase.failure] the failure payload, when present
 * @param {unknown} [testcase.error] the error payload, when present
 * @param {unknown} [testcase.skipped] the skipped marker, when present
 * @return {("PASSED"|"FAILED"|"TODO")} the mapped status
 * @memberOf module:for-testing
 */
export const mapStatusForCase = (testcase: {
  failure?: unknown;
  error?: unknown;
  skipped?: unknown;
}): "PASSED" | "FAILED" | "TODO" => {
  if ("failure" in testcase || "error" in testcase) return "FAILED";
  if ("skipped" in testcase) return "TODO";
  return "PASSED";
};

/**
 * @description Reads a field from a jira-shaped object, looking at the
 * top level first and then inside `fields`
 * @summary Supports both flat and `fields`-nested jira payloads
 * @param {unknown} jiraData the jira object (flat or `{ fields: {...} }`)
 * @param {string} fieldName the field to read
 * @return {unknown} the field value, or undefined when absent
 * @memberOf module:for-testing
 */
export const extractJiraField = (
  jiraData: unknown,
  fieldName: string
): unknown => {
  if (!jiraData || typeof jiraData !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(jiraData, fieldName)) {
    return (jiraData as Record<string, unknown>)[fieldName];
  }

  const fields = (jiraData as Record<string, unknown>).fields;
  if (fields && typeof fields === "object") {
    if (Object.prototype.hasOwnProperty.call(fields, fieldName)) {
      return (fields as Record<string, unknown>)[fieldName];
    }
  }

  return undefined;
};

/**
 * @description Finds an already-linked precondition by its jira key
 * @summary Scans a test's precondition list for one whose jira `key`
 * matches, so the teardown only warns about genuinely missing links
 * @param {Array<Object>} [preconditions] the precondition entries (each
 * carrying an optional `jira` object) associated with a test
 * @param {string} key the expected precondition key
 * @return {object | null} the matching entry, or null when none matches
 * @memberOf module:for-testing
 */
export const findExistingAssociatedPrecondition = (
  preconditions: Array<{ jira?: unknown }> | undefined,
  key: string
): { jira?: unknown } | null => {
  for (const precondition of preconditions || []) {
    const jiraKey = extractJiraField(precondition.jira, "key");
    if (jiraKey === key) return precondition;
  }
  return null;
};

/**
 * @description Loads `fast-xml-parser` lazily, when available
 * @summary Returns a configured XML parser or null when the dependency is
 * not installed, letting callers fall back to
 * {@link parseFallbackJunit}
 * @return {Promise<XmlParser | null>} the parser, or null when unavailable
 * @memberOf module:for-testing
 */
export const loadXmlParser = async (): Promise<XmlParser | null> => {
  try {
    const moduleName = "fast-xml-parser";
    const mod = await import(moduleName);
    const Parser = (mod as { XMLParser?: new (options: unknown) => XmlParser })
      .XMLParser;
    if (!Parser) return null;
    return new Parser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      trimValues: true,
    });
  } catch {
    return null;
  }
};

/**
 * @description Extracts XML attributes from a tag's raw attribute string
 * @summary Parses `name="value"` pairs into a record keyed by `@_<name>`,
 * mirroring the `fast-xml-parser` attribute prefix used by the main parse
 * path
 * @param {string} input the raw attribute text of an XML tag
 * @return {Record<string, string>} the parsed attributes
 * @memberOf module:for-testing
 */
export const extractAttributes = (
  input: string
): Record<string, string> => {
  const attributes: Record<string, string> = {};
  const attrPattern = /([A-Za-z0-9_:.-]+)=["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(input))) {
    attributes[`@_${match[1]}`] = match[2];
  }
  return attributes;
};

/**
 * @description Extracts the inner text of an XML tag from a block
 * @summary Matches the first `<tag ...>text</tag>` occurrence and strips
 * CDATA wrappers
 * @param {string} block the XML fragment to search
 * @param {string} tagName the tag whose text is extracted
 * @return {string | undefined} the trimmed text, or undefined when the tag
 * is absent
 * @memberOf module:for-testing
 */
export const extractTagText = (
  block: string,
  tagName: string
): string | undefined => {
  const match = block.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  if (!match) return undefined;
  return match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
};

/**
 * @description Regex-based JUnit XML parser used when
 * `fast-xml-parser` is not installed
 * @summary Fallback parser producing the same `{ testsuite: [...] }` shape
 * as the real parser, including test-case attributes and
 * `failure`/`error`/`skipped` children
 * @param {string} xml the JUnit XML document
 * @return {unknown} the parsed structure, or `{}` when no suites matched
 * @memberOf module:for-testing
 */
export const parseFallbackJunit = (xml: string): unknown => {
  const suites: Array<Record<string, unknown>> = [];
  const suitePattern = /<testsuite\b([^>]*)>([\s\S]*?)<\/testsuite>/gi;
  let suiteMatch: RegExpExecArray | null;

  while ((suiteMatch = suitePattern.exec(xml))) {
    const suiteAttrs = extractAttributes(suiteMatch[1] || "");
    const suiteBody = suiteMatch[2] || "";
    const testcases: Array<Record<string, unknown>> = [];
    const testcasePattern = /<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/gi;
    let testcaseMatch: RegExpExecArray | null;

    while ((testcaseMatch = testcasePattern.exec(suiteBody))) {
      const attrSource = testcaseMatch[1] || testcaseMatch[3] || "";
      const testcaseAttrs = extractAttributes(attrSource);
      const body = testcaseMatch[2] || "";
      const testcase: Record<string, unknown> = {
        ...testcaseAttrs,
      };

      const failureText = extractTagText(body, "failure");
      if (failureText !== undefined) {
        testcase.failure = failureText;
      }

      const errorText = extractTagText(body, "error");
      if (errorText !== undefined) {
        testcase.error = errorText;
      }

      if (/<skipped\b/i.test(body)) {
        testcase.skipped = {};
      }

      testcases.push(testcase);
    }

    suites.push({
      ...suiteAttrs,
      testcase: testcases,
    });
  }

  return suites.length ? { testsuite: suites } : {};
};

/**
 * @description Parses a JUnit XML report into the provider-agnostic
 * test-case model
 * @summary Associates every test-case entry with its test key, maps its
 * status, extracts failure text as the actual result, and enriches entries
 * with evidence and response details from the matching
 * {@link EvidenceBucket}. Step and precondition entries are folded into
 * their owning test; a test's status becomes `FAILED` when any of its
 * entries failed
 * @param {string} junitPath the JUnit XML report path
 * @param {Map<string, EvidenceBucket>} buckets evidence buckets by test
 * key, as built by {@link buildAssetBuckets}
 * @return {Promise<Array<ParsedTestCase>>} the parsed test cases
 * @throws {Error} when the JUnit file cannot be read
 * @memberOf module:for-testing
 */
export const parseJunitFile = async (
  junitPath: string,
  buckets: Map<string, EvidenceBucket>
): Promise<ParsedTestCase[]> => {
  const xml = fs.readFileSync(junitPath, "utf8");
  const parser = await loadXmlParser();
  const parsed = parser ? parser.parse(xml) : parseFallbackJunit(xml);
  const parsedRecord = parsed as {
    testsuite?: unknown;
    testsuites?: { testsuite?: unknown };
  };
  const suites = [
    ...normalizeArray(parsedRecord.testsuite as unknown[] | undefined),
    ...normalizeArray(parsedRecord.testsuites?.testsuite as unknown[] | undefined),
  ];

  const tests = new Map<string, ParsedTestCase>();

  for (const suite of suites) {
    const suiteRecord = suite as Record<string, unknown>;
    const suiteName =
      typeof suiteRecord["@_name"] === "string"
        ? suiteRecord["@_name"]
        : undefined;
    const testCases = normalizeArray(suiteRecord.testcase as unknown[] | undefined);
    const suiteTestKey = extractKeyFromValues([suiteName], TEST_KEY_PATTERN);

    for (const testCase of testCases) {
      const testCaseRecord = testCase as Record<string, unknown>;
      const labelledValues = [
        testCaseRecord["@_name"],
        testCaseRecord["@_classname"],
        suiteName,
      ].filter((value): value is string => typeof value === "string");
      const labelledValue = labelledValues[0];
      const executionItem = extractExecutionItem(labelledValue);
      if (!executionItem) continue;

      const owningTestKey = extractKeyFromValues(
        labelledValues,
        TEST_KEY_PATTERN,
        "first"
      );
      const caseTestKey = extractKeyFromValues(labelledValues, TEST_KEY_PATTERN);
      const testKey = suiteTestKey || owningTestKey || caseTestKey;

      if (!testKey) {
        console.warn(
          `⚠️ Skipping testcase without a PTP key (${testCaseRecord["@_name"] || testCaseRecord["@_classname"] || "unknown"}).`
        );
        continue;
      }

      const status = mapStatusForCase(testCaseRecord);
      const comment = (
        testCaseRecord["@_name"] ||
        testCaseRecord["@_classname"] ||
        suiteName ||
        "(untitled step)"
      ).toString();

      const failureRaw = testCaseRecord.failure || testCaseRecord.error;
      let failureText = "";
      if (failureRaw) {
        if (typeof failureRaw === "string") {
          failureText = failureRaw;
        } else if (typeof failureRaw === "object") {
          const failureRecord = failureRaw as Record<string, unknown>;
          if (typeof failureRecord["#text"] === "string") {
            failureText = failureRecord["#text"];
          } else if (typeof failureRecord["@_message"] === "string") {
            failureText = failureRecord["@_message"];
          } else {
            failureText = JSON.stringify(failureRecord);
          }
        } else {
          failureText = JSON.stringify(failureRaw);
        }
      }

      const trimmed = style(failureText).clear().toString();
      let actualResult = trimmed ? shorten(trimmed) : "OK";

      const bucket: ParsedTestCase = tests.get(testKey) ??
        ({
          testKey,
          status: "PASSED" as const,
          steps: [],
          preconditions: [],
          comment,
          actualResult,
        } as ParsedTestCase);
      tests.set(testKey, bucket);

      const executionResult: ExecutionResult = {
        status,
        comment,
        actualResult,
      };

      const assetBucket = buckets.get(testKey);
      if (assetBucket && executionItem) {
        const evidenceMap =
          executionItem.kind === "step"
            ? assetBucket.steps
            : assetBucket.preconditions;
        const responseMap =
          executionItem.kind === "step"
            ? assetBucket.responses
            : assetBucket.preconditionResponses;

        const executionEvidence = evidenceMap.get(executionItem.key);
        if (executionEvidence && executionEvidence.length) {
          executionResult.evidences = executionEvidence;
        }

        const responseDetails = responseMap.get(executionItem.key);
        if (responseDetails) {
          actualResult = shorten(
            [responseDetails.status, responseDetails.report]
              .filter(Boolean)
              .join("\n")
          );
          executionResult.actualResult = actualResult;
        }
      }

      if (assetBucket && assetBucket.general.length) {
        bucket.evidence = assetBucket.general;
      }

      if (!executionItem) {
        if (assetBucket?.directResponse) {
          actualResult = shorten(
            [assetBucket.directResponse.status, assetBucket.directResponse.report]
              .filter(Boolean)
              .join("\n")
          );
        }

        bucket.status = status;
        bucket.comment = comment;
        bucket.actualResult = actualResult;
        if (status === "FAILED") {
          bucket.status = "FAILED";
        }
        continue;
      }

      if (executionItem.kind === "step") {
        bucket.steps.push({
          key: executionItem.key,
          status,
          comment,
          actualResult: executionResult.actualResult,
          evidences: executionResult.evidences,
        });
      } else {
        bucket.preconditions.push({
          key: executionItem.key,
          status,
          comment,
          actualResult: executionResult.actualResult,
          evidences: executionResult.evidences,
        });
      }

      if (status === "FAILED") {
        bucket.status = "FAILED";
      }
    }
  }

  return Array.from(tests.values());
};

/**
 * @description Builds the evidence catalog for an evidence root directory
 * @summary Walks the evidence tree, groups attachments by test key and
 * execution item (step/precondition), and records per-item and direct
 * response details. Directories named `jest-html-reporters-temp` are
 * ignored; a missing or non-directory root yields an empty catalog with a
 * warning
 * @param {string} assetsRoot the evidence root (default
 * {@link DEFAULT_ASSETS_PATH})
 * @return {Map<string, EvidenceBucket>} evidence buckets by test key
 * @memberOf module:for-testing
 */
export const buildAssetBuckets = (
  assetsRoot: string
): Map<string, EvidenceBucket> => {
  const catalog = new Map<string, EvidenceBucket>();

  if (!fs.existsSync(assetsRoot)) {
    console.warn(
      `⚠️ Asset path ${assetsRoot} does not exist; skipping evidence enrichment.`
    );
    return catalog;
  }

  if (!fs.statSync(assetsRoot).isDirectory()) {
    console.warn(
      `⚠️ Asset path ${assetsRoot} is not a directory; skipping evidence enrichment.`
    );
    return catalog;
  }

  const visitDirectory = (directoryPath: string): void => {
    for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const entryName = entry.name;
      if (entryName === "jest-html-reporters-temp") continue;

      const entryPath = path.join(directoryPath, entryName);
      const testMatch = entryName.match(TEST_KEY_PATTERN);

      if (!testMatch) {
        visitDirectory(entryPath);
        continue;
      }

      const testKey = testMatch[0].toUpperCase();
      const bucket: EvidenceBucket = catalog.get(testKey) ?? ({
        general: [],
        steps: new Map<string, EvidenceAttachment[]>(),
        preconditions: new Map<string, EvidenceAttachment[]>(),
        responses: new Map<string, ResponseDetails>(),
        preconditionResponses: new Map<string, ResponseDetails>(),
        directResponse: null,
      } as EvidenceBucket);
      catalog.set(testKey, bucket);

      const executionItem = extractExecutionItem(entryName);
      const evidence = collectEvidenceFromDir(entryPath, {
        excludeFileNames: [RESPONSE_FILENAME],
      });
      const responseDetails = readStepResponseFromDir(entryPath);

      if (executionItem && responseDetails) {
        if (executionItem.kind === "step") {
          bucket.responses.set(executionItem.key, responseDetails);
        } else {
          bucket.preconditionResponses.set(executionItem.key, responseDetails);
        }
      } else if (responseDetails) {
        bucket.directResponse = responseDetails;
      }

      if (!evidence.length) continue;

      if (executionItem) {
        const targetBucket =
          executionItem.kind === "step" ? bucket.steps : bucket.preconditions;
        const existing = targetBucket.get(executionItem.key) || [];
        targetBucket.set(executionItem.key, [...existing, ...evidence]);
        continue;
      }

      bucket.general.push(...evidence);
    }
  };

  visitDirectory(assetsRoot);
  return catalog;
};
