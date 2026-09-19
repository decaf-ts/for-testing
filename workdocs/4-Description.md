### Description

`@decaf-ts/for-testing` is the testing toolkit for decaf-ts packages. It packages the
evidence and reporting pipeline that used to live under `@decaf-ts/utils/tests` into its own
repository so runtime packages no longer carry test-only code.

The backend toolkit is the default export of the package root:

- `TestReporter` — collects test evidence (messages, objects, tables, attachments) into a
  report storage directory (defaults via `TEST_REPORTER_STORAGE_ENABLED` /
  `TEST_REPORTER_STORAGE_PATH`).
- `ConsumerRunner` — consumer/producer orchestration: forks the producer child process,
  collects consumer and producer logs, and compares them (through `defaultComparer` or
  `reportingComparer`) to assert ordering and interleaving across forked processes.
- jest helpers (`itReportsOnFailure`, `ReportExpect`) — report failures and evidence directly
  from jest tests, backed by the reporter plumbing (`ensureReporterCollectsEvidencesConfig`,
  `setReporter` / `getReporter`, `reportObjects`) and `runAndReport` for command-execution
  evidence.
- `JestPerformanceRunner` — runs performance scenarios and reports phase tables and charts.
- `runJestXrayTeardown` / `runJestAgileTestTeardown` — convert the JUnit report and evidence
  directories into Xray and AgileTest import payloads; the Xray teardown is gated by
  `ENABLE_XRAY_REPORT`, the AgileTest payload is always written locally, and uploads only
  happen when the respective credentials are configured.

UI-specific helpers are grouped under the `ui` namespace, exported both as the `ui` named
export of the package root and as the `@decaf-ts/for-testing/ui` subpath. No UI helpers exist
yet, so that surface is intentionally minimal but stable for future browser and component helpers.

```typescript
// backend toolkit (default)
import { TestReporter, itReportsOnFailure } from "@decaf-ts/for-testing";

// UI toolkit (named namespace)
import { ui } from "@decaf-ts/for-testing";
import * as ui from "@decaf-ts/for-testing/ui";
```

#### Migrating from `@decaf-ts/utils/tests`

`@decaf-ts/utils/tests` remains published and unchanged, so nothing forces an immediate
migration. When you are ready:

1. Install the new package (`npm install --save-dev @decaf-ts/for-testing`) and rewrite the
   imports: `@decaf-ts/utils/tests` → `@decaf-ts/for-testing`. The backend export surface
   (`TestReporter`, the jest helpers, `ConsumerRunner`-based orchestration, the performance
   runner and the teardowns) is unchanged — only the import path moved.
2. Optionally adopt the new surfaces this package adds: the `ui` namespace and
   `@decaf-ts/for-testing/ui` subpath (reserved, currently empty but stable), and the
   `VERSION` / `COMMIT` / `FULL_VERSION` / `PACKAGE_NAME` build constants.
