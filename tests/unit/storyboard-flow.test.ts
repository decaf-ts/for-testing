import { StoryboardRunner, type StoryboardScenario, type StoryboardPage } from "../../src/ui";

function definition(): StoryboardScenario<{ count: number }> {
  return {
    id: "loop", section: "flow", title: "Repeat", route: "",
    flow: {
      initial: "increment", state: () => ({ count: 0 }),
      tasks: { increment: ({ state }) => { state.count++; } },
      conditions: { more: ({ state }) => state.count < 3 },
      states: {
        increment: { actions: [{ type: "task", name: "increment" }], transitions: [{ when: "more", to: "increment" }, { to: null }] },
      },
    },
  };
}

describe("Storyboard workflow execution", () => {
  it("executes conditional loops with fresh shared state and no browser or test-runner globals", async () => {
    const storyboard = definition();
    const states: string[] = [];
    expect(await StoryboardRunner.runScenario(storyboard, { onState: name => states.push(name) })).toEqual({ count: 3 });
    expect(states).toEqual(["increment", "increment", "increment"]);
    expect(await StoryboardRunner.runScenario(storyboard)).toEqual({ count: 3 });
  });

  it("uses the caller's exact page without creating, clearing or closing its context", async () => {
    const storyboard = definition();
    const click = jest.fn(async () => undefined);
    const page = { locator: () => ({ first: () => ({ click }) }), context: jest.fn() } as unknown as StoryboardPage;
    storyboard.flow!.states.increment.actions.push({ type: "click", selector: "#next" });
    await StoryboardRunner.runScenario(storyboard, { page });
    expect(click).toHaveBeenCalledTimes(3);
    expect(page.context).not.toHaveBeenCalled();
  });

  it("shares arguments and routes failed actions to an explicit recovery state", async () => {
    const storyboard = definition();
    const finalize = jest.fn();
    const failure = new Error("recover me");
    storyboard.flow!.tasks!.increment = () => { throw failure; };
    storyboard.flow!.tasks!.recover = ({ state, args, error }) => {
      expect(error).toBe(failure); expect(args).toEqual(["--custom", "value"]); state.count = 8;
    };
    storyboard.flow!.states.increment.onError = "recover";
    storyboard.flow!.states.recover = { actions: [{ type: "task", name: "recover" }], transitions: [{ to: null }] };
    storyboard.flow!.finalize = finalize;
    expect(await StoryboardRunner.runScenario(storyboard, { args: ["--custom", "value"] })).toEqual({ count: 8 });
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid graphs before allocating a session", async () => {
    const storyboard = definition(); const initialize = jest.fn(); storyboard.flow!.initialize = initialize;
    storyboard.flow!.states.increment.transitions[0].to = "missing";
    await expect(StoryboardRunner.runScenario(storyboard)).rejects.toThrow("Unknown storyboard transition");
    expect(initialize).not.toHaveBeenCalled();
  });

  it.each(["task", "condition", "error-state"])("rejects an unknown %s reference", async (kind) => {
    const storyboard = definition();
    if (kind === "task") storyboard.flow!.tasks = {};
    if (kind === "condition") storyboard.flow!.conditions = {};
    if (kind === "error-state") storyboard.flow!.states.increment.onError = "missing";
    await expect(StoryboardRunner.runScenario(storyboard)).rejects.toThrow(/Unknown storyboard/);
  });

  it("finalizes after an initialization failure", async () => {
    const storyboard = definition(); const finalize = jest.fn();
    storyboard.flow!.initialize = () => { throw new Error("initialize failed"); };
    storyboard.flow!.finalize = finalize;
    await expect(StoryboardRunner.runScenario(storyboard)).rejects.toThrow("initialize failed");
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("finalizes after an unhandled action failure", async () => {
    const storyboard = definition(); const finalize = jest.fn();
    storyboard.flow!.tasks!.increment = () => { throw new Error("action failed"); };
    storyboard.flow!.finalize = finalize;
    await expect(StoryboardRunner.runScenario(storyboard)).rejects.toThrow("action failed");
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("does not swallow cancellation in an error transition", async () => {
    const storyboard = definition(); const controller = new AbortController(); const finalize = jest.fn();
    storyboard.flow!.tasks!.increment = () => controller.abort(new Error("cancelled"));
    storyboard.flow!.states.increment.onError = "increment";
    storyboard.flow!.finalize = finalize;
    await expect(StoryboardRunner.runScenario(storyboard, { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it("yields to external cancellation even when loop tasks are synchronous", async () => {
    const storyboard = definition(); const controller = new AbortController();
    storyboard.flow!.conditions!.more = () => true;
    const timer = setTimeout(() => controller.abort(new Error("external cancellation")), 10);
    try { await expect(StoryboardRunner.runScenario(storyboard, { signal: controller.signal })).rejects.toThrow("external cancellation"); }
    finally { clearTimeout(timer); }
  });

  it("fails a graph that has no matching transition", async () => {
    const storyboard = definition(); storyboard.flow!.states.increment.transitions = [];
    await expect(StoryboardRunner.runScenario(storyboard)).rejects.toThrow("No storyboard transition matched");
  });
});

describe("screenshot Storyboard compatibility", () => {
  it("retains isolated contexts, storage reset, screenshot capture and context closure", async () => {
    const { mkdtemp, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const directory = await mkdtemp(join(tmpdir(), "storyboard-legacy-"));
    const addInitScript = jest.fn(async () => undefined);
    const close = jest.fn(async () => undefined);
    const screenshot = jest.fn(async () => undefined);
    const goto = jest.fn(async () => undefined);
    const page = {
      unroute: async () => undefined, evaluate: async () => undefined, goto, screenshot,
      context: () => ({ addInitScript }),
    };
    const newContext = jest.fn(async () => ({ newPage: async () => page, close }));
    const suppliedPage = { context: () => ({ browser: () => ({ newContext }) }) } as unknown as StoryboardPage;
    try {
      const runner = new StoryboardRunner({
        title: "Legacy", guideFile: join(directory, "guide.md"), screenshotsDir: join(directory, "screenshots"),
        scenarios: [{ id: "legacy", section: "Legacy", title: "A screenshot", route: "https://example.test" }],
      });
      await runner.runWithPage(suppliedPage);
      expect(newContext).toHaveBeenCalledTimes(1);
      expect(addInitScript).toHaveBeenCalledTimes(1);
      expect(goto).toHaveBeenCalledWith("https://example.test", expect.anything());
      expect(screenshot).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("application stopping", () => {
  it("checks stopWhen before every action, including after observer callbacks", async () => {
    const storyboard = definition(); let stopped = false;
    storyboard.flow!.stopWhen = "stop";
    storyboard.flow!.conditions!.stop = () => stopped;
    const result = await StoryboardRunner.runScenario(storyboard, { onState: () => { stopped = true; } });
    expect(result.count).toBe(0);
  });
});
