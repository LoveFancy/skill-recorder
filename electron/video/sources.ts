import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pickRecordingSource } from "./source-picker";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { app, BrowserWindow, desktopCapturer, screen } from "electron";

import type {
  ScreenSettingsResult,
  ScreenSettingsStatus,
  StartOptions,
} from "../../common/ipc";
import {
  applyDisplayLabels,
  resolveScreenPreference,
  screenPreference,
  type ScreenPreference,
  type ScreenSource,
} from "../../common/screen";
import { createLogger } from "../logger";

const log = createLogger("Screen sources");
const PREFERENCES_FILE = "screen-preferences.json";

interface StoredPreferences {
  screen: ScreenPreference | null;
}

export class ScreenSourceService {
  private preferencesLoaded = false;
  private preferencesFile = "";
  private preferenceWrites: Promise<void> = Promise.resolve();
  private operation: Promise<void> = Promise.resolve();
  private preference: ScreenPreference | null = null;
  private sources: ScreenSource[] = [];
  private settingsError: string | null = null;

  constructor(
    private readonly onSettingsChanged: (
      status: ScreenSettingsStatus,
    ) => void = () => undefined,
  ) {}

  initialize(): Promise<void> {
    return this.run(async () => {
      await this.loadPreferences();
      await this.refreshSources();
    });
  }

  refresh(): Promise<ScreenSettingsStatus> {
    return this.run(async () => {
      await this.loadPreferences();
      await this.refreshSources();
      return this.settings();
    });
  }

  selectSource(sourceId: string): Promise<ScreenSettingsResult> {
    return this.run(async () => {
      await this.loadPreferences();
      await this.refreshSources(false);
      return this.commitSource(sourceId);
    });
  }

  pickSource(): Promise<ScreenSettingsResult> {
    return this.run(async () => {
      await this.loadPreferences();
      await this.refreshSources(false);
      const id = await pickRecordingSource(this.sources, this.settings().selectedSourceId);
      if (!id) { this.emitSettings(); return { ok:true,status:this.settings() }; }
      await this.refreshSources(false);
      return this.commitSource(id);
    });
  }

  private async commitSource(sourceId: string): Promise<ScreenSettingsResult> {
    const source = this.sources.find(candidate => candidate.id === sourceId);
    if (!source) return this.settingsFailure(new Error("目标已关闭"), "录制来源不可用");
    const previous = this.preference;
    this.preference = screenPreference(source);
    this.settingsError = null;
    try { await this.persistPreferences(); }
    catch (error) { this.preference = previous; return this.settingsFailure(error, "无法保存录制来源"); }
    this.emitSettings();
    return { ok:true,status:this.settings() };
  }

  async annotationBounds(sourceId: string, displayId: string, activate = false) {
    if (!sourceId.startsWith("window:")) {
      const display = screen.getAllDisplays().find(d => String(d.id) === displayId);
      if (!display) throw new Error("录制屏幕已断开，请重新选择");
      return display.bounds;
    }
    const id = Number(sourceId.split(":")[1]);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error("无效的应用窗口");
    let bounds;
    if (process.platform === "win32") {
      const { readWindowsWindowBounds } = await import("../collectors/windows-active-window");
      const physical = readWindowsWindowBounds(id, activate);
      if (physical) bounds = screen.screenToDipRect(null, physical);
    } else {
      const packageName = "get-windows";
      const { openWindows } = await import(packageName) as typeof import("get-windows");
      let windows = await openWindows({accessibilityPermission:false,screenRecordingPermission:false});
      let target = windows.find(w => w.id === id);
      if (activate && target && process.platform === "darwin") {
        await promisify(execFile)("osascript", ["-l", "JavaScript", "-e", 'ObjC.import("AppKit"); function run(argv) { const target = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0])); if (target.isNil()) throw new Error("应用已关闭"); target.activateWithOptions(3); }', String(target.owner.processId)], {timeout:2000});
        await new Promise(r => setTimeout(r,80));
        windows = await openWindows({accessibilityPermission:false,screenRecordingPermission:false});
        target = windows.find(w => w.id === id);

      }
      const front = windows.find(w => w.owner.processId !== process.pid);
      if (target && front && front.id !== id) throw new Error("请先将所选录制窗口切到最前面，再使用截图或标注工具");
      bounds = target?.bounds;
    }
    if (!bounds || bounds.width < 16 || bounds.height < 16) throw new Error("应用窗口已关闭或最小化，请恢复后重试");
    return {x:Math.round(bounds.x),y:Math.round(bounds.y),width:Math.round(bounds.width),height:Math.round(bounds.height)};
  }

  async windowPreview(sourceId: string) {
    const sources = await desktopCapturer.getSources({ types: [sourceId.startsWith("window:") ? "window" : "screen"], thumbnailSize: { width:1920,height:1080 } });
    const source = sources.find(s => s.id === sourceId);
    if (!source || source.thumbnail.isEmpty()) throw new Error("应用窗口已关闭或无法获取预览");
    return { dataUrl: source.thumbnail.toDataURL(), ...source.thumbnail.getSize() };
  }

  startOptions(): Promise<StartOptions> {
    return this.run(async () => {
      await this.loadPreferences();
      await this.refreshSources();
      const source = resolveScreenPreference(this.preference, this.sources).source;
      if (this.preference?.id.startsWith("window:") && resolveScreenPreference(this.preference, this.sources).unavailable) throw new Error("所选应用窗口已关闭，请重新选择录制内容");
      return source
        ? {
            screenSourceId: source.id,
            screenDisplayId: source.displayId || undefined,
          }
        : {};
    });
  }

  settings(): ScreenSettingsStatus {
    const resolved = resolveScreenPreference(this.preference, this.sources);
    const preferredLabel =
      this.preference?.label || resolved.source?.label || "所选录制来源";
    return {
      screens: this.sources.map((source) => ({ ...source })),
      preferredSourceId: this.preference?.id ?? resolved.source?.id ?? "",
      preferredSourceLabel: preferredLabel,
      selectedSourceId: resolved.source?.id ?? "",
      selectedSourceLabel: resolved.source?.label ?? "没有可用录制来源",
      preferredSourceUnavailable: this.preference != null && resolved.unavailable,
      fallback:
        this.preference && resolved.unavailable && resolved.source
          ? `${preferredLabel} 不可用，请重新选择录制来源。`
          : null,
      error: this.settingsError,
    };
  }

  whenSettingsSettled(): Promise<void> {
    return this.operation;
  }

  private async refreshSources(emit = true): Promise<void> {
    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 480, height: 300 },
        fetchWindowIcons: true,
      });
      const displayLabels = new Map(
        screen.getAllDisplays().map((display) => [
          String(display.id),
          display.label,
        ]),
      );
      const ownWindows = new Set(BrowserWindow.getAllWindows().map(win => win.getMediaSourceId()));
      this.sources = applyDisplayLabels(sources.filter(source => !ownWindows.has(source.id)).map((source) => ({
        id: source.id,
        label: source.name,
        displayId: source.display_id,
        appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : undefined,
        thumbnail: source.thumbnail.isEmpty() ? undefined : source.thumbnail.toDataURL(),
      })).sort((a,b) => Number(a.id.startsWith("window:"))-Number(b.id.startsWith("window:"))), displayLabels);
      this.settingsError =
        this.sources.length === 0 ? "没有可用的屏幕或应用窗口。" : null;

      // Window source identities are trusted only in the current process. Titles may change.
      if (this.preference?.id.startsWith("window:")) {
        const current = this.sources.find(source => source.id === this.preference!.id);
        if (current) this.preference = screenPreference(current);
      }
      const resolved = resolveScreenPreference(this.preference, this.sources);
      if (resolved.changed) {
        this.preference = resolved.preference;
        try {
          await this.persistPreferences();
        } catch (error) {
          this.settingsError =
            `Could not save the restored screen selection: ${errorMessage(error)}`;
        }
      }
    } catch (error) {
      this.sources = [];
      this.settingsError = `无法列出录制来源：${errorMessage(error)}`;
      log.warn(this.settingsError);
    }
    if (emit) this.emitSettings();
  }

  private async loadPreferences(): Promise<void> {
    if (this.preferencesLoaded) return;
    this.preferencesLoaded = true;
    this.preferencesFile = path.join(app.getPath("userData"), PREFERENCES_FILE);
    try {
      const raw = JSON.parse(await readFile(this.preferencesFile, "utf8")) as unknown;
      const saved = readPreferences(raw);
      this.preference = saved.screen?.id.startsWith("window:") ? null : saved.screen;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return;
      this.settingsError =
        `Saved screen preferences could not be read: ${errorMessage(error)}`;
      log.warn(this.settingsError);
    }
  }

  private persistPreferences(): Promise<void> {
    if (!this.preferencesFile) {
      this.preferencesFile = path.join(app.getPath("userData"), PREFERENCES_FILE);
    }
    const file = this.preferencesFile;
    const contents = JSON.stringify({ screen: this.preference?.id.startsWith("window:") ? null : this.preference }, null, 2);
    const write = this.preferenceWrites.then(async () => {
      await mkdir(path.dirname(file), { recursive: true });
      const temp = `${file}.tmp.${process.pid}.${Date.now()}`;
      try {
        await writeFile(temp, contents);
        await rename(temp, file);
      } finally {
        await rm(temp, { force: true });
      }
    });
    this.preferenceWrites = write.catch(() => undefined);
    return write;
  }

  private settingsFailure(
    error: unknown,
    prefix: string,
  ): ScreenSettingsResult {
    const message = `${prefix}: ${errorMessage(error)}`;
    this.settingsError = message;
    this.emitSettings();
    return { ok: false, status: this.settings(), error: message };
  }

  private emitSettings(): void {
    this.onSettingsChanged(this.settings());
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.operation.then(task, task);
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

function readPreferences(value: unknown): StoredPreferences {
  if (!value || typeof value !== "object") {
    throw new Error("Expected an object.");
  }
  const rawScreen =
    "screen" in value && value.screen && typeof value.screen === "object"
      ? value.screen
      : null;
  if (!rawScreen) return { screen: null };

  const id =
    "id" in rawScreen && typeof rawScreen.id === "string"
      ? rawScreen.id
      : "";
  if (!id) throw new Error("The saved screen id is invalid.");
  return {
    screen: {
      id,
      label:
        "label" in rawScreen && typeof rawScreen.label === "string"
          ? rawScreen.label
          : "",
      displayId:
        "displayId" in rawScreen && typeof rawScreen.displayId === "string"
          ? rawScreen.displayId
          : "",
    },
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
