/**
 * @description Child-process entrypoint for the `Consumer` producer side. This
 * file is not imported through the package surface; it is spawned with
 * `fork`/`spawn` by the consumer/producer test tooling and communicates with
 * its parent exclusively over the IPC channel.
 * @summary Listens for a single {@link ParentMessage} from the parent process,
 * then emits `times` "PRODUCER" log lines — either all at once (no `timeout`)
 * or spaced by fixed or random `timeout` intervals — acknowledging each tick
 * with a {@link ProducerResponse} and exiting with code 0 once the run is
 * complete, immediately on `terminate`, or when `times` is absent (single
 * fire-and-forget tick).
 */

/**
 * @description Message sent by the parent process over IPC to command the
 * producer.
 * @summary Tells the child how many "PRODUCER" log lines to emit, at which
 * pace, and how the acknowledgement should be addressed.
 * @typedef {Object} ParentMessage
 * @property {number} identifier Identifier echoed back by the child process.
 * @property {string} action The action name echoed back by the child process.
 * @property {number} [timeout] Delay in milliseconds between ticks; when
 * `random`, each tick waits a random duration up to this value.
 * @property {number} times Number of log lines to produce; `0` produces one.
 * @property {boolean} [random] Randomize each tick's delay within `timeout`.
 * @property {boolean} [terminate] Quit immediately without producing logs.
 */
type ParentMessage = {
  identifier: number;
  action: string;
  timeout?: number;
  times: number;
  random?: boolean;
  terminate?: boolean;
};

/**
 * @description Acknowledgement payload sent back to the parent process after
 * each produced log line.
 * @summary Mirrors the received {@link ParentMessage} fields and, once all
 * `times` lines were produced, carries the accumulated `result` lines.
 * @typedef {Object} ProducerResponse
 * @property {number} identifier The identifier from the parent message.
 * @property {string} action The action from the parent message.
 * @property {number} [timeout] The timeout from the parent message.
 * @property {number} times The times value from the parent message.
 * @property {boolean} [random] The random flag from the parent message.
 * @property {string[]} [result] All produced log lines, present only on the
 * final acknowledgement.
 */
type ProducerResponse = {
  identifier: number;
  action: string;
  timeout?: number;
  times: number;
  random?: boolean;
  result?: string[];
};

let shuttingDown = false;

/**
 * @description Exits the process with code 0 exactly once, regardless of how
 * many code paths request shutdown.
 * @summary Guards concurrent exits with a module-level `shuttingDown` flag,
 * logs the optional message, and defers `process.exit(0)` to the next
 * event-loop turn so pending IPC writes are flushed first.
 * @param {string} [logMessage] Message to log before exiting.
 * @return {void}
 */
const completeAndExit = (logMessage?: string) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (logMessage) {
    console.log(logMessage);
  }
  setImmediate(() => process.exit(0));
};

process.on("message", (args: ParentMessage) => {
  const result: string[] = [];
  const {identifier, action, timeout, times, random, terminate} = args;

  const tick = (count: number) => {
    const logParts: Array<string | number | boolean> = [Date.now(), 'PRODUCER', identifier, action];
    if (timeout) {
      logParts.push(timeout);
    }
    if (times && count) {
      logParts.push(`${count}/${times}`, random ?? false);
    }

    const log = logParts.join(' - ');
    result.push(log);

    const response: ProducerResponse = {identifier, action, timeout, times, random};
    if (result.length === times) {
      response.result = [...result];
    }

    process.send?.(response);
    if (response.result) {
      completeAndExit();
    } else if (!times) {
      completeAndExit();
    }
  };

  if (terminate) {
    const log = [Date.now(), "PRODUCER", identifier, action, "Quitting!"].join(" - ");
    completeAndExit(log);
    return;
  }

  if (!timeout) {
    tick(times);
    return;
  }

  const getTimeout = () => {
    if (!random) {
      return timeout;
    }
    return Math.floor(Math.random() * timeout);
  };

  let actionCount = 0;

  const iterator = () => {
    const currentTimeout = getTimeout();
    setTimeout(() => {
      actionCount += 1;
      tick(actionCount);
      if (actionCount < times) {
        iterator();
      }
    }, currentTimeout);
  };

  iterator();
});
