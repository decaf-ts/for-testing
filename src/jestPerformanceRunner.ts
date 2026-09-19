import path from "path";
import { mkdir, writeFile } from "fs/promises";
import {
  PerformanceScenario,
  PerformanceRunner,
  Phase,
  PhaseResult,
} from "@decaf-ts/utils";
import { TestReporter } from "./TestReporter";
import type { MdTableDefinition } from "./vendor/md";

/**
 * @description Re-export of the {@link PerformanceScenario} contract from
 * `@decaf-ts/utils`, extended with the jest reporting integration context.
 * @summary A performance scenario: named phases with their run configurations
 * plus optional `initialize` and `canvasOutputPath`, where each phase result is
 * reported both to the console and to the jest-html-reporters evidence stream.
 * @typedef {PerformanceScenario<TContext>} JestPerformanceScenario
 * @memberOf module:for-testing
 * @template TContext - The mutable context shared between phases.
 */
export type JestPerformanceScenario<TContext = Record<string, unknown>> =
  PerformanceScenario<TContext>;

/**
 * @description Performance runner that plugs the `@decaf-ts/utils` performance
 * engine into the jest reporting pipeline of this package.
 * @summary Extends {@link PerformanceRunner} to run phases inside jest
 * `describe`/`it` blocks: per-phase results are logged to the console and
 * reported as markdown tables through the {@link TestReporter}, and after all
 * phases a combined summary table plus a Chart.js bar chart (with a failures
 * overlay) are reported and optionally persisted as a PNG. Phase failures are
 * recorded in the aggregated results instead of failing the `it`.
 * @class JestPerformanceRunner
 * @extends PerformanceRunner
 * @memberOf module:for-testing
 * @template TContext - The mutable context shared between phases.
 */
export class JestPerformanceRunner<
  TContext = Record<string, unknown>,
> extends PerformanceRunner<TContext> {
  protected override scenario: JestPerformanceScenario<TContext>;
  private readonly reporter: TestReporter;

  /**
   * @description Creates a runner for the given scenario and its evidence reporter.
   * @summary Initializes the base runner and creates a {@link TestReporter}
   * named after the (sanitized) scenario name, writing evidences under
   * `workdocs/reports/evidences` in the current working directory.
   * @param {JestPerformanceScenario<TContext>} scenario The performance
   * scenario (phases, configurations and optional hooks) to run.
   */
  constructor(scenario: JestPerformanceScenario<TContext>) {
    super(scenario);
    this.scenario = scenario;
    const reporterName = scenario.name
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .toLowerCase();
    this.reporter = new TestReporter(
      reporterName,
      path.join(process.cwd(), "workdocs", "reports", "evidences")
    );
  }

  /** Disable the base-class text-table canvas; we render a proper bar chart instead. */
  protected override shouldRenderCanvas(): boolean {
    return false;
  }

  /** Logs per-phase table to the jest-html-reporters attachment. */
  private async reportPhaseToReporter(
    result: PhaseResult<TContext>
  ): Promise<void> {
    try {
      const tableDef = this.buildTableDef([result]);
      await this.reporter.reportTable(`phase: ${result.phase.name}`, tableDef);
    } catch (e) {
      console.error(
        "[JestPerformanceRunner] Failed to report phase table:",
        e
      );
    }
  }

  /**
   * After all phases finish: console-log the combined summary (base class),
   * then report the summary table and a bar chart with the reporter.
   */
  protected override async logSummary(
    results: PhaseResult<TContext>[]
  ): Promise<void> {
    // Console table (base class), canvas skipped via shouldRenderCanvas()
    await super.logSummary(results);

    if (!results.length) return;

    // Report markdown table via jest-html-reporters
    try {
      const tableDef = this.buildTableDef(results);
      await this.reporter.reportTable(
        `summary: ${this.scenario.name}`,
        tableDef
      );
    } catch (e) {
      console.error(
        "[JestPerformanceRunner] Failed to report summary table:",
        e
      );
    }

    // Render and report bar chart; also write PNG to canvasOutputPath if set
    try {
      const chartConfig = this.buildPhaseChart(results);
      const buf = await this.reporter.reportGraph(
        `chart: ${this.scenario.name}`,
        chartConfig,
        1200,
        600
      );

      if (this.scenario.canvasOutputPath) {
        await mkdir(path.dirname(this.scenario.canvasOutputPath), {
          recursive: true,
        });
        await writeFile(this.scenario.canvasOutputPath, buf);
        console.log(
          `[PerfRunner] Stored performance chart at ${this.scenario.canvasOutputPath}`
        );
      }
    } catch (e) {
      console.error("[JestPerformanceRunner] Failed to render chart:", e);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private buildTableDef(results: PhaseResult<TContext>[]): MdTableDefinition {
    const headers = [
      "Phase",
      "Mode",
      "Iterations",
      "Wall ms",
      "RPS",
      "Avg ms",
      "Min ms",
      "Max ms",
      "Success",
      "Failures",
    ];
    const rows = results.map((r) => {
      const rps = (r.config.iterations / (r.wallClockMs / 1000)).toFixed(1);
      return {
        Phase: r.phase.name,
        Mode: r.config.mode,
        Iterations: r.config.iterations.toString(),
        "Wall ms": r.wallClockMs.toFixed(0),
        RPS: rps,
        "Avg ms": r.aggregated.averageMs.toFixed(2),
        "Min ms": r.aggregated.minMs.toFixed(2),
        "Max ms": r.aggregated.maxMs.toFixed(2),
        Success: r.aggregated.successCount.toString(),
        Failures: r.aggregated.failureCount.toString(),
      };
    });
    return { headers, rows };
  }

  /**
   * Builds a Chart.js config: grouped bar columns (Wall/Avg/Min/Max ms)
   * with a red line overlay for failure counts on a secondary right axis.
   */
  private buildPhaseChart(results: PhaseResult<TContext>[]): object {
    const labels = results.map((r) => r.phase.name);
    const hasFailures = results.some((r) => r.aggregated.failureCount > 0);

    const datasets: object[] = [
      {
        type: "bar",
        label: "Wall ms",
        data: results.map((r) => Math.round(r.wallClockMs)),
        backgroundColor: "rgba(59, 130, 246, 0.75)",
        borderColor: "rgba(59, 130, 246, 1)",
        borderWidth: 1,
        yAxisID: "y",
      },
      {
        type: "bar",
        label: "Avg ms",
        data: results.map((r) => Math.round(r.aggregated.averageMs)),
        backgroundColor: "rgba(16, 185, 129, 0.75)",
        borderColor: "rgba(16, 185, 129, 1)",
        borderWidth: 1,
        yAxisID: "y",
      },
      {
        type: "bar",
        label: "Min ms",
        data: results.map((r) => Math.round(r.aggregated.minMs)),
        backgroundColor: "rgba(245, 158, 11, 0.75)",
        borderColor: "rgba(245, 158, 11, 1)",
        borderWidth: 1,
        yAxisID: "y",
      },
      {
        type: "bar",
        label: "Max ms",
        data: results.map((r) => Math.round(r.aggregated.maxMs)),
        backgroundColor: "rgba(139, 92, 246, 0.75)",
        borderColor: "rgba(139, 92, 246, 1)",
        borderWidth: 1,
        yAxisID: "y",
      },
      {
        type: "line",
        label: "Failures",
        data: results.map((r) => r.aggregated.failureCount),
        borderColor: "rgba(239, 68, 68, 1)",
        backgroundColor: "rgba(239, 68, 68, 0.15)",
        borderWidth: 2.5,
        pointRadius: 6,
        pointBackgroundColor: "rgba(239, 68, 68, 1)",
        pointBorderColor: "white",
        pointBorderWidth: 1.5,
        fill: false,
        tension: 0.3,
        yAxisID: "yRight",
      },
    ];

    return {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          title: {
            display: true,
            text: `Performance: ${this.scenario.name}`,
            font: { size: 16, weight: "bold" },
            padding: { top: 10, bottom: 16 },
          },
          legend: {
            display: true,
            position: "top",
            labels: { font: { size: 12 }, padding: 16 },
          },
        },
        scales: {
          x: {
            title: {
              display: true,
              text: "Phase",
              font: { size: 12 },
            },
            ticks: { maxRotation: 30, font: { size: 11 } },
          },
          y: {
            type: "linear",
            position: "left",
            beginAtZero: true,
            title: {
              display: true,
              text: "Time (ms)",
              font: { size: 12 },
            },
            ticks: {
              callback: function (value: number) {
                return value >= 1000
                  ? `${(value / 1000).toFixed(1)}s`
                  : `${value}ms`;
              },
            },
          },
          yRight: {
            type: "linear",
            position: "right",
            display: hasFailures,
            beginAtZero: true,
            title: {
              display: hasFailures,
              text: "Failures",
              color: "rgba(239, 68, 68, 1)",
              font: { size: 12 },
            },
            ticks: {
              color: "rgba(239, 68, 68, 1)",
              font: { size: 11 },
            },
            grid: { drawOnChartArea: false },
          },
        },
        layout: { padding: { left: 16, right: 16, top: 8, bottom: 16 } },
      },
    };
  }

  // ── Jest describe/it wiring ────────────────────────────────────────────────

  /**
   * @description Registers Jest describe/it blocks for the scenario.
   * @summary Creates one `it` per phase — the `it`s never fail; errors are
   * only recorded in the aggregated results. Logs a per-phase console table
   * and reports it via {@link TestReporter} after each `it`; reports the
   * combined table plus bar chart in `afterAll`.
   * @param {Object} [hooks] Optional lifecycle hooks.
   * @param {Function} [hooks.beforeAll] Runs after `scenario.initialize` but
   * before any `it`. Use this to populate shared mutable state (e.g. metadata
   * objects) that phase configs reference.
   * @return {void}
   */
  public describeSuite(hooks?: {
    beforeAll?: () => Promise<void> | void;
  }): void {
    describe(this.scenario.name, () => {
      const results: PhaseResult<TContext>[] = [];

      beforeAll(async () => {
        if (this.scenario.initialize) {
          await this.scenario.initialize();
        }
        if (hooks?.beforeAll) {
          await hooks.beforeAll();
        }
      });

      this.scenario.phases.forEach((phase: Phase<TContext>) => {
        it(phase.name, async () => {
          try {
            const context = this.mergeContext(phase);
            const result = await this.runPhase(phase, context);
            results.push(result);
            // Console table (sync)
            this.logPhaseTable(result);
            // Reporter table (async, await so it completes before it ends)
            await this.reportPhaseToReporter(result);
          } catch (e) {
            console.error(
              `[JestPerformanceRunner] Phase "${phase.name}" encountered an error:`,
              e
            );
            // Never fail the it — errors are surfaced in the summary table
          }
        });
      });

      afterAll(async () => {
        // Console summary + reporter table + bar chart PNG
        await this.logSummary(results);
      });
    });
  }
}
