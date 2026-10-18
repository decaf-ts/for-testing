import { it as reportedIt } from "../../src";

/**
 * Live registration through the real jest adapter. The contract-level details
 * (failure reporting, modes, each expansion) are covered with a capturing
 * adapter in `it-report.test.ts`; this file proves the facade actually
 * registers with the host runner while the module is evaluated.
 */
const reporter = { reportObject: jest.fn() };

describe("live it.report registration", () => {
  reportedIt.report(
    "registers and runs a reported test",
    () => {
      expect(true).toBe(true);
    },
    { reporter: reporter as never }
  );

  reportedIt.report.skip(
    "registers and skips a reported test",
    () => {
      throw new Error("it.report.skip must not run");
    },
    { reporter: reporter as never }
  );

  reportedIt.report.each([
    [1, 2],
    [3, 4],
  ])("adds %i + %i", (a: number, b: number) => {
    expect(b - a).toBe(1);
  });
});
