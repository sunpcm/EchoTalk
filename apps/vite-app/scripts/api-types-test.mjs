import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_OUTPUT_PATH,
  DEFAULT_SCHEMA_PATH,
  assertLocalReferences,
  generateApiTypes,
  loadSchema,
  renderApiTypes,
} from "./generate-api-types.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const viteAppRoot = path.resolve(__dirname, "..");
const generatorScript = path.join(__dirname, "generate-api-types.mjs");

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "echotalk-api-types-"));
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

describe("OpenAPI TypeScript generation", () => {
  it("renders the tracked schema deterministically without calling fetch", async (t) => {
    const directory = temporaryDirectory(t);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () => {
      throw new Error("network access is forbidden");
    };
    try {
      const first = await renderApiTypes({
        schemaPath: DEFAULT_SCHEMA_PATH,
        outputPath: path.join(directory, "first.ts"),
      });
      const second = await renderApiTypes({
        schemaPath: DEFAULT_SCHEMA_PATH,
        outputPath: path.join(directory, "second.ts"),
      });
      assert.equal(first, second);
      assert.match(first, /export interface components/);
      assert.match(first, /SessionListResponse/);
      assert.doesNotMatch(first, /\bfetch\s*\(/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects remote and out-of-bounds references before generation", async (t) => {
    const directory = temporaryDirectory(t);
    const schema = await loadSchema(DEFAULT_SCHEMA_PATH);

    const remoteSchema = structuredClone(schema);
    remoteSchema.components.schemas.RemoteRef = {
      $ref: "https://example.invalid/schema.json",
    };
    assert.throws(() => assertLocalReferences(remoteSchema), /Remote or unsupported \$ref/);

    const missingSchema = structuredClone(schema);
    missingSchema.components.schemas.MissingRef = {
      $ref: "#/components/schemas/DoesNotExist",
    };
    assert.throws(() => assertLocalReferences(missingSchema), /Out-of-bounds local \$ref/);

    const invalidSchemaPath = path.join(directory, "remote.json");
    fs.writeFileSync(invalidSchemaPath, JSON.stringify(remoteSchema), "utf8");
    await assert.rejects(
      renderApiTypes({
        schemaPath: invalidSchemaPath,
        outputPath: path.join(directory, "remote.ts"),
      }),
      /Remote or unsupported \$ref/,
    );
  });

  it("--check rejects stale and missing outputs without writing", async (t) => {
    const directory = temporaryDirectory(t);
    const staleOutput = path.join(directory, "stale.ts");
    fs.writeFileSync(staleOutput, "stale\n", "utf8");

    await assert.rejects(
      generateApiTypes({
        check: true,
        outputPath: staleOutput,
      }),
      /Generated API types are stale/,
    );
    assert.equal(fs.readFileSync(staleOutput, "utf8"), "stale\n");

    const missingOutput = path.join(directory, "missing.ts");
    await assert.rejects(
      generateApiTypes({
        check: true,
        outputPath: missingOutput,
      }),
      /Generated API types are missing/,
    );
    assert.equal(fs.existsSync(missingOutput), false);
  });

  it("stale --check exits nonzero through the real CLI without writing", (t) => {
    const directory = temporaryDirectory(t);
    const staleOutput = path.join(directory, "stale.ts");
    fs.writeFileSync(staleOutput, "stale\n", "utf8");
    const result = spawnSync(
      process.execPath,
      [generatorScript, "--check", "--output", staleOutput],
      {
        cwd: viteAppRoot,
        encoding: "utf8",
      },
    );

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /API types are stale/);
    assert.equal(fs.readFileSync(staleOutput, "utf8"), "stale\n");
  });

  it("real CLI succeeds for the tracked generated artifact", () => {
    const result = spawnSync(process.execPath, [generatorScript, "--check"], {
      cwd: viteAppRoot,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /API types are current/);
  });

  it("fails closed when the output cannot be written", async (t) => {
    const directory = temporaryDirectory(t);
    const missingParent = path.join(directory, "missing-parent", "api.ts");
    await assert.rejects(
      generateApiTypes({
        outputPath: missingParent,
      }),
      /Cannot write generated API types/,
    );
    assert.equal(fs.existsSync(missingParent), false);
  });

  it("output failures exit nonzero through the real CLI", (t) => {
    const directory = temporaryDirectory(t);
    const missingParent = path.join(directory, "missing-parent", "api.ts");
    const result = spawnSync(process.execPath, [generatorScript, "--output", missingParent], {
      cwd: viteAppRoot,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Cannot write generated API types/);
    assert.equal(fs.existsSync(missingParent), false);
  });

  it("uses the canonical tracked output by default", () => {
    assert.equal(DEFAULT_OUTPUT_PATH, path.join(viteAppRoot, "src", "lib", "api.generated.ts"));
  });
});
