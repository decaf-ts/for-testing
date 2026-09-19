import { ChildProcess, fork } from "node:child_process";
import { join } from "node:path";
import { LoggedClass } from "@decaf-ts/logging";
import { TestReporter } from "./TestReporter";

/**
 * @description Store for logs indexed by identifier.
 * @summary A record where keys are identifiers and values are arrays of log strings.
 * @typedef {Record<number, string[]>} LogStore
 * @memberOf module:for-testing
 */
type LogStore = Record<number, string[]>;

/**
 * @description Structure of a parsed log entry.
 * @summary Contains timestamp, child identifier, and action.
 * @interface ParsedLog
 * @property {number} timestamp - The timestamp of the log.
 * @property {string} child - The child identifier.
 * @property {string} action - The action performed.
 * @memberOf module:for-testing
 */
export interface ParsedLog {
  timestamp: number;
  child: string;
  action: string;
}

/**
 * @description Result of a comparison between consumer and producer logs.
 * @summary Contains arrays of parsed logs for both consumer and producer.
 * @interface ComparerResult
 * @property {ParsedLog[]} consumer - The parsed consumer logs.
 * @property {ParsedLog[]} producer - The parsed producer logs.
 * @memberOf module:for-testing
 */
export interface ComparerResult {
  consumer: ParsedLog[];
  producer: ParsedLog[];
}

/**
 * @description Function type for comparing consumer and producer data.
 * @summary Compares two LogStores and returns a Promise resolving to ComparerResult.
 * @typedef {function(LogStore, LogStore): Promise<ComparerResult>} Comparer
 * @memberOf module:for-testing
 */
type Comparer = (
  consumerData: LogStore,
  producerData: LogStore
) => Promise<ComparerResult>;

/**
 * @description Function type for handling consumer actions.
 * @summary A function that takes an identifier and optional arguments, returning a result.
 * @typedef {function(number, ...unknown[]): unknown | Promise<unknown>} ConsumerHandler
 * @memberOf module:for-testing
 */
type ConsumerHandler = (
  identifier: number,
  ...args: unknown[]
) => unknown | Promise<unknown>;

/**
 * @description Message structure sent to the producer child process.
 * @summary Defines the properties of a message sent to control the producer.
 * @interface ProducerMessage
 * @property {number} identifier - The identifier of the producer.
 * @property {string[]} [result] - Optional result logs.
 * @property {unknown[]} [args] - Optional arguments.
 * @property {string} action - The action to perform.
 * @property {number} [timeout] - Optional timeout.
 * @property {number} times - Number of times to repeat.
 * @property {boolean} [random] - Whether to use random timeouts.
 * @memberOf module:for-testing
 */
interface ProducerMessage {
  identifier: number;
  result?: string[];
  args?: unknown[];
  action: string;
  timeout?: number;
  times: number;
  random?: boolean;
}

/**
 * @description Parses a log string into a ParsedLog object.
 * @summary Splits the log string by " - " and extracts timestamp, child, and action.
 * @param {string} data - The log string to parse.
 * @return {ParsedLog} The parsed log object.
 * @function parseData
 * @memberOf module:for-testing
 */
const parseData = (data: string): ParsedLog => {
  const [timestamp, , child, action] = data.split(" - ");
  return {
    timestamp: parseInt(timestamp, 10),
    child,
    action,
  };
};

/**
 * @description Default comparer function for consumer and producer logs.
 * @summary Sorts and compares consumer and producer logs to ensure they match.
 * @param {LogStore} consumerData - The consumer logs.
 * @param {LogStore} producerData - The producer logs.
 * @return {Promise<ComparerResult>} The comparison result.
 * @function defaultComparer
 * @memberOf module:for-testing
 */
export const defaultComparer: Comparer = async (consumerData, producerData) => {
  const sortedConsumerData = Object.keys(consumerData)
    .reduce<ParsedLog[]>((accum, key) => {
      const identifier = Number(key);
      const entries = consumerData[identifier] ?? [];
      accum.push(...entries.map((entry) => parseData(entry)));
      return accum;
    }, [])
    .sort((a, b) => a.timestamp - b.timestamp);

  const sortedProducerData = Object.keys(producerData)
    .reduce<ParsedLog[]>((accum, key) => {
      const identifier = Number(key);
      const entries = producerData[identifier] ?? [];
      accum.push(...entries.map((entry) => parseData(entry)));
      return accum;
    }, [])
    .sort((a, b) => a.timestamp - b.timestamp);

  if (sortedProducerData.length !== sortedConsumerData.length) {
    throw new Error("Producer data and consumer data does not match in length");
  }

  let counter = -1;
  const isMatching = sortedProducerData.every((producer, index) => {
    counter = index;
    const consumer = sortedConsumerData[index];
    return (
      producer.child === consumer.child && producer.action === consumer.action
    );
  });

  if (!isMatching) {
    const errorLines = [
      `Producer data and consumer data do not sort the same way as of record ${counter}:`,
      "    |             CONSUMER            |              PRODUCER            |",
      "    | id | action    | timestamp      | id | action    | timestamp       |",
    ];

    sortedProducerData.forEach((producer, index) => {
      if (index < counter || index > counter + 15) {
        return;
      }
      const consumer = sortedConsumerData[index];
      errorLines.push(
        `  ${index < 10 ? `0${index}` : index}|  ${consumer.child} | ${consumer.action}    | ${consumer.timestamp}  | ${producer.child}  | ${producer.action}    | ${producer.timestamp}   |`
      );
    });

    throw new Error(errorLines.join("\n"));
  }

  return {
    consumer: sortedConsumerData,
    producer: sortedProducerData,
  };
};

/**
 * @description Options for the reporting comparer.
 * @summary Configuration options for the reportingComparer function.
 * @interface ReportingComparerOptions
 * @property {TestReporter} [reporter] - The test reporter instance.
 * @property {string} [testCase] - The test case name.
 * @property {string} [referencePrefix] - The prefix for report references.
 * @memberOf module:for-testing
 */
export interface ReportingComparerOptions {
  reporter?: TestReporter;
  testCase?: string;
  referencePrefix?: string;
}

/**
 * @description Formats a timestamp into an ISO string.
 * @summary Converts a numeric timestamp to an ISO 8601 string.
 * @param {number} value - The timestamp to format.
 * @return {string} The formatted date string.
 * @function formatTimestamp
 * @memberOf module:for-testing
 */
const formatTimestamp = (value: number): string =>
  new Date(value).toISOString();

/**
 * @description Comparer function that reports results using TestReporter.
 * @summary Compares logs and generates a report with tables and messages.
 * @param {LogStore} consumerData - The consumer logs.
 * @param {LogStore} producerData - The producer logs.
 * @param {ReportingComparerOptions} [options] - Options for reporting.
 * @return {Promise<ComparerResult>} The comparison result.
 * @function reportingComparer
 * @memberOf module:for-testing
 */
export const reportingComparer = async (
  consumerData: LogStore,
  producerData: LogStore,
  options?: ReportingComparerOptions
): Promise<ComparerResult> => {
  const reporter =
    options?.reporter ??
    new TestReporter(options?.testCase ?? "consumer-producer");
  const referencePrefix = options?.referencePrefix ?? "consumer-producer";

  try {
    const comparison = await defaultComparer(consumerData, producerData);

    const rows = comparison.consumer.map((consumerEntry, index) => {
      const producerEntry = comparison.producer[index];
      return {
        Index: `${index}`,
        "Consumer Child": consumerEntry.child,
        "Consumer Action": consumerEntry.action,
        "Consumer Timestamp": formatTimestamp(consumerEntry.timestamp),
        "Producer Child": producerEntry?.child ?? "N/A",
        "Producer Action": producerEntry?.action ?? "N/A",
        "Producer Timestamp": producerEntry
          ? formatTimestamp(producerEntry.timestamp)
          : "N/A",
      };
    });

    await Promise.allSettled([
      reporter.reportMessage(
        `${referencePrefix}-comparison`,
        `Consumer and producer logs matched (${comparison.consumer.length} entries).`
      ),
      reporter.reportTable(`${referencePrefix}-logs`, {
        headers: [
          "Index",
          "Consumer Child",
          "Consumer Action",
          "Consumer Timestamp",
          "Producer Child",
          "Producer Action",
          "Producer Timestamp",
        ],
        rows,
      }),
    ]);

    return comparison;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");

    await Promise.allSettled([
      reporter.reportMessage(`${referencePrefix}-mismatch`, message),
      reporter.reportObject(`${referencePrefix}-consumer`, consumerData),
      reporter.reportObject(`${referencePrefix}-producer`, producerData),
    ]);

    throw error;
  }
};

/**
 * @class ConsumerRunner
 * @description Runs a consumer process and manages producer child processes.
 * @summary Orchestrates the execution of consumer and producer processes, collects logs, and compares results.
 * @param {string} action - The action name.
 * @param {ConsumerHandler} consumerHandler - The handler function for the consumer.
 * @param {Comparer} [compareHandler] - Optional custom comparer function.
 * @memberOf module:for-testing
 */
export class ConsumerRunner extends LoggedClass {
  private readonly action: string;
  private readonly handler: ConsumerHandler;
  private readonly comparerHandle: Comparer;
  private forkedCache: ChildProcess[] | undefined = [];
  private consumerResults: LogStore = {};
  private producerResults: LogStore = {};
  private childExitPromises: Array<Promise<void>> = [];
  private completionTriggered = false;
  private producerCompletion = 0;
  private consumerCompletion = 0;
  private expectedIterations = 0;
  private activeHandlers = 0;

  constructor(
    action: string,
    consumerHandler: ConsumerHandler,
    compareHandler?: Comparer
  ) {
    super();
    this.action = action;
    this.handler = consumerHandler;
    this.comparerHandle = compareHandler ?? defaultComparer;
    this.reset();
  }

  private reset(): void {
    this.forkedCache = [];
    this.consumerResults = {};
    this.producerResults = {};
    this.completionTriggered = false;
    this.childExitPromises = [];
    this.activeHandlers = 0;
    this.producerCompletion = 0;
    this.consumerCompletion = 0;
    this.expectedIterations = 0;
  }

  private waitForChildExit(): Promise<void> {
    if (!this.childExitPromises?.length) {
      return Promise.resolve();
    }
    const exits = [...this.childExitPromises];
    this.childExitPromises = [];
    return Promise.allSettled(exits).then(() => void 0);
  }

  private store(
    identifier: number,
    action: string,
    timeout: number | undefined,
    times: number,
    count: number,
    random?: boolean
  ): void {
    const logParts: Array<string | number | boolean> = [
      Date.now(),
      "PRODUCER",
      identifier,
      action,
    ];
    if (timeout) {
      logParts.push(timeout);
    }
    if (times && count) {
      logParts.push(`${count}/${times}`, random ?? false);
    }

    const log = logParts.join(" - ");
    if (!this.producerResults[identifier]) {
      this.producerResults[identifier] = [];
    }
    const logs = this.producerResults[identifier];
    logs.push(log);
    const totalTimes = times ?? this.expectedIterations;
    if (totalTimes > 0 && logs.length === totalTimes) {
      this.producerCompletion += 1;
    }
  }

  private recordConsumer(identifier: number, times?: number): void {
    const logParts: Array<string | number> = [
      Date.now(),
      "CONSUMER",
      identifier,
      this.action,
    ];
    const log = logParts.join(" - ");

    if (!this.consumerResults[identifier]) {
      this.consumerResults[identifier] = [];
    }
    const logs = this.consumerResults[identifier];
    logs.push(log);
    const totalTimes = times ?? this.expectedIterations;
    if (totalTimes > 0 && logs.length === totalTimes) {
      this.consumerCompletion += 1;
    }
  }

  private isProducerComplete(count: number): boolean {
    return this.producerCompletion >= count;
  }

  private isConsumerComplete(count: number): boolean {
    return this.consumerCompletion >= count;
  }

  private terminateChildren(forceKill = false): Promise<void> {
    if (!this.forkedCache) {
      return this.waitForChildExit();
    }
    const cached = this.forkedCache;
    this.forkedCache = undefined;
    cached.forEach((forked, index) => {
      if (!forked.connected && !forceKill) {
        return;
      }
      try {
        forked.send({
          identifier: index,
          terminate: true,
        });
      } catch {
        // IPC channel already closed; nothing else to do.
      }
      if (forceKill && !forked.killed) {
        forked.kill();
      }
    });
    return this.waitForChildExit();
  }

  /**
   * @description Runs the consumer and producer processes.
   * @summary Starts the producer child processes and the consumer handler, then waits for completion and compares results.
   * @param {number} count - The number of producers.
   * @param {number} [timeout] - The timeout for producers.
   * @param {number} times - The number of times to repeat.
   * @param {boolean} [random] - Whether to use random timeouts.
   * @return {Promise<ComparerResult>} The comparison result.
   * @mermaid
   * sequenceDiagram
   *   participant Runner as ConsumerRunner
   *   participant Child as ProducerChild
   *   participant Handler as ConsumerHandler
   *   participant Comparer as Comparer
   *   Runner->>Runner: reset()
   *   loop For each count
   *     Runner->>Child: fork()
   *     Runner->>Runner: Store child process
   *   end
   *   Runner->>Child: send(start message)
   *   loop For each message from Child
   *     Child->>Runner: message(action)
   *     Runner->>Runner: store producer log
   *     Runner->>Handler: call handler
   *     Handler-->>Runner: return
   *     Runner->>Runner: record consumer log
   *     Runner->>Runner: finalizeIfComplete()
   *   end
   *   alt Complete
   *     Runner->>Comparer: compare logs
   *     Comparer-->>Runner: return result
   *     Runner-->>Caller: resolve(result)
   *   end
   */
  async run(
    count: number,
    timeout: number | undefined,
    times: number,
    random: boolean | undefined
  ): Promise<ComparerResult> {
    this.reset();
    this.expectedIterations = times;
    const childPath = join(__dirname, "ProducerChildProcess.cjs");

    return new Promise<ComparerResult>((resolve, reject) => {
      const snapshotState = () => {
        const summarize = (records: LogStore) =>
          Object.keys(records).reduce<Record<string, number>>((acc, key) => {
            acc[key] = records[Number(key)]?.length ?? 0;
            return acc;
          }, {});
        return {
          producers: summarize(this.producerResults),
          consumers: summarize(this.consumerResults),
          activeHandlers: this.activeHandlers,
        };
      };

      const handleError = (error: unknown) => {
        if (this.completionTriggered) {
          return;
        }
        this.completionTriggered = true;
        Promise.resolve(this.terminateChildren(true)).finally(() =>
          reject(error)
        );
      };

      const finalizeIfComplete = () => {
        if (this.completionTriggered) {
          return;
        }
        if (
          !this.isProducerComplete(count) ||
          !this.isConsumerComplete(count) ||
          this.activeHandlers > 0
        ) {
          return;
        }

        this.completionTriggered = true;
        if (process.env.DEBUG_CONSUMER_RUNNER === "1") {
          console.debug("ConsumerRunner finalize state", snapshotState());
        }

        try {
          const comparisonPromise = Promise.resolve(
            this.comparerHandle(this.consumerResults, this.producerResults)
          );
          Promise.all([comparisonPromise, this.waitForChildExit()])
            .then(async ([comparison]) => {
              await new Promise((resolveDelay) => setImmediate(resolveDelay));
              resolve(comparison);
            })
            .catch(reject);
        } catch (error) {
          reject(error);
        }
      };

      for (let identifier = 1; identifier < count + 1; identifier += 1) {
        const forked = fork(childPath);
        this.forkedCache?.push(forked);
        this.childExitPromises?.push(
          new Promise<void>((resolveChild) => {
            forked.once("exit", () => resolveChild());
          })
        );

        forked.on("error", handleError);

        forked.on("message", async (message: ProducerMessage) => {
          if (this.completionTriggered) {
            return;
          }
          const {
            identifier: childId,
            args,
            action,
            timeout: childTimeout,
            times: childTimes,
            random: childRandom,
          } = message;

          this.activeHandlers += 1;
          let handlerFailed = false;
          if (process.env.DEBUG_CONSUMER_RUNNER === "1") {
            console.debug("ConsumerRunner message:start", {
              childId,
              producerCount: this.producerResults[childId]?.length ?? 0,
              consumerCount: this.consumerResults[childId]?.length ?? 0,
              activeHandlers: this.activeHandlers,
            });
          }
          try {
            this.store(
              childId,
              action,
              childTimeout,
              childTimes,
              count,
              childRandom
            );
            const handlerArgs = Array.isArray(args) ? args : [];
            await Promise.resolve(this.handler(childId, ...handlerArgs));

            this.recordConsumer(childId, childTimes ?? times);
            if (process.env.DEBUG_CONSUMER_RUNNER === "1") {
              console.debug("ConsumerRunner message:complete", {
                childId,
                producerCount: this.producerResults[childId]?.length ?? 0,
                consumerCount: this.consumerResults[childId]?.length ?? 0,
                activeHandlers: this.activeHandlers,
              });
            }
          } catch (error) {
            handlerFailed = true;
            handleError(error);
          } finally {
            this.activeHandlers = Math.max(0, this.activeHandlers - 1);
            if (!handlerFailed) {
              finalizeIfComplete();
            }
          }
        });
      }

      this.forkedCache?.forEach((forked, index) => {
        forked.send({
          identifier: index,
          action: this.action,
          timeout,
          times,
          random,
        });
      });
    });
  }
}
