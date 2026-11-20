import type { StoryboardAction, StoryboardPage } from "./storyboard";

/** Runtime owned by one execution. The runner never creates, resets, or closes its page. */
export interface StoryboardFlowContext<State> {
  state: State;
  args: string[];
  page?: StoryboardPage;
  signal?: AbortSignal;
  /** Failure routed to the current state's onError transition. */
  error?: unknown;
}

export type StoryboardTask<State> = (context: StoryboardFlowContext<State>) => void | Promise<void>;
export type StoryboardCondition<State> = (context: StoryboardFlowContext<State>) => boolean | Promise<boolean>;
export type StoryboardFlowAction = StoryboardAction | { type: "task"; name: string };

export interface StoryboardFlowState {
  actions: StoryboardFlowAction[];
  /** First matching transition wins. An unconditional transition must be last. */
  transitions: Array<{ when?: string; to: string | null }>;
  /** Route a failed action to another state. Unhandled failures reject the execution. */
  onError?: string;
}

/** A state graph describes branches and loops without requiring a test framework or browser. */
export interface StoryboardFlow<State> {
  initial: string;
  /** Application stop condition, checked before every state/action. */
  stopWhen?: string;
  state: () => State | Promise<State>;
  states: Record<string, StoryboardFlowState>;
  tasks?: Record<string, StoryboardTask<State>>;
  conditions?: Record<string, StoryboardCondition<State>>;
  initialize?: StoryboardTask<State>;
  /** Always called, including when initialize fails or execution is cancelled. */
  finalize?: StoryboardTask<State>;
}

export interface StoryboardFlowOptions {
  args?: string[];
  page?: StoryboardPage;
  signal?: AbortSignal;
  /** Test/embedding observer; also useful for tracing without recording credentials. */
  onState?: (name: string) => void;
}

export function validateStoryboardFlow<State>(flow: StoryboardFlow<State>): void {
  if (!flow || typeof flow.state !== "function" || !flow.states?.[flow.initial]) {
    throw new Error("Storyboard flow requires a state factory and a valid initial state.");
  }
  if (flow.stopWhen !== undefined && typeof flow.conditions?.[flow.stopWhen] !== "function") {
    throw new Error(`Unknown storyboard stop condition ${flow.stopWhen}.`);
  }
  for (const [name, node] of Object.entries(flow.states)) {
    if (!Array.isArray(node.actions) || !Array.isArray(node.transitions)) {
      throw new Error(`Storyboard state ${name} requires actions and transitions.`);
    }
    for (const action of node.actions) {
      if (action.type === "task" && typeof flow.tasks?.[action.name] !== "function") {
        throw new Error(`Unknown storyboard task ${action.name} in ${name}.`);
      }
    }
    for (const [index, transition] of node.transitions.entries()) {
      if (transition.to !== null && !flow.states[transition.to]) {
        throw new Error(`Unknown storyboard transition ${transition.to} in ${name}.`);
      }
      if (transition.when !== undefined && typeof flow.conditions?.[transition.when] !== "function") {
        throw new Error(`Unknown storyboard condition ${transition.when} in ${name}.`);
      }
      if (transition.when === undefined && index !== node.transitions.length - 1) {
        throw new Error(`Unconditional storyboard transition must be last in ${name}.`);
      }
    }
    if (node.onError !== undefined && !flow.states[node.onError]) {
      throw new Error(`Unknown storyboard error state ${node.onError} in ${name}.`);
    }
  }
}

/** Execute a graph on a caller-owned session. No test globals or Playwright imports are used. */
export async function runStoryboardFlow<State>(
  flow: StoryboardFlow<State>,
  applyAction: (page: StoryboardPage, action: StoryboardAction) => Promise<void>,
  options: StoryboardFlowOptions = {}
): Promise<State> {
  validateStoryboardFlow(flow);
  options.signal?.throwIfAborted();
  const context: StoryboardFlowContext<State> = {
    state: await flow.state(), args: [...(options.args ?? [])], page: options.page, signal: options.signal,
  };
  try {
    options.signal?.throwIfAborted();
    await flow.initialize?.(context);
    let current: string | null = flow.initial;
    const stopped = async () => {
      options.signal?.throwIfAborted();
      const stop = flow.stopWhen !== undefined && await flow.conditions![flow.stopWhen](context);
      options.signal?.throwIfAborted();
      return stop;
    };
    execution: while (current !== null) {
      // Let timers and external cancellation run even in graphs of synchronous tasks.
      await new Promise<void>(resolve => setImmediate(resolve));
      options.signal?.throwIfAborted();
      if (await stopped()) break;
      options.onState?.(current);
      const node: StoryboardFlowState = flow.states[current];
      try {
        for (const action of node.actions) {
          if (await stopped()) break execution;
          options.signal?.throwIfAborted();
          if (action.type === "task") await flow.tasks![action.name](context);
          else {
            if (!context.page) throw new Error(`Storyboard browser action ${action.type} requires a page.`);
            await applyAction(context.page, action);
          }
          options.signal?.throwIfAborted();
        }
        let matched = false;
        for (const transition of node.transitions) {
          options.signal?.throwIfAborted();
          const matches = transition.when === undefined || await flow.conditions![transition.when](context);
          options.signal?.throwIfAborted();
          if (matches) {
            current = transition.to;
            matched = true;
            break;
          }
        }
        if (!matched) throw new Error(`No storyboard transition matched in ${current}.`);
      } catch (error) {
        // Cancellation must never be swallowed by an application recovery transition.
        options.signal?.throwIfAborted();
        if (node.onError === undefined) throw error;
        context.error = error;
        current = node.onError;
      }
    }
    return context.state;
  } finally {
    await flow.finalize?.(context);
  }
}
