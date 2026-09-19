import * as path from "path";
import {
  PhaseConfig,
  PhaseGenerator,
  PerformanceHandler,
} from "@decaf-ts/utils";
import { JestPerformanceRunner } from "../../src";

const TARGET_ENDPOINT = process.env.LOAD_TEST_ENDPOINT;
const perfDebugEnabled = process.env.PERF_VERBOSE === "true";

interface EndpointLoadContext {
  endpoint: string;
  scenarioId: string;
  phaseName?: string;
}

const handler: PerformanceHandler<EndpointLoadContext> = async ({
  iteration,
  loadFactor,
  context,
}) => {
  if (perfDebugEnabled) {
    console.debug(
      `[Handler] phase=${context.phaseName} iteration=${iteration} load=${loadFactor.toFixed(
        2
      )}`
    );
  }
  const response = await fetch(context.endpoint, {
    method: "GET",
  });

  return {
    success: response.ok,
    meta: {
      phase: context.phaseName,
      iteration,
      loadFactor,
      status: response.status,
    },
  };
};

const initialPhase: PhaseConfig<EndpointLoadContext> = {
  iterations: 10,
  mode: "concurrent",
  concurrency: 5,
  loadStart: 1,
  loadStep: 0.1,
  burst: {
    size: 10,
    intervalMs: 600,
  },
  context: {
    phaseName: "phase-1",
  },
  pauseAfterMs: 5000,
};

const MAX_PHASES = 4;

const configGenerator: PhaseGenerator<EndpointLoadContext> = ({
  metadata,
  history,
}) => {
  if (metadata.phaseNumber >= MAX_PHASES) {
    return undefined;
  }

  const nextPhase = metadata.phaseNumber + 1;
  const iterations = Math.min(
    10000,
    initialPhase.iterations * Math.pow(10, metadata.phaseNumber)
  );
  const concurrency = Math.min(
    80,
    (initialPhase.concurrency ?? 5) * Math.pow(2, metadata.phaseNumber)
  );
  const baseLoadStart = initialPhase.loadStart ?? 1;
  const completedIterations = history.reduce(
    (acc, result) => acc + result.config.iterations,
    0
  );
  const warmupBoost = Math.min(5, Math.floor(completedIterations / 250));
  const loadStart = baseLoadStart + metadata.phaseNumber * 2 + warmupBoost;
  const loadStep = Math.max(
    0.01,
    (initialPhase.loadStep ?? 0.1) - metadata.phaseNumber * 0.02
  );
  const burstFactor = Math.max(1, metadata.segmentCount);
  const burstSize = Math.min(
    iterations,
    Math.max(25, Math.floor(iterations / (burstFactor * 2)))
  );
  const burstIntervalMs = 600 + metadata.phaseNumber * 400;

  console.info(
    `[ConfigGenerator] ${metadata.phaseName} (phase #${metadata.phaseNumber}) -> nextPhase=${nextPhase}, iterations=${iterations}, concurrency=${concurrency}, burstSize=${burstSize}`
  );

  return {
    name: `Phase ${nextPhase} – ${iterations.toLocaleString()} calls`,
    config: {
      iterations,
      mode: "concurrent",
      concurrency,
      loadStart,
      loadStep,
      burst: {
        size: burstSize,
        intervalMs: burstIntervalMs,
      },
      context: {
        phaseName: `phase-${nextPhase}`,
      },
      pauseAfterMs: 5000,
    },
  };
};

describe("Incremental endpoint load", () => {
  if (!TARGET_ENDPOINT) {
    it("requires LOAD_TEST_ENDPOINT to be defined to run", () => {
      expect(true).toBe(true);
    });
    return;
  }

  const scenario = new JestPerformanceRunner<EndpointLoadContext>({
    name: "Incremental concurrent endpoint load",
    handler,
    initialize: () => {
      console.info("Targeting incremental load endpoint", TARGET_ENDPOINT);
    },
    baseContext: {
      endpoint: TARGET_ENDPOINT,
      scenarioId: "incremental-endpoint-load",
    },
    canvasOptions: {
      width: 1200,
      height: 340,
      padding: 32,
      backgroundColor: "#0b1220",
      headerFont: "bold 18px 'Segoe UI', sans-serif",
      rowFont: "14px 'Segoe UI', sans-serif",
      headerColor: "#f1f5f9",
      rowColor: "#dbeafe",
    },
    canvasOutputPath: path.join(
      process.cwd(),
      "workdocs",
      "reports",
      "incremental-endpoint-load.png"
    ),
    failOnError: true,
    phases: [
      {
        name: "Phase 1 – Starter burst",
        config: initialPhase,
        generator: configGenerator,
      },
    ],
  });

  jest.setTimeout(60000 * 5);
  scenario.describeSuite();
});
