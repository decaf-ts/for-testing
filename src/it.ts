import { resolveAdapterSync } from "./frameworks/resolver";
import type {
  FrameworkAdapter,
  JestConcurrentSignature,
  JestEachSignature,
  TestFn,
} from "./frameworks/types";
import { getReporter } from "./registry";
import type { TestReporter } from "./TestReporter";

/**
 * @interface ReportTestOptions
 * @description Options for a reported test registration
 * @summary Lets a scenario override the reporter that collects the failure
 * evidence and forward a per-test timeout to the host framework
 * @property {TestReporter} [reporter] defaults to `getReporter()`; override
 * for scenario-scoped reporters
 * @property {number} [timeout] ms timeout forwarded to the framework when
 * supported
 * @memberOf module:for-testing
 */
export interface ReportTestOptions {
  /** defaults to getReporter(); override for scenario-scoped reporters */
  reporter?: TestReporter;
  /** ms timeout forwarded to the framework when supported */
  timeout?: number;
}

/**
 * @typedef {function(string, TestFn, ReportTestOptions=): void} ReportFn
 * @description Signature of a reported test registration callback
 * @summary Shape shared by `it.report` and its `skip`/`only` variants
 * @memberOf module:for-testing
 */
export type ReportFn = (
  name: string,
  fn: TestFn,
  opts?: ReportTestOptions
) => void;

/**
 * @interface ReportItApi
 * @description Reported-test registration surface
 * @summary Callable like jest's `it` but with an extra options argument, plus
 * `skip`, `only` and `each` variants that wrap the reported registration
 * @memberOf module:for-testing
 */
export interface ReportItApi {
  (name: string, fn: TestFn, opts?: ReportTestOptions): void;
  skip(name: string, fn: TestFn, opts?: ReportTestOptions): void;
  only(name: string, fn: TestFn, opts?: ReportTestOptions): void;
  each: JestEachSignature;
}

/**
 * @interface ItApi
 * @description Jest-analog test-registration facade
 * @summary Consumers can replace
 * `import { it } from "@jest/globals"` with
 * `import { it } from "@decaf-ts/for-testing"` and keep the familiar
 * `it`, `it.skip`, `it.only`, `it.todo`, `it.each` surface while gaining
 * `it.report(...)` for evidence-reporting tests.
 * @memberOf module:for-testing
 */
export interface ItApi {
  (name: string, fn?: TestFn, timeout?: number): void;
  skip(name: string, fn?: TestFn, timeout?: number): void;
  only(name: string, fn?: TestFn, timeout?: number): void;
  todo(name: string): void;
  each: JestEachSignature;
  concurrent?: JestConcurrentSignature;
  report: ReportFn & {
    skip(name: string, fn: TestFn, opts?: ReportTestOptions): void;
    only(name: string, fn: TestFn, opts?: ReportTestOptions): void;
    each: JestEachSignature;
  };
}

/**
 * @description Raises a descriptive error for a capability the adapter lacks
 * @summary Used by the getters for `each` and `concurrent` so a missing
 * framework capability surfaces as a clear message instead of `undefined`
 * @param {string} capability the capability name (e.g. `it.each`)
 * @param {FrameworkKind} kind the adapter kind that lacks it
 * @return {never} never returns; always throws
 */
function unsupported(capability: string, kind: FrameworkAdapter["kind"]): never {
  throw new Error(
    `The ${kind} adapter does not support ${capability}. Use the framework's native API for this capability.`
  );
}

/**
 * @description Returns the resolved framework adapter
 * @summary Thin wrapper over {@link resolveAdapterSync} used by every
 * registration path
 * @return {FrameworkAdapter} the resolved adapter
 */
function adapter(): FrameworkAdapter {
  return resolveAdapterSync();
}

/**
 * @description The registration mode forwarded to the adapter
 * @summary Mirrors jest's `it`, `it.skip` and `it.only` variants
 * @typedef {"run"|"skip"|"only"} RegistrationMode
 */
type RegistrationMode = "run" | "skip" | "only";

/**
 * @description Persists a failing handler's message and cause
 * @summary Writes an `error` evidence object through the given reporter so
 * the failure shows up in the persisted report; no-op without a reporter
 * @param {TestReporter | undefined} reporter the reporter to report through
 * @param {unknown} error the error thrown by the test handler
 * @return {Promise<void>} resolves once the evidence was written
 */
async function reportFailure(
  reporter: TestReporter | undefined,
  error: unknown
): Promise<void> {
  if (!reporter) return;
  const failure = error as { message?: string; cause?: unknown };
  await reporter.reportObject("error", {
    message: failure?.message,
    cause: failure?.cause,
  });
}

/**
 * @description Registers a reported test block with the host framework
 * @summary Wraps the handler so a thrown error is persisted through the
 * reporter (see {@link reportFailure}) before being rethrown, then delegates
 * the registration to the adapter in the requested mode
 * @param {RegistrationMode} mode the adapter registration mode
 * @param {string} name the test name
 * @param {TestFn} fn the test body
 * @param {ReportTestOptions} [opts] reporter/timeout options
 * @return {void}
 */
function registerReported(
  mode: RegistrationMode,
  name: string,
  fn: TestFn,
  opts?: ReportTestOptions
): void {
  const reporter = opts?.reporter ?? getReporter();
  const wrapped = async () => {
    try {
      await fn();
    } catch (error: unknown) {
      await reportFailure(reporter, error);
      throw error;
    }
  };
  adapter()[mode](name, wrapped, opts?.timeout);
}

/**
 * @description Normalizes an `each` table row into an argument array
 * @summary Scalar rows become single-element arrays so the handler is always
 * called with spread arguments
 * @param {unknown} row the raw row value
 * @return {unknown[]} the row as an argument array
 */
function normalizeRow(row: unknown): unknown[] {
  if (Array.isArray(row)) return row;
  return [row];
}

/**
 * @description Placeholder tokens used by the tagged-template table parser
 * @summary Values are spliced into the template as `\uE000<index>\uE000`
 * markers so injected values cannot be confused with cell syntax
 * @constant TEMPLATE_TOKEN
 */
const TEMPLATE_TOKEN = /\uE000(\d+)\uE000/g;

/**
 * @description Resolves one tagged-template table cell to its value
 * @summary Whole-cell placeholders yield the raw value; embedded placeholders
 * are string-interpolated
 * @param {string} cell the raw cell text
 * @param {unknown[]} values the template substitution values
 * @return {unknown} the resolved cell value
 */
function resolveTemplateCell(cell: string, values: unknown[]): unknown {
  const trimmed = cell.trim();
  const exact = /^\uE000(\d+)\uE000$/.exec(trimmed);
  if (exact) return values[Number(exact[1])];
  return trimmed.replace(TEMPLATE_TOKEN, (_match, index: string) =>
    String(values[Number(index)])
  );
}

/**
 * @description Parses a tagged-template `each` table
 * @summary Builds the jest-analog record table from the template cells,
 * resolving value placeholders before splitting rows on `|`
 * @param {TemplateStringsArray} strings the raw template strings
 * @param {unknown[]} values the template substitution values
 * @return {Object[]} the parsed table rows
 */
function taggedTable(
  strings: TemplateStringsArray,
  values: unknown[]
): Record<string, unknown>[] {
  const joined = strings.reduce(
    (accumulator, part, index) =>
      accumulator +
      part +
      (index < values.length ? `\uE000${index}\uE000` : ""),
    ""
  );
  const lines = joined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const headings = lines[0]
    .split("|")
    .map((cell) => String(resolveTemplateCell(cell, values)));
  return lines.slice(1).map((line) => {
    const cells = line
      .split("|")
      .map((cell) => resolveTemplateCell(cell, values));
    const row: Record<string, unknown> = {};
    headings.forEach((heading, index) => {
      row[heading] = cells[index];
    });
    return row;
  });
}

/**
 * @description Interpolates printf-style tokens into an `each` test name
 * @summary Supports jest's `%s`, `%d`, `%i`, `%f`, `%j`, `%o`, `%O`, `%p` and
 * `%%` tokens plus the row counter `$#`
 * @param {string} template the test name template
 * @param {unknown[]} row the current row's argument array
 * @param {number} index the zero-based row index
 * @return {string} the interpolated test name
 */
function formatEachName(
  template: string,
  row: unknown[],
  index: number
): string {
  let cursor = 0;
  return template
    .replace(/%[sdifjoOpP%]/g, (token: string) => {
      if (token === "%%") return "%";
      const value = row[cursor++];
      switch (token) {
        case "%s":
          return String(value);
        case "%d":
        case "%i":
          return String(Number(value));
        case "%f":
          return String(parseFloat(String(value)));
        case "%j":
        case "%o":
        case "%O":
        case "%p":
          return JSON.stringify(value);
        default:
          return token;
      }
    })
    .replace(/\$#/g, String(index + 1));
}

/**
 * @description Resolves a dotted path against a tagged-template table row
 * @summary Yields `undefined` when any segment of the path is missing
 * @param {Record<string, unknown>} row the current table row
 * @param {string} path the dotted property path (e.g. `user.name`)
 * @return {unknown} the resolved value, or undefined
 */
function resolveTaggedPath(row: Record<string, unknown>, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, key) =>
        current === null || current === undefined
          ? undefined
          : (current as Record<string, unknown>)[key],
      row
    );
}

/**
 * @description Interpolates `$variable` tokens into a tagged-template test
 * name
 * @summary Supports dotted paths, `$#` (1-based row counter) and leaves
 * unmatched tokens untouched
 * @param {string} template the test name template
 * @param {Record<string, unknown>} row the current table row
 * @param {number} index the zero-based row index
 * @return {string} the interpolated test name
 */
function formatTaggedName(
  template: string,
  row: Record<string, unknown>,
  index: number
): string {
  return template.replace(
    /\$([A-Za-z_][A-Za-z0-9_.]*|#)/g,
    (match: string, token: string) => {
      if (token === "#") return String(index + 1);
      const value = resolveTaggedPath(row, token);
      return value === undefined ? match : String(value);
    }
  );
}

/**
 * @description Detects the tagged-template form of an `each` call
 * @summary A template strings array always carries a `raw` property
 * @param {unknown} value the first argument of the `each` call
 * @return {boolean} true when the argument is a template strings array
 */
function isTaggedTemplate(value: unknown): value is TemplateStringsArray {
  return (
    Array.isArray(value) &&
    Array.isArray((value as { raw?: unknown }).raw)
  );
}

/**
 * @description Builds the `it.report.each` signature
 * @summary Accepts both the array form and the tagged-template form of
 * jest's `each` tables and registers one reported test per row
 * @return {JestEachSignature} the `each` registration function
 */
function buildReportEach(): JestEachSignature {
  return ((...args: unknown[]) => {
    const arrayRows: unknown[][] = [];
    let taggedRows: Record<string, unknown>[] = [];
    const tagged = isTaggedTemplate(args[0]);
    if (tagged) {
      taggedRows = taggedTable(
        args[0] as TemplateStringsArray,
        args.slice(1)
      );
    } else {
      arrayRows.push(
        ...(args[0] as unknown[]).map(normalizeRow)
      );
    }
    return (
      name: string,
      fn: (...row: any[]) => unknown,
      opts?: ReportTestOptions
    ) => {
      if (tagged) {
        taggedRows.forEach((row, index) => {
          registerReported(
            "run",
            formatTaggedName(name, row, index),
            () => fn(row),
            opts
          );
        });
        return;
      }
      arrayRows.forEach((row, index) => {
        registerReported(
          "run",
          formatEachName(name, row, index),
          () => fn(...row),
          opts
        );
      });
    };
  }) as unknown as JestEachSignature;
}

/**
 * @description Builds the `it.report` API surface
 * @summary Wires the plain, `skip`, `only` and `each` reported-registration
 * variants over {@link registerReported}
 * @return {Object} the reported-registration API
 */
function buildReportApi(): ItApi["report"] {
  const api = ((name: string, fn: TestFn, opts?: ReportTestOptions) =>
    registerReported("run", name, fn, opts)) as ItApi["report"];
  api.skip = (name, fn, opts) => registerReported("skip", name, fn, opts);
  api.only = (name, fn, opts) => registerReported("only", name, fn, opts);
  api.each = buildReportEach();
  return api;
}

/**
 * @description Assembles the framework-agnostic `it` facade
 * @summary Wires `skip`, `only`, `todo`, `report` and the lazy `each` /
 * `concurrent` getters over the resolved adapter; function-less calls are
 * routed to `todo`
 * @return {ItApi} the `it` facade
 */
function buildIt(): ItApi {
  const call = ((
    name: string,
    fn?: TestFn,
    timeout?: number
  ) => {
    const active = adapter();
    if (fn) active.run(name, fn, timeout);
    else active.todo(name);
  }) as ItApi;

  call.skip = (name, fn, timeout) => {
    if (fn) adapter().skip(name, fn, timeout);
    else adapter().todo(name);
  };
  call.only = (name, fn, timeout) => {
    if (fn) adapter().only(name, fn, timeout);
    else adapter().todo(name);
  };
  call.todo = (name) => adapter().todo(name);
  call.report = buildReportApi();

  Object.defineProperty(call, "each", {
    configurable: true,
    enumerable: true,
    get() {
      const each = adapter().each;
      if (!each) return unsupported("it.each", adapter().kind);
      return each;
    },
  });

  Object.defineProperty(call, "concurrent", {
    configurable: true,
    enumerable: true,
    get() {
      const concurrent = adapter().concurrent;
      if (!concurrent) return unsupported("it.concurrent", adapter().kind);
      return concurrent;
    },
  });

  return call;
}

/**
 * @description The framework-agnostic `it` facade
 * @summary Drop-in replacement for jest's `it` (see {@link ItApi}); the
 * underlying registration goes to the resolved {@link FrameworkAdapter}
 * @constant it
 * @type {ItApi}
 * @memberOf module:for-testing
 */
export const it: ItApi = buildIt();
