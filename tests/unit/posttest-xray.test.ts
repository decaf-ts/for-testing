import { syncPreconditionsToXray } from "../../src/posttest/xray";
import type { ParsedTestCase } from "../../src/testImporter";

const response = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => JSON.stringify({ data: body }),
  }) as Response;

describe("Xray precondition synchronization", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("links preconditions that are not already associated with the test", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        response({
          getPreconditions: {
            results: [
              {
                issueId: "precondition-issue-1",
                jira: { key: "PRECONDITION-001" },
              },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        response({
          getTests: {
            results: [
              { issueId: "test-issue-1", preconditions: { results: [] } },
            ],
          },
        })
      )
      .mockResolvedValueOnce(
        response({
          addPreconditionsToTest: {
            addedPreconditions: ["precondition-issue-1"],
          },
        })
      );
    globalThis.fetch = fetchMock as typeof fetch;
    jest.spyOn(console, "log").mockImplementation(() => undefined);

    const tests = [
      {
        testKey: "PTP-123",
        preconditions: [{ key: "PRECONDITION-001", status: "PASSED" }],
      },
    ] as ParsedTestCase[];

    await syncPreconditionsToXray(tests, "xray-token");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const mutationRequest = JSON.parse(
      fetchMock.mock.calls[2][1].body as string
    );
    expect(mutationRequest.query).toContain("addPreconditionsToTest");
    expect(mutationRequest.variables).toEqual({
      issueId: "test-issue-1",
      preconditionIssueIds: ["precondition-issue-1"],
    });
  });
});
