import { app } from "electron";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  ProcessingSettingsSchema,
  type ProcessingSettings,
} from "../../common/agents";
import { atomicJson } from "../enrichment/store";
export const processingDirectory = () =>
  process.env.SKILL_RECORDER_PROCESSING_DIR ??
  path.join(app.getPath("userData"), "processing");
export function readProcessingSettings(): ProcessingSettings {
  const file = path.join(processingDirectory(), "settings.json");
  const settings = existsSync(file)
    ? ProcessingSettingsSchema.parse(JSON.parse(readFileSync(file, "utf8")))
    : ProcessingSettingsSchema.parse({
        version: 1,
        backendPreference: "auto",
        defaultProcessingWorkspaceId: null,
        workspaces: [],
      });
  const override = process.env.SKILL_RECORDER_PROCESSING_BACKEND;
  if (override === "api" || override === "local-agent" || override === "auto")
    settings.backendPreference = override;
  return settings;
}
export function saveProcessingSettings(value: unknown): ProcessingSettings {
  const settings = ProcessingSettingsSchema.parse(value);
  atomicJson(path.join(processingDirectory(), "settings.json"), settings);
  return settings;
}
