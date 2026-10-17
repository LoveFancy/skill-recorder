import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { exportDocumentFiles } from "./export";
const require = createRequire(import.meta.url);

test("Markdown and screenshot ZIP exports contain only the requested document and relative assets", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "document-export-"));
  try {
    const md = path.join(root, "sop.md");
    await exportDocumentFiles(md, "# 操作说明", []);
    assert.equal(readFileSync(md, "utf8"), "# 操作说明");
    const asset = { name: `assets/${"a".repeat(64)}.jpg`, bytes: Buffer.from("protected image") };
    const target = path.join(root, "manual.zip");
    await exportDocumentFiles(target, `![截图](${asset.name})`, [asset]);
    const Zip = require("adm-zip");
    const zip = new Zip(target);
    assert.deepEqual(zip.getEntries().map((entry: { entryName: string }) => entry.entryName).sort(), [asset.name, "document.md"].sort());
    assert.deepEqual(zip.readFile(asset.name), asset.bytes);
    assert.equal(zip.readAsText("document.md"), `![截图](${asset.name})`);
    assert.equal(readdirSync(root).some(name => name.endsWith(".tmp")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("invalid asset paths cannot overwrite an existing export or create traversal files", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "document-export-"));
  try {
    const target = path.join(root, "sop.md"); writeFileSync(target, "existing approved export");
    await assert.rejects(exportDocumentFiles(target, "bad", [{ name: "../outside", bytes: Buffer.from("bad") }]), /无效/);
    assert.equal(readFileSync(target, "utf8"), "existing approved export");
    assert.deepEqual(readdirSync(root), ["sop.md"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
