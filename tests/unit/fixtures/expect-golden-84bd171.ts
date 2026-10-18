/**
 * Frozen golden corpus for the reported-assertion messages.
 *
 * Captured by running the pre-refactor `ReportExpect` class from
 * `src/jest.ts` at commit `84bd171` (the last commit before the
 * `ExpectationCore` extraction) against the 34-case parity matrix. The values
 * below are literal copies of that run's output, not the output of the current
 * implementation, so a shared message change inside `ExpectationCore` can no
 * longer keep the legacy and chain skins in self-agreement while drifting from
 * the historical messages.
 *
 * Regenerate only by checking out `84bd171`, running the same case matrix, and
 * pasting the output here; never by copying values produced by current code.
 */
export interface FrozenGoldenCase {
  name: string;
  report: string;
  errors: string[];
  status: "Passed" | "Failed";
}

export const FROZEN_GOLDEN_CASES: FrozenGoldenCase[] = [
  {
    name: "be passes",
    report: "Expected value to be 2 and received 2",
    errors: [],
    status: "Passed",
  },
  {
    name: "be fails",
    report: "Expected value to be 2 and received 3",
    errors: ["Expected value to be 2 and received 3"],
    status: "Failed",
  },
  {
    name: "equal passes",
    report:
      'Expected payload to equal {\n  "a": 1\n} and received {\n  "a": 1\n}',
    errors: [],
    status: "Passed",
  },
  {
    name: "equal fails",
    report:
      'Expected payload to equal {\n  "a": 1\n} and received {\n  "a": 2\n}',
    errors: [
      'Expected payload to equal {\n  "a": 1\n} and received {\n  "a": 2\n}',
    ],
    status: "Failed",
  },
  {
    name: "contain passes",
    report: "Expected items: 1,2 to contain 2",
    errors: [],
    status: "Passed",
  },
  {
    name: "contain fails",
    report: "Expected items: 1,2 to contain 3",
    errors: ["Expected items: 1,2 to contain 3"],
    status: "Failed",
  },
  {
    name: "beGreaterThan passes",
    report: "Expected count to be greater than 1 and received 2",
    errors: [],
    status: "Passed",
  },
  {
    name: "beGreaterThan fails",
    report: "Expected count to be greater than 3 and received 2",
    errors: ["Expected count to be greater than 3 and received 2"],
    status: "Failed",
  },
  {
    name: "beGreaterThanOrEqual passes",
    report: "Expected count to be greater than or equal 2 and received 2",
    errors: [],
    status: "Passed",
  },
  {
    name: "beGreaterThanOrEqual fails",
    report: "Expected count to be greater than or equal 3 and received 2",
    errors: ["Expected count to be greater than or equal 3 and received 2"],
    status: "Failed",
  },
  {
    name: "beLessThan passes",
    report: "Expected count to be less than 3 and received 2",
    errors: [],
    status: "Passed",
  },
  {
    name: "beLessThan fails",
    report: "Expected count to be less than 1 and received 2",
    errors: ["Expected count to be less than 1 and received 2"],
    status: "Failed",
  },
  {
    name: "beLessThanOrEqual passes",
    report: "Expected count to be less than or equal 2 and received 2",
    errors: [],
    status: "Passed",
  },
  {
    name: "beLessThanOrEqual fails",
    report: "Expected count to be less than or equal 1 and received 2",
    errors: ["Expected count to be less than or equal 1 and received 2"],
    status: "Failed",
  },
  {
    name: "beDefined passes",
    report: "Expected value to be defined and received 0",
    errors: [],
    status: "Passed",
  },
  {
    name: "beDefined fails",
    report: "Expected value to be defined and received undefined",
    errors: ["Expected value to be defined and received undefined"],
    status: "Failed",
  },
  {
    name: "beTruthy passes",
    report: "Expected value to be truthy and received yes",
    errors: [],
    status: "Passed",
  },
  {
    name: "beTruthy fails",
    report: "Expected value to be truthy and received 0",
    errors: ["Expected value to be truthy and received 0"],
    status: "Failed",
  },
  {
    name: "not.be passes",
    report: "Expected value not to be 2 and received 3",
    errors: [],
    status: "Passed",
  },
  {
    name: "not.be fails",
    report: "Expected value not to be 2 and received 2",
    errors: ["Expected value not to be 2 and received 2"],
    status: "Failed",
  },
  {
    name: "not.contain passes",
    report: "Expected items: 1,2 not to contain 3",
    errors: [],
    status: "Passed",
  },
  {
    name: "not.contain fails",
    report: "Expected items: 1,2 not to contain 2",
    errors: ["Expected items: 1,2 not to contain 2"],
    status: "Failed",
  },
  {
    name: "not.beDefined passes",
    report: "Expected value not to be defined and received undefined",
    errors: [],
    status: "Passed",
  },
  {
    name: "not.beTruthy passes",
    report: "Expected value not to be truthy and received 0",
    errors: [],
    status: "Passed",
  },
  {
    name: "not.equal passes",
    report:
      'Expected payload not to equal {\n  "a": 1\n} and received {\n  "a": 2\n}',
    errors: [],
    status: "Passed",
  },
  {
    name: "not.equal fails",
    report:
      'Expected payload not to equal {\n  "a": 1\n} and received {\n  "a": 1\n}',
    errors: [
      'Expected payload not to equal {\n  "a": 1\n} and received {\n  "a": 1\n}',
    ],
    status: "Failed",
  },
  {
    name: "not.beGreaterThan passes",
    report: "Expected count not to be greater than 3 and received 2",
    errors: [],
    status: "Passed",
  },
  {
    name: "not.beGreaterThan fails",
    report: "Expected count not to be greater than 1 and received 2",
    errors: ["Expected count not to be greater than 1 and received 2"],
    status: "Failed",
  },
  {
    name: "not.beGreaterThanOrEqual passes",
    report: "Expected count not to be greater than or equal 3 and received 2",
    errors: [],
    status: "Passed",
  },
  {
    name: "not.beGreaterThanOrEqual fails",
    report: "Expected count not to be greater than or equal 2 and received 2",
    errors: ["Expected count not to be greater than or equal 2 and received 2"],
    status: "Failed",
  },
  {
    name: "not.beLessThan passes",
    report: "Expected count not to be less than 1 and received 2",
    errors: [],
    status: "Passed",
  },
  {
    name: "not.beLessThan fails",
    report: "Expected count not to be less than 3 and received 2",
    errors: ["Expected count not to be less than 3 and received 2"],
    status: "Failed",
  },
  {
    name: "not.beLessThanOrEqual passes",
    report: "Expected count not to be less than or equal 1 and received 2",
    errors: [],
    status: "Passed",
  },
  {
    name: "not.beLessThanOrEqual fails",
    report: "Expected count not to be less than or equal 2 and received 2",
    errors: ["Expected count not to be less than or equal 2 and received 2"],
    status: "Failed",
  },
];
