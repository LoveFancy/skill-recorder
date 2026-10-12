import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app, safeStorage } from "electron";
import type { AiSettings, AiSettingsInput } from "../../common/ai";

interface SavedSettings { baseUrl: string; model: string; encryptedKey?: string }
export interface ModelSettings { baseUrl: string; model: string; apiKey: string }

function settingsFile(): string {
  return path.join(app.getPath("userData"), "ai-settings.json");
}

function savedSettings(): SavedSettings {
  if (!existsSync(settingsFile())) return { baseUrl: "https://api.openai.com/v1", model: "" };
  return JSON.parse(readFileSync(settingsFile(), "utf8")) as SavedSettings;
}

export function normalizeBaseUrl(value: string): string {
  const url = new URL(value.trim());
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("API Base URL must be an HTTP(S) URL without credentials, query or fragment.");
  }
  return url.toString().replace(/\/+$/, "");
}

export function readModelSettings(): ModelSettings {
  const saved = savedSettings();
  const envKey = process.env.SKILL_RECORDER_API_KEY ?? process.env.OPENAI_API_KEY;
  const apiKey = envKey ?? (saved.encryptedKey
    ? safeStorage.decryptString(Buffer.from(saved.encryptedKey, "base64")) : "");
  return {
    baseUrl: normalizeBaseUrl(process.env.SKILL_RECORDER_BASE_URL ?? process.env.OPENAI_BASE_URL ?? saved.baseUrl),
    model: (process.env.SKILL_RECORDER_MODEL ?? saved.model).trim(),
    apiKey,
  };
}

export function getAiSettings(): AiSettings {
  const settings = readModelSettings();
  return { baseUrl: settings.baseUrl, model: settings.model, hasApiKey: Boolean(settings.apiKey),
    configured: Boolean(settings.model),
    environmentOverride: ["SKILL_RECORDER_BASE_URL", "OPENAI_BASE_URL", "SKILL_RECORDER_MODEL", "SKILL_RECORDER_API_KEY", "OPENAI_API_KEY"]
      .some((key) => process.env[key] !== undefined),
  };
}

export function saveAiSettings(input: AiSettingsInput): AiSettings {
  if (!input || typeof input.baseUrl !== "string" || typeof input.model !== "string" ||
      (input.apiKey !== undefined && typeof input.apiKey !== "string")) throw new Error("Invalid model settings.");
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const model = input.model.trim();
  if (!model) throw new Error("Enter a model name.");
  const saved = savedSettings();
  let encryptedKey = saved.encryptedKey;
  if (input.apiKey !== undefined) {
    if (input.apiKey) {
      if (!safeStorage.isEncryptionAvailable() ||
          (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text")) {
        throw new Error("Secure key storage is unavailable. Set SKILL_RECORDER_API_KEY in the environment instead.");
      }
      encryptedKey = safeStorage.encryptString(input.apiKey).toString("base64");
    } else encryptedKey = undefined;
  }
  mkdirSync(path.dirname(settingsFile()), { recursive: true });
  writeFileSync(settingsFile(), JSON.stringify({ baseUrl, model, encryptedKey }), { mode: 0o600 });
  return getAiSettings();
}
