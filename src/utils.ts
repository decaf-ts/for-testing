import { SpawnOptionsWithoutStdio } from "child_process";
import {
  OutputWriterConstructor,
  StandardOutputWriter,
  runCommand,
} from "@decaf-ts/utils";
import type { CommandResult } from "@decaf-ts/utils";
import { TestReporter } from "./TestReporter";
import { sf } from "@decaf-ts/logging";
import { style } from "styled-string-builder";

/**
 * @description Wraps {@link runCommand} so every command invocation is echoed
 * into the test-scoped {@link TestReporter} evidence stream.
 * @summary Spawns the command, then intercepts its promise: the resolved output
 * is reported with a `SUCCESS` marker and the rejected error with a `FAIL`
 * marker, both prefixed with the current test name and the `commandPrefix`
 * template. The original {@link CommandResult} is returned untouched so
 * callers keep the same contract as `runCommand`.
 * @function runAndReport
 * @memberOf module:for-testing
 * @template R - The output writer result type.
 * @param {string} command The command to execute, in `runCommand` syntax.
 * @param {SpawnOptionsWithoutStdio} [opts] Spawn options forwarded to
 * `runCommand` (e.g. `cwd`, `env`, `shell`).
 * @param {OutputWriterConstructor<R, StandardOutputWriter<R>, Error>}
 * [outputConstructor] Output writer factory forwarded to `runCommand`.
 * @param {TestReporter} reporter The reporter collecting the evidence entry.
 * @param {string} [commandPrefix] Template for the echoed command line prefix;
 * supports `{cwd}` interpolation. Defaults to `"{cwd} $ "`.
 * @param {...unknown} args Extra arguments forwarded to `runCommand`.
 * @return {CommandResult<R>} The command runner whose promise resolves or
 * rejects as usual, after the report entry is written.
 * @throws {Error} When the underlying command runner cannot be created.
 */
export function runAndReport<R = string>(
  command: string,
  opts: SpawnOptionsWithoutStdio = {},
  outputConstructor: OutputWriterConstructor<
    R,
    StandardOutputWriter<R>,
    Error
  > = StandardOutputWriter<R>,
  reporter: TestReporter,
  commandPrefix: string = "{cwd} $ ",
  ...args: unknown[]
): CommandResult<R> {
  try {
    const cmd = runCommand(command, opts, outputConstructor, ...args);
    const p = cmd.promise;

    const resolution = async (resolve: any, result: any) => {
      await reporter.reportData(
        `${expect.getState().currentTestName || "no test name"} - ${command}`,
        `${sf(commandPrefix, { cwd: opts.cwd || process.cwd() })}${command}\n${style("SUCCESS").green.bold}\n${result}`,
        "text",
        true
      );
      resolve(result);
    };

    const rejection = async (reject: any, error: any) => {
      try {
        await reporter.reportData(
          `${expect.getState().currentTestName || "no test name"} - ${command}`,
          `${sf(commandPrefix, { cwd: opts.cwd || process.cwd() })}${command}\n${style("FAIL").red.bold}\n${error}`,
          "text",
          true
        );
      } catch (e: unknown) {
        console.error(e);
      }

      reject(error);
    };

    cmd.promise = new Promise((resolve, reject) => {
      return p
        .then(async (r) => await resolution(resolve, r))
        .catch(async (e) => await rejection(reject, e));
    });
    return cmd;
  } catch (e: unknown) {
    throw new Error(
      `Unable to create reportable command runner for ${commandPrefix}: ${e}`
    );
  }
}
