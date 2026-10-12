import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { app, safeStorage } from "electron";
import { getAiSettings, normalizeBaseUrl, readModelSettings, saveAiSettings } from "./settings";

test("API URLs reject credentials and non-HTTP schemes", () => {
  assert.equal(normalizeBaseUrl("http://localhost:11434/v1/"), "http://localhost:11434/v1");
  for (const value of ["file:///etc/passwd", "https://user:secret@example.com/v1", "https://example.com/v1?key=secret", "https://example.com/#fragment"]) {
    assert.throws(() => normalizeBaseUrl(value));
  }
});

test("saved API key is encrypted, never returned to UI, preserved on blank form and cleared explicitly", (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ai-settings-test-"));
  t.mock.method(app, "getPath", () => dir);
  t.mock.method(safeStorage, "isEncryptionAvailable", () => true);
  t.mock.method(safeStorage, "getSelectedStorageBackend", () => "gnome_libsecret");
  t.mock.method(safeStorage, "encryptString", (value: string) => Buffer.from(`encrypted:${value}`));
  t.mock.method(safeStorage, "decryptString", (value: Buffer) => value.toString().replace("encrypted:", ""));
  for (const key of ["SKILL_RECORDER_BASE_URL", "OPENAI_BASE_URL", "SKILL_RECORDER_MODEL", "SKILL_RECORDER_API_KEY", "OPENAI_API_KEY"]) {
    const prior = process.env[key]; delete process.env[key];
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = { baseUrl: "https://example.com/v1", model: "test-model" };
  const status = saveAiSettings({ ...input, apiKey: "private-api-key" });
  assert.equal(status.hasApiKey, true);
  assert.equal(JSON.stringify(status).includes("private-api-key"), false);
  assert.equal(readFileSync(path.join(dir, "ai-settings.json"), "utf8").includes("private-api-key"), false);
  saveAiSettings(input); assert.equal(readModelSettings().apiKey, "private-api-key");
  process.env.SKILL_RECORDER_MODEL = "environment-model";
  assert.equal(getAiSettings().model, "environment-model");
  assert.equal(getAiSettings().environmentOverride, true);
  delete process.env.SKILL_RECORDER_MODEL;
  saveAiSettings({ ...input, apiKey: "" }); assert.equal(readModelSettings().apiKey, "");
  t.mock.method(safeStorage, "isEncryptionAvailable", () => false);
  assert.throws(() => saveAiSettings({ ...input, apiKey: "secret" }), /Secure key storage/);
});
