import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EVIDENCE_ALLOWED_EXTENSIONS,
  EVIDENCE_MAX_FILE_BYTES,
  EVIDENCE_MAX_TOTAL_BYTES,
  buildAssetBuckets,
  collectEvidenceFromDir,
  createEvidenceFromFile,
  type EvidenceAttachment,
} from "../../src/testImporter";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

function writeFile(
  root: string,
  relativePath: string,
  content: string | Buffer
): string {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return filePath;
}

function writeSparseFile(
  root: string,
  relativePath: string,
  size: number
): string {
  const filePath = writeFile(root, relativePath, "");
  fs.truncateSync(filePath, size);
  return filePath;
}

function attachmentNames(evidence: EvidenceAttachment[]): string[] {
  return evidence.map((attachment) => attachment.filename).sort();
}

function decodedContents(evidence: EvidenceAttachment[]): string {
  return evidence
    .map((attachment) =>
      Buffer.from(attachment.data, "base64").toString("utf8")
    )
    .join("\n");
}

describe("evidence collector upload hardening (S1)", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    while (tempDirs.length) {
      fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true });
    }
  });

  function warnings(): string[] {
    return warnSpy.mock.calls.map((call) => String(call[0]));
  }

  function expectContentAbsent(evidence: EvidenceAttachment[], secret: string) {
    const decoded = decodedContents(evidence);
    expect(decoded).not.toContain(secret);
    expect(JSON.stringify(evidence)).not.toContain(
      Buffer.from(secret).toString("base64")
    );
  }

  it("attaches allowlisted files from a PTP evidence tree", () => {
    const root = makeTempDir("decaf-evidence-allow-");
    const ptp = path.join(root, "PTP-1");
    writeFile(ptp, "screenshot.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFile(ptp, "result.json", JSON.stringify({ status: "passed" }));
    writeFile(ptp, "notes.txt", "step notes");

    const evidence = collectEvidenceFromDir(ptp);

    expect(attachmentNames(evidence)).toEqual([
      "notes.txt",
      "result.json",
      "screenshot.png",
    ]);
    expect(
      evidence.find((attachment) => attachment.filename === "screenshot.png")
        ?.contentType
    ).toBe("image/png");
    expect(
      evidence.find((attachment) => attachment.filename === "result.json")
        ?.contentType
    ).toBe("application/json");
    expect(
      evidence.find((attachment) => attachment.filename === "notes.txt")
        ?.contentType
    ).toBe("text/plain");
    expect(EVIDENCE_ALLOWED_EXTENSIONS).toContain(".png");
    expect(EVIDENCE_ALLOWED_EXTENSIONS).toContain(".json");
    expect(EVIDENCE_ALLOWED_EXTENSIONS).not.toContain(".bin");
  });

  it("skips dotfiles, dot-directories and their contents", () => {
    const root = makeTempDir("decaf-evidence-dot-");
    const ptp = path.join(root, "PTP-2");
    writeFile(ptp, "evidence.json", "{}");
    const envSecret = "DECAF_EVIDENCE_DOTFILE_SECRET=must-not-leak";
    const npmSecret = "//registry.example/:_authToken=must-not-leak";
    const tokenSecret = "DOTDIR_TOKEN=must-not-leak";
    writeFile(ptp, ".env", envSecret);
    writeFile(ptp, ".npmrc", npmSecret);
    writeFile(ptp, ".secrets/token.txt", tokenSecret);

    const evidence = collectEvidenceFromDir(ptp);

    expect(attachmentNames(evidence)).toEqual(["evidence.json"]);
    expectContentAbsent(evidence, envSecret);
    expectContentAbsent(evidence, npmSecret);
    expectContentAbsent(evidence, tokenSecret);
  });

  it("skips unknown and absent extensions with a warning", () => {
    const root = makeTempDir("decaf-evidence-extension-");
    const ptp = path.join(root, "PTP-3");
    writeFile(ptp, "report.json", "{}");
    const binaryPath = writeFile(ptp, "payload.bin", Buffer.from([1, 2, 3]));
    const extensionlessPath = writeFile(ptp, "LICENSE", "no extension here");

    const evidence = collectEvidenceFromDir(ptp);
    const messages = warnings();

    expect(attachmentNames(evidence)).toEqual(["report.json"]);
    expect(
      messages.some(
        (message) =>
          message.includes(binaryPath) && /not allowlisted/.test(message)
      )
    ).toBe(true);
    expect(
      messages.some(
        (message) =>
          message.includes(extensionlessPath) &&
          /not allowlisted/.test(message) &&
          /\(none\)/.test(message)
      )
    ).toBe(true);
  });

  it("warns when a dotfile or dot-directory is skipped", () => {
    const root = makeTempDir("decaf-evidence-dot-warning-");
    const ptp = path.join(root, "PTP-4");
    writeFile(ptp, "report.json", "{}");
    const envPath = writeFile(ptp, ".env", "SECRET=1");
    const tokenPath = writeFile(ptp, ".secrets/token.txt", "SECRET=2");

    collectEvidenceFromDir(ptp);
    const messages = warnings();

    expect(
      messages.some(
        (message) => /dotfile/i.test(message) && message.includes(envPath)
      )
    ).toBe(true);
    expect(
      messages.some(
        (message) => /dotfile/i.test(message) && message.includes(tokenPath)
      )
    ).toBe(true);
  });

  it("skips an oversized file without reading it and warns", () => {
    const root = makeTempDir("decaf-evidence-oversized-");
    const ptp = path.join(root, "PTP-5");
    writeFile(ptp, "report.json", "{}");
    const oversizedPath = writeSparseFile(
      ptp,
      "huge.png",
      EVIDENCE_MAX_FILE_BYTES + 1
    );
    const readSpy = jest.spyOn(fs, "readFileSync");

    try {
      const evidence = collectEvidenceFromDir(ptp);

      expect(attachmentNames(evidence)).toEqual(["report.json"]);
      expect(
        warnings().some(
          (message) =>
            message.includes(oversizedPath) && /per-file limit/.test(message)
        )
      ).toBe(true);
      expect(
        readSpy.mock.calls.some((call) => String(call[0]) === oversizedPath)
      ).toBe(false);
    } finally {
      readSpy.mockRestore();
    }
  });

  it("enforces the per-run total cap without reading the overflow and warns once", () => {
    const root = makeTempDir("decaf-evidence-total-");
    const ptp = path.join(root, "PTP-6");
    for (let index = 1; index <= 5; index++) {
      writeSparseFile(ptp, `cap-${index}.txt`, EVIDENCE_MAX_FILE_BYTES);
    }
    const overflowOne = writeFile(ptp, "overflow-1.txt", "overflow one");
    const overflowTwo = writeFile(ptp, "overflow-2.txt", "overflow two");
    const readSpy = jest.spyOn(fs, "readFileSync");

    try {
      const evidence = collectEvidenceFromDir(ptp);
      const messages = warnings();

      expect(attachmentNames(evidence)).toEqual([
        "cap-1.txt",
        "cap-2.txt",
        "cap-3.txt",
        "cap-4.txt",
        "cap-5.txt",
      ]);
      expect(
        messages.filter((message) => /per-run limit/.test(message))
      ).toHaveLength(1);
      expect(
        readSpy.mock.calls.some((call) =>
          [overflowOne, overflowTwo].includes(String(call[0]))
        )
      ).toBe(false);
      expect(EVIDENCE_MAX_TOTAL_BYTES).toBe(
        EVIDENCE_MAX_FILE_BYTES * 5
      );
    } finally {
      readSpy.mockRestore();
    }
  });

  it("createEvidenceFromFile fails closed on an oversized file", () => {
    const root = makeTempDir("decaf-evidence-create-");
    const oversizedPath = writeSparseFile(
      root,
      "huge.txt",
      EVIDENCE_MAX_FILE_BYTES + 1
    );
    const readSpy = jest.spyOn(fs, "readFileSync");

    try {
      expect(() => createEvidenceFromFile(oversizedPath)).toThrow(
        /exceeding the \d+-byte per-file limit/
      );
      expect(
        readSpy.mock.calls.some((call) => String(call[0]) === oversizedPath)
      ).toBe(false);
    } finally {
      readSpy.mockRestore();
    }
  });

  it("buildAssetBuckets never exposes skipped files in the returned bucket", () => {
    const root = makeTempDir("decaf-evidence-buckets-");
    const ptp = path.join(root, "PTP-7");
    writeFile(ptp, "screenshot.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const dotSecret = "BUCKET_DOTFILE_SECRET=must-not-leak";
    writeFile(ptp, ".env", dotSecret);
    writeFile(ptp, ".secrets/token.txt", "BUCKET_DOTDIR_SECRET=must-not-leak");
    writeFile(ptp, "payload.bin", "BUCKET_BINARY_SECRET=must-not-leak");
    writeFile(ptp, "LICENSE", "BUCKET_EXTENSIONLESS_SECRET=must-not-leak");
    writeSparseFile(ptp, "huge.png", EVIDENCE_MAX_FILE_BYTES + 1);

    const buckets = buildAssetBuckets(root);
    const bucket = buckets.get("PTP-7");

    expect(bucket).toBeDefined();
    const attachments = [
      ...(bucket?.general || []),
      ...Array.from(bucket?.steps.values() || []).flat(),
      ...Array.from(bucket?.preconditions.values() || []).flat(),
    ];
    expect(attachmentNames(attachments)).toEqual(["screenshot.png"]);
    expect(decodedContents(attachments)).not.toContain(dotSecret);
    expect(decodedContents(attachments)).not.toContain(
      "BUCKET_DOTDIR_SECRET"
    );
    expect(decodedContents(attachments)).not.toContain("BUCKET_BINARY_SECRET");
    expect(decodedContents(attachments)).not.toContain(
      "BUCKET_EXTENSIONLESS_SECRET"
    );
    expect(bucket?.steps.size).toBe(0);
    expect(bucket?.preconditions.size).toBe(0);
  });
});
