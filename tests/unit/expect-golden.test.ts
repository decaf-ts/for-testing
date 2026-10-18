import {
  createExpect,
  expect as reportedExpect,
  getReporter,
  ReportExpect,
  setReporter,
  type ExpectApi,
} from "../../src";
import {
  FROZEN_GOLDEN_CASES,
  type FrozenGoldenCase,
} from "./fixtures/expect-golden-84bd171";

interface GoldenCase {
  name: string;
  legacy: (report: ReportExpect) => void;
  chain: (expect: ExpectApi) => void;
}

/**
 * The 24-case matrix used by the SAA-973 independent verification: every
 * matcher with a passing and a failing input, plus `.not` cases across the
 * matcher surface. Each case runs the same values through the legacy
 * `ReportExpect.assertToX` skin and the new
 * `expect(actual).referredToAs(label).to.*` facade.
 */
const GOLDEN_CASES: GoldenCase[] = [
  {
    name: "be passes",
    legacy: (report) => report.assertToBe(2, 2, "value"),
    chain: (expect) => expect(2).referredToAs("value").to.be(2),
  },
  {
    name: "be fails",
    legacy: (report) => report.assertToBe(2, 3, "value"),
    chain: (expect) => expect(3).referredToAs("value").to.be(2),
  },
  {
    name: "equal passes",
    legacy: (report) => report.assertToEqual({ a: 1 }, { a: 1 }, "payload"),
    chain: (expect) =>
      expect({ a: 1 }).referredToAs("payload").to.equal({ a: 1 }),
  },
  {
    name: "equal fails",
    legacy: (report) => report.assertToEqual({ a: 1 }, { a: 2 }, "payload"),
    chain: (expect) =>
      expect({ a: 2 }).referredToAs("payload").to.equal({ a: 1 }),
  },
  {
    name: "contain passes",
    legacy: (report) => report.assertToContain([1, 2], 2, "items"),
    chain: (expect) => expect([1, 2]).referredToAs("items").to.contain(2),
  },
  {
    name: "contain fails",
    legacy: (report) => report.assertToContain([1, 2], 3, "items"),
    chain: (expect) => expect([1, 2]).referredToAs("items").to.contain(3),
  },
  {
    name: "beGreaterThan passes",
    legacy: (report) => report.assertToBeGreaterThan(1, 2, "count"),
    chain: (expect) =>
      expect(2).referredToAs("count").to.beGreaterThan(1),
  },
  {
    name: "beGreaterThan fails",
    legacy: (report) => report.assertToBeGreaterThan(3, 2, "count"),
    chain: (expect) =>
      expect(2).referredToAs("count").to.beGreaterThan(3),
  },
  {
    name: "beGreaterThanOrEqual passes",
    legacy: (report) =>
      report.assertToBeGreaterThanOrEqual(2, 2, "count"),
    chain: (expect) =>
      expect(2).referredToAs("count").to.beGreaterThanOrEqual(2),
  },
  {
    name: "beGreaterThanOrEqual fails",
    legacy: (report) =>
      report.assertToBeGreaterThanOrEqual(3, 2, "count"),
    chain: (expect) =>
      expect(2).referredToAs("count").to.beGreaterThanOrEqual(3),
  },
  {
    name: "beLessThan passes",
    legacy: (report) => report.assertToBeLessThan(3, 2, "count"),
    chain: (expect) => expect(2).referredToAs("count").to.beLessThan(3),
  },
  {
    name: "beLessThan fails",
    legacy: (report) => report.assertToBeLessThan(1, 2, "count"),
    chain: (expect) => expect(2).referredToAs("count").to.beLessThan(1),
  },
  {
    name: "beLessThanOrEqual passes",
    legacy: (report) => report.assertToBeLessThanOrEqual(2, 2, "count"),
    chain: (expect) =>
      expect(2).referredToAs("count").to.beLessThanOrEqual(2),
  },
  {
    name: "beLessThanOrEqual fails",
    legacy: (report) => report.assertToBeLessThanOrEqual(1, 2, "count"),
    chain: (expect) =>
      expect(2).referredToAs("count").to.beLessThanOrEqual(1),
  },
  {
    name: "beDefined passes",
    legacy: (report) => report.assertToBeDefined(0, "value"),
    chain: (expect) => expect(0).referredToAs("value").to.beDefined(),
  },
  {
    name: "beDefined fails",
    legacy: (report) => report.assertToBeDefined(undefined, "value"),
    chain: (expect) =>
      expect(undefined).referredToAs("value").to.beDefined(),
  },
  {
    name: "beTruthy passes",
    legacy: (report) => report.assertToBeTruthy("yes", "value"),
    chain: (expect) => expect("yes").referredToAs("value").to.beTruthy(),
  },
  {
    name: "beTruthy fails",
    legacy: (report) => report.assertToBeTruthy(0, "value"),
    chain: (expect) => expect(0).referredToAs("value").to.beTruthy(),
  },
  {
    name: "not.be passes",
    legacy: (report) => {
      void report.not;
      report.assertToBe(2, 3, "value");
    },
    chain: (expect) => expect(3).referredToAs("value").not.to.be(2),
  },
  {
    name: "not.be fails",
    legacy: (report) => {
      void report.not;
      report.assertToBe(2, 2, "value");
    },
    chain: (expect) => expect(2).referredToAs("value").not.to.be(2),
  },
  {
    name: "not.contain passes",
    legacy: (report) => {
      void report.not;
      report.assertToContain([1, 2], 3, "items");
    },
    chain: (expect) => expect([1, 2]).referredToAs("items").not.to.contain(3),
  },
  {
    name: "not.contain fails",
    legacy: (report) => {
      void report.not;
      report.assertToContain([1, 2], 2, "items");
    },
    chain: (expect) => expect([1, 2]).referredToAs("items").not.to.contain(2),
  },
  {
    name: "not.beDefined passes",
    legacy: (report) => {
      void report.not;
      report.assertToBeDefined(undefined, "value");
    },
    chain: (expect) =>
      expect(undefined).referredToAs("value").not.to.beDefined(),
  },
  {
    name: "not.beTruthy passes",
    legacy: (report) => {
      void report.not;
      report.assertToBeTruthy(0, "value");
    },
    chain: (expect) => expect(0).referredToAs("value").not.to.beTruthy(),
  },
];

/**
 * Exhaustive `.not` parity: negated passing and failing forms of every
 * matcher, so the 24-case matrix above is not the only place negation is
 * exercised.
 */
const NOT_CASES: GoldenCase[] = [
  {
    name: "not.equal passes",
    legacy: (report) => {
      void report.not;
      report.assertToEqual({ a: 1 }, { a: 2 }, "payload");
    },
    chain: (expect) =>
      expect({ a: 2 }).referredToAs("payload").not.to.equal({ a: 1 }),
  },
  {
    name: "not.equal fails",
    legacy: (report) => {
      void report.not;
      report.assertToEqual({ a: 1 }, { a: 1 }, "payload");
    },
    chain: (expect) =>
      expect({ a: 1 }).referredToAs("payload").not.to.equal({ a: 1 }),
  },
  {
    name: "not.beGreaterThan passes",
    legacy: (report) => {
      void report.not;
      report.assertToBeGreaterThan(3, 2, "count");
    },
    chain: (expect) =>
      expect(2).referredToAs("count").not.to.beGreaterThan(3),
  },
  {
    name: "not.beGreaterThan fails",
    legacy: (report) => {
      void report.not;
      report.assertToBeGreaterThan(1, 2, "count");
    },
    chain: (expect) =>
      expect(2).referredToAs("count").not.to.beGreaterThan(1),
  },
  {
    name: "not.beGreaterThanOrEqual passes",
    legacy: (report) => {
      void report.not;
      report.assertToBeGreaterThanOrEqual(3, 2, "count");
    },
    chain: (expect) =>
      expect(2).referredToAs("count").not.to.beGreaterThanOrEqual(3),
  },
  {
    name: "not.beGreaterThanOrEqual fails",
    legacy: (report) => {
      void report.not;
      report.assertToBeGreaterThanOrEqual(2, 2, "count");
    },
    chain: (expect) =>
      expect(2).referredToAs("count").not.to.beGreaterThanOrEqual(2),
  },
  {
    name: "not.beLessThan passes",
    legacy: (report) => {
      void report.not;
      report.assertToBeLessThan(1, 2, "count");
    },
    chain: (expect) => expect(2).referredToAs("count").not.to.beLessThan(1),
  },
  {
    name: "not.beLessThan fails",
    legacy: (report) => {
      void report.not;
      report.assertToBeLessThan(3, 2, "count");
    },
    chain: (expect) => expect(2).referredToAs("count").not.to.beLessThan(3),
  },
  {
    name: "not.beLessThanOrEqual passes",
    legacy: (report) => {
      void report.not;
      report.assertToBeLessThanOrEqual(1, 2, "count");
    },
    chain: (expect) =>
      expect(2).referredToAs("count").not.to.beLessThanOrEqual(1),
  },
  {
    name: "not.beLessThanOrEqual fails",
    legacy: (report) => {
      void report.not;
      report.assertToBeLessThanOrEqual(2, 2, "count");
    },
    chain: (expect) =>
      expect(2).referredToAs("count").not.to.beLessThanOrEqual(2),
  },
];

function installFacade(): ExpectApi {
  const facade = createExpect();
  setReporter({ expect: facade } as never);
  return facade;
}

const ALL_CASES: GoldenCase[] = [...GOLDEN_CASES, ...NOT_CASES];

const FROZEN_BY_NAME = new Map(
  FROZEN_GOLDEN_CASES.map((entry) => [entry.name, entry])
);

function snapshot(instance: {
  getReport(): string;
  getErrors(): string[];
  getStatus(): "Passed" | "Failed";
}): Omit<FrozenGoldenCase, "name"> {
  return {
    report: instance.getReport(),
    errors: instance.getErrors(),
    status: instance.getStatus(),
  };
}

function withoutName(entry: FrozenGoldenCase): Omit<FrozenGoldenCase, "name"> {
  return {
    report: entry.report,
    errors: entry.errors,
    status: entry.status,
  };
}

describe("legacy ReportExpect / expect chain golden messages", () => {
  const originalReporter = getReporter();

  afterEach(() => {
    setReporter(originalReporter);
  });

  it("runs the full 24-case matrix", () => {
    expect(GOLDEN_CASES).toHaveLength(24);
  });

  it("covers every frozen golden case exactly once", () => {
    expect(ALL_CASES).toHaveLength(FROZEN_GOLDEN_CASES.length);
    expect(new Set(ALL_CASES.map((entry) => entry.name)).size).toBe(
      FROZEN_GOLDEN_CASES.length
    );
    for (const entry of ALL_CASES) {
      expect(FROZEN_BY_NAME.has(entry.name)).toBe(true);
    }
  });

  it.each(ALL_CASES.map((golden) => [golden.name, golden] as const))(
    "%s matches the frozen 84bd171 literal messages",
    (_name, golden) => {
      const frozen = FROZEN_BY_NAME.get(golden.name);
      expect(frozen).toBeDefined();

      const legacy = new ReportExpect();
      golden.legacy(legacy);

      installFacade();
      golden.chain(reportedExpect);

      expect(snapshot(legacy)).toEqual(withoutName(frozen!));
      expect(snapshot(reportedExpect)).toEqual(withoutName(frozen!));
    }
  );
});
