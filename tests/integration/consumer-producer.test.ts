describe("Consumer-producer", () => {
  it.skip("runs consumer-producer with transaction management", async () => {
    const {
      ConsumerRunner,
      defaultComparer,
      // eslint-disable-next-line @typescript-eslint/no-require-imports
    } = require("../../lib/cjs/Consumer.cjs");

    const count = 5,
      times = 5;

    const consumerRunner = new ConsumerRunner(
      "create",
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      async (_identifier: number) => {
        // do something on this side to test it's concurrency
        return "";
      },
      defaultComparer
    );

    await consumerRunner.run(count, 100, times, true);
  });

  class StubReporter {
    messages: Array<{ title: string; message: string | object }> = [];
    tables: Array<{
      reference: string;
      headers: string[];
      rows: Record<string, string | string[]>[];
    }> = [];
    objects: Record<string, unknown> = {};

    async reportMessage(
      title: string,
      message: string | object
    ): Promise<void> {
      this.messages.push({ title, message });
    }

    async reportTable(
      reference: string,
      table: {
        headers: string[];
        rows: Record<string, string | string[]>[];
      }
    ): Promise<void> {
      this.tables.push({ reference, headers: table.headers, rows: table.rows });
    }

    async reportObject(reference: string, payload: object): Promise<void> {
      this.objects[reference] = payload;
    }

    // The comparer awaits these methods; align with TestReporter API surface

    async reportData(): Promise<void> {
      return;
    }
  }

  it("coordinates producer child processes via the compiled test runner", async () => {
    const {
      ConsumerRunner,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      defaultComparer,
      reportingComparer,
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      } = require("../../lib/cjs/Consumer.cjs");

    const count = 2;
    const times = 3;
    const reporter = new StubReporter();

    const comparer = (
      consumerData: Record<number, string[]>,
      producerData: Record<number, string[]>
    ) =>
      reportingComparer(consumerData, producerData, {
        reporter,
        referencePrefix: "integration",
      });

    const consumerRunner = new ConsumerRunner(
      "process",
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      (_identifier: number) => {
        // synchronous handler: default comparer should still execute
        return undefined;
      },
      comparer
    );

    const result = await consumerRunner.run(count, 20, times, false);

    expect(result.consumer).toHaveLength(count * times);
    expect(result.producer).toHaveLength(count * times);
    expect(reporter.messages).toHaveLength(1);
    expect(reporter.tables).toHaveLength(1);
    expect(Object.keys(reporter.objects)).toHaveLength(0);
  });
});
