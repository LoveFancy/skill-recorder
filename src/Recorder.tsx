import { BrowserSettingsPanel } from "./BrowserSettingsPanel";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type {
  DoctorReport,
  MicrophoneSettingsStatus,
  NarrationStatus,
  RecorderStatus,
  ScreenSettingsStatus,
  SensitiveModelStatus,
  StartOptions,
} from "../common/ipc";
import {
  DEFAULT_NARRATION_LANGUAGE,
  narrationLanguageLabel,
  type NarrationLanguage,
} from "../common/narration";
import { formatMs } from "./format";
import { RecordingPrivacyWarning } from "./RecordingPrivacyWarning";
import { WhatsRecorded } from "./WhatsRecorded";

const IS_MAC = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
/** Mirrors the main-process global shortcut "CommandOrControl+Shift+R", per OS. */
const TOGGLE_SHORTCUT = IS_MAC ? "⌘⇧R" : "Ctrl+Shift+R";
type PrivacyReviewOrigin = "home" | "warning";

/** The HUD fills the window (`height:100vh`), so its own box can't reveal how tall the
 *  content actually is. Sum the in-flow children (skipping absolute/fixed overlays like
 *  scrims, popovers and the privacy sheet) to get the natural content height the window
 *  should shrink/grow to. */
function measureHudHeight(hud: HTMLElement): number {
  const style = getComputedStyle(hud);
  const gap = parseFloat(style.rowGap || style.gap) || 0;
  let total = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
  let inFlow = 0;
  for (const child of Array.from(hud.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const cs = getComputedStyle(child);
    if (cs.position === "absolute" || cs.position === "fixed" || cs.display === "none") continue;
    total += child.getBoundingClientRect().height;
    total += (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    inFlow += 1;
  }
  if (inFlow > 1) total += gap * (inFlow - 1);
  return Math.ceil(total) + 2;
}

export function Recorder() {
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [doctor, setDoctor] = useState<DoctorReport | null>(null);
  const [narrationStatus, setNarrationStatus] = useState<NarrationStatus | null>(null);
  const [microphoneSettings, setMicrophoneSettings] =
    useState<MicrophoneSettingsStatus | null>(null);
  const [screenSettings, setScreenSettings] =
    useState<ScreenSettingsStatus | null>(null);
  const [privacyReviewOrigin, setPrivacyReviewOrigin] =
    useState<PrivacyReviewOrigin | null>(null);
  const [showRecordingWarning, setShowRecordingWarning] = useState(false);
  const [warningStarting, setWarningStarting] = useState(false);
  const [showNarrationSettings, setShowNarrationSettings] = useState(false);
  const [narrationLanguage, setSelectedNarrationLanguage] =
    useState<NarrationLanguage>(DEFAULT_NARRATION_LANGUAGE);
  const [sensitive, setSensitive] = useState<SensitiveModelStatus | null>(null);
  const [microphonePending, setMicrophonePending] = useState(false);
  const [microphoneActionError, setMicrophoneActionError] = useState<string | null>(null);
  const [screenPending, setScreenPending] = useState(false);
  const [screenActionError, setScreenActionError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const narrationSettingsRef = useRef<HTMLElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    const list = await window.skillRecorder.listSessions();
    setSessionCount(list.length);
    setPendingCount(list.filter((s) => !s.analysis).length);
  }, []);

  const applyRecorderStatus = useCallback((next: RecorderStatus) => {
    setStatus(next);
    setSelectedNarrationLanguage(next.narrationLanguage);
  }, []);

  useEffect(() => {
    void window.skillRecorder.status().then(applyRecorderStatus);
    void window.skillRecorder.doctor().then(setDoctor);
    void window.skillRecorder.narrationStatus().then(setNarrationStatus);
    void window.skillRecorder.microphoneSettings().then(setMicrophoneSettings);
    void window.skillRecorder.screenSettings().then(setScreenSettings);
    void window.skillRecorder.sensitiveModelStatus().then(setSensitive);
    void refreshCount();
    const offRecorder = window.skillRecorder.onStatusChanged(applyRecorderStatus);
    const offNarration = window.skillRecorder.onNarrationStatusChanged(setNarrationStatus);
    const offMicrophones =
      window.skillRecorder.onMicrophoneSettingsChanged(setMicrophoneSettings);
    const offScreens =
      window.skillRecorder.onScreenSettingsChanged((next) => {
        setScreenSettings(next);
        setScreenPending(false);
      });
    const offSensitive = window.skillRecorder.onSensitiveModelStatusChanged(setSensitive);
    return () => {
      offRecorder();
      offNarration();
      offMicrophones();
      offScreens();
      offSensitive();
    };
  }, [applyRecorderStatus, refreshCount]);

  useEffect(() => {
    return window.skillRecorder.onRecordingPrivacyWarningRequested(() => {
      setShowNarrationSettings(false);
      setShowRecordingWarning(true);
    });
  }, []);

  // The analyze step happens in the library window, so re-check how many
  // recordings still need analysis whenever the recorder regains focus.
  useEffect(() => {
    const onFocus = () => { void refreshCount(); void window.skillRecorder.doctor().then(setDoctor); };
    const offSettings = window.skillRecorder.onSettingsChanged(onFocus);
    window.addEventListener("focus", onFocus);
    return () => { window.removeEventListener("focus", onFocus); offSettings(); };
  }, [refreshCount]);

  const recording = status?.state === "recording";
  const transitioning = status?.transition !== "none";
  const startedAt = status?.startedAt ?? null;
  const justSaved = !recording && status?.lastFinish?.outcome === "saved";
  const justDiscarded = !recording && status?.lastFinish?.outcome === "discarded";
  const narrate = microphoneSettings?.narrationEnabled ?? false;
  const narrationLanguageName = narrationLanguageLabel(narrationLanguage);
  const advancedOn = sensitive?.enabled ?? true;
  const selectedScreenLabel =
    screenSettings?.selectedSourceLabel ?? "正在加载屏幕…";

  useEffect(() => {
    if (recording) {
      setShowNarrationSettings(false);
    }
  }, [recording]);

  useEffect(() => {
    if (!showNarrationSettings) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowNarrationSettings(false);
    };
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || narrationSettingsRef.current?.contains(target)) return;
      setShowNarrationSettings(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [showNarrationSettings]);

  // Keep the fixed-width HUD window sized to its content: no dead space in short
  // states, no clipping when the doctor reveals an extra model row. Observers catch
  // both row add/remove (MutationObserver) and reflow/size changes (ResizeObserver).
  useLayoutEffect(() => {
    const hud = hudRef.current;
    if (!hud) return;
    let frame = 0;
    const report = () => {
      frame = 0;
      window.skillRecorder.fitRecorderHeight?.(measureHudHeight(hud));
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(report);
    };
    const ro = new ResizeObserver(schedule);
    const observeChildren = () => {
      ro.disconnect();
      for (const child of Array.from(hud.children)) ro.observe(child);
    };
    const mo = new MutationObserver(() => {
      observeChildren();
      schedule();
    });
    observeChildren();
    mo.observe(hud, { childList: true });
    schedule();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
    };
  }, []);

  // Refresh the library count whenever a recording finishes.
  useEffect(() => {
    if (!recording) void refreshCount();
  }, [recording, refreshCount]);

  useEffect(() => {
    if (!recording || startedAt == null) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [recording, startedAt]);

  const toggle = useCallback(async () => {
    if (recording) {
      const res = await window.skillRecorder.stop();
      if (!res.ok) window.alert(res.error ?? "操作失败");
      applyRecorderStatus(await window.skillRecorder.status());
      return;
    }

    setShowNarrationSettings(false);
    await window.skillRecorder.start();
  }, [applyRecorderStatus, recording]);

  const startAfterWarning = useCallback(async (options: Pick<StartOptions, "intent" | "outputKind">) => {
    setWarningStarting(true);
    await window.skillRecorder.markRecordingPrivacyReviewed();
    const res = await window.skillRecorder.confirmStart(options);
    if (!res.ok) {
      setWarningStarting(false);
      window.alert(res.error ?? "无法开始录制。");
      return;
    }
    setShowRecordingWarning(false);
    setWarningStarting(false);
    applyRecorderStatus(await window.skillRecorder.status());
  }, [applyRecorderStatus]);

  const openPrivacyReview = useCallback((origin: PrivacyReviewOrigin) => {
    if (origin === "home") setShowRecordingWarning(false);
    setPrivacyReviewOrigin(origin);
  }, []);

  const closePrivacyReview = useCallback(() => {
    const returnToWarning = privacyReviewOrigin === "warning";
    setPrivacyReviewOrigin(null);
    if (!returnToWarning) setShowRecordingWarning(false);
  }, [privacyReviewOrigin]);

  const completePrivacyReview = useCallback(async () => {
    await window.skillRecorder.markRecordingPrivacyReviewed();
    const returnToIntent = privacyReviewOrigin === "warning";
    setPrivacyReviewOrigin(null);
    if (!returnToIntent) setShowRecordingWarning(false);
  }, [privacyReviewOrigin]);

  const toggleNarration = useCallback(async () => {
    if (!microphoneSettings) return;
    setMicrophonePending(true);
    setMicrophoneActionError(null);
    const result = await window.skillRecorder.setNarrationEnabled(
      !microphoneSettings.narrationEnabled,
    );
    setMicrophoneSettings(result.status);
    if (!result.ok) {
      setMicrophoneActionError(
        result.error ?? "无法修改旁白设置。",
      );
      setShowNarrationSettings(true);
    }
    setMicrophonePending(false);
  }, [microphoneSettings]);

  const selectMicrophone = useCallback(async (deviceId: string) => {
    setMicrophonePending(true);
    setMicrophoneActionError(null);
    const result = await window.skillRecorder.selectMicrophone(deviceId);
    setMicrophoneSettings(result.status);
    if (!result.ok) {
      setMicrophoneActionError(
        result.error ?? "无法选择此麦克风。",
      );
    }
    setMicrophonePending(false);
  }, []);

  const selectScreen = useCallback(async (sourceId: string) => {
    setScreenPending(true);
    setScreenActionError(null);
    const result = await window.skillRecorder.selectScreen(sourceId);
    setScreenSettings(result.status);
    if (!result.ok) {
      setScreenActionError(result.error ?? "无法选择此屏幕。");
    }
    setScreenPending(false);
  }, []);

  const openLibrary = useCallback(() => {
    void window.skillRecorder.openLibrary();
  }, []);

  return (
    <div className="hud" ref={hudRef}>
      <button className="home-settings-button" aria-label="打开设置" onClick={() => void window.skillRecorder.openSettings()}>设置</button>
      <div className="transport">
        <button
          className={`record ${recording ? "on" : ""}`}
          onClick={toggle}
          disabled={transitioning || microphonePending || screenPending}
          aria-label={recording ? "结束录制" : "开始录制"}
        >
          <span className="record-glyph" />
        </button>
        <div className={`timecode ${recording ? "live" : ""}`}>
          {recording ? formatMs(elapsed) : "00:00"}
        </div>
        <div className="transport-sub">
          {recording
            ? `已采集 ${status?.eventCount ?? 0} 个事件`
            : justSaved
              ? "录制已保存，打开录制记录进行分析"
              : justDiscarded
                ? "录制已丢弃"
              : screenSettings?.error
                ? "屏幕采集需要检查"
                : `准备录制 · ${selectedScreenLabel}`}
        </div>
      </div>

      <section className="capture-range-settings" aria-label="录制内容">
        <div><strong>录制内容</strong><span>{screenSettings?.selectedSourceId.startsWith("window:") ? "应用窗口" : "整个屏幕"} · {selectedScreenLabel}</span></div>
        <button className="secondary" disabled={screenPending || recording || transitioning} onClick={async () => {
          setScreenPending(true); setScreenActionError(null);
          try { const result = await window.skillRecorder.pickRecordingSource(); setScreenSettings(result.status); if (!result.ok) setScreenActionError(result.error ?? "无法选择录制内容"); }
          catch (error) { setScreenActionError(error instanceof Error ? error.message : "无法选择录制内容"); }
          finally { setScreenPending(false); }
        }}>{screenPending ? "选择中…" : "选择屏幕或应用"}</button>
        {screenActionError && <p className="error" role="alert">{screenActionError}</p>}
      </section>

      <section ref={narrationSettingsRef} className={`narrate ${narrate ? "on" : ""}`}>
        <div className="narrate-head">
          <button
            className="narrate-toggle"
            role="switch"
            aria-checked={narrate}
            aria-busy={microphonePending}
            onClick={() => void toggleNarration()}
            disabled={
              !microphoneSettings ||
              microphonePending ||
              recording ||
              transitioning
            }
          >
            <span className="narrate-icon" aria-hidden>
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                <rect
                  x="7.5"
                  y="2.5"
                  width="5"
                  height="9"
                  rx="2.5"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path
                  d="M5 9.2a5 5 0 0 0 10 0"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
                <path
                  d="M10 14.2v3"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="narrate-text">
              <span className="narrate-label">语音旁白</span>
              <span className="narrate-sub">
                {microphonePending
                  ? "正在请求麦克风权限…"
                  : microphoneActionError || microphoneSettings?.error
                    ? "麦克风需要检查"
                    : recording
                      ? narrate
                        ? `Listening · ${narrationLanguageName}`
                        : "本次录制未开启旁白"
                      : narrate
                        ? narrationLanguageName
                        : "边操作边讲解（可选）"}
              </span>
            </span>
          </button>
          <button
            className={`narrate-settings-toggle ${showNarrationSettings ? "open" : ""}`}
            aria-label="录制设置"
            aria-controls="recording-settings"
            aria-expanded={showNarrationSettings}
            title="录制设置"
            disabled={microphonePending || screenPending || recording || transitioning}
            onClick={() => {
              setMicrophoneActionError(null);
              setScreenActionError(null);
              setShowNarrationSettings((open) => !open);
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path
                fill="currentColor"
                d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.49 1a7.2 7.2 0 0 0-1.69-.98l-.38-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42l-.38 2.65c-.61.25-1.17.58-1.69.98l-2.49-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65a7.7 7.7 0 0 0 0 1.96l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .6.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65A.5.5 0 0 0 10 22h4a.5.5 0 0 0 .5-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1a.5.5 0 0 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"
              />
            </svg>
          </button>
          <button
            type="button"
            className="narrate-switch-btn"
            aria-hidden
            tabIndex={-1}
            disabled={
              !microphoneSettings ||
              microphonePending ||
              recording ||
              transitioning
            }
            onClick={() => void toggleNarration()}
          >
            <span className={`narrate-switch ${narrate ? "on" : ""}`}>
              <span className="narrate-knob" />
            </span>
          </button>
        </div>

        {showNarrationSettings && (
          <>
            <button
              type="button"
              className="narrate-scrim"
              aria-hidden
              tabIndex={-1}
              onClick={() => setShowNarrationSettings(false)}
            />
            <div id="recording-settings" className="narrate-settings">
            <label htmlFor="narrate-microphone">麦克风</label>
            <div className="narrate-select-wrap">
              <select
                id="narrate-microphone"
                value={microphoneSettings?.selectedDeviceId ?? ""}
                disabled={microphonePending || recording || transitioning}
                onChange={(event) => void selectMicrophone(event.target.value)}
              >
                {microphoneSettings ? (
                  microphoneSettings.devices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.label}
                    </option>
                  ))
                ) : (
                  <option value="">正在加载麦克风…</option>
                )}
              </select>
              <span className="narrate-select-chevron" aria-hidden>
                ▾
              </span>
            </div>
            <label htmlFor="recording-screen">录制内容</label>
            <div className="narrate-select-wrap">
              <select
                id="recording-screen"
                value={screenSettings?.selectedSourceId ?? ""}
                disabled={
                  screenPending ||
                  recording ||
                  transitioning ||
                  !screenSettings ||
                  screenSettings.screens.length === 0
                }
                onChange={(event) => void selectScreen(event.target.value)}
              >
                {screenSettings?.screens.length ? (
                  screenSettings.screens.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.label}
                    </option>
                  ))
                ) : (
                  <option value="">
                    {screenSettings ? "没有可用屏幕" : "正在加载屏幕…"}
                  </option>
                )}
              </select>
              <span className="narrate-select-chevron" aria-hidden>
                ▾
              </span>
            </div>
            {(microphoneActionError ||
              microphoneSettings?.error ||
              microphoneSettings?.fallback) && (
              <p
                className={`narrate-settings-note ${
                  microphoneActionError || microphoneSettings?.error
                    ? "error"
                    : "warn"
                }`}
                role={
                  microphoneActionError || microphoneSettings?.error
                    ? "alert"
                    : undefined
                }
              >
                {microphoneActionError ??
                  microphoneSettings?.error ??
                  microphoneSettings?.fallback}
              </p>
            )}
            {(screenActionError ||
              screenSettings?.error ||
              screenSettings?.fallback) && (
              <p
                className={`narrate-settings-note ${
                  screenActionError || screenSettings?.error
                    ? "error"
                    : "warn"
                }`}
                role={
                  screenActionError || screenSettings?.error
                    ? "alert"
                    : undefined
                }
              >
                {screenActionError ??
                  screenSettings?.error ??
                  screenSettings?.fallback}
              </p>
            )}
            </div>
          </>
        )}
      </section>

      <button className="privacy-note" onClick={() => openPrivacyReview("home")}>
        <span className="privacy-note-icon" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <path
              d="M10 2.5 4 4.8v4.3c0 3.4 2.4 6.2 6 7.4 3.6-1.2 6-4 6-7.4V4.8L10 2.5Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="m7.4 9.8 1.9 1.9 3.4-3.6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="privacy-note-text">
          <span className="privacy-note-title">记录屏幕和操作活动</span>
          <span className="privacy-note-sub">请勿展示密码、访问令牌或 API 密钥 · 查看具体采集内容</span>
        </span>
        {!advancedOn ? (
          <span className="privacy-note-badge is-off">隐私保护已关闭</span>
        ) : null}
        <span className="privacy-note-chevron" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 4l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      <button
        className={`sessions-open ${pendingCount > 0 ? "has-new" : ""}`}
        onClick={openLibrary}
        aria-label={
          pendingCount > 0
            ? `查看录制记录，${pendingCount} 条待分析`
            : sessionCount === 0
              ? "查看录制记录，暂无录制"
              : `查看录制记录，共 ${sessionCount} 条`
        }
      >
        <span className="sessions-open-icon" aria-hidden>
          <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
            <path
              d="M10 2.6 3.2 6 10 9.4 16.8 6 10 2.6Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="M3.4 10 10 13.3 16.6 10"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M3.4 13.6 10 16.9 16.6 13.6"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="sessions-open-text">
          <span className="sessions-open-label">
            查看录制记录
            {pendingCount > 0 && <span className="sessions-open-flag">{pendingCount}</span>}
          </span>
          <span className={`sessions-open-sub ${pendingCount > 0 ? "is-new" : ""}`}>
            {pendingCount > 0
              ? `${pendingCount} 条待分析`
              : sessionCount === 0
                ? "暂无录制"
                : `${sessionCount} 条录制`}
          </span>
        </span>
        <span className="sessions-open-chevron" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M6 4l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      <div className="doctor">
        <button className="row settings-status-link" title={doctor?.processing?.error ?? "打开 Agent 能力设置"} onClick={() => void window.skillRecorder.openSettings("agent")}>
          <span className={`badge ${doctor?.processing?.ready ? "good" : "warn"}`}>{doctor?.processing?.ready ? "✓" : "!"}</span><span className="row-label">智能处理</span>
          <span className="row-note">{doctor?.processing ? doctor.processing.ready ? `${doctor.processing.backend === "local-agent" ? "Claude Code" : "模型 API"} · 已就绪` : "需要配置" : "检查中"}</span>
        </button>
        {narrationStatus && <button className="row settings-status-link" onClick={() => void window.skillRecorder.openSettings("voice")}><span className={`badge ${narrationStatus.model === "ready" ? "good" : "warn"}`}>{narrationStatus.model === "ready" ? "✓" : "!"}</span><span className="row-label">语音转写</span><span className="row-note">{narrationStatus.model === "ready" ? "SenseVoice · 本地处理" : narrationStatus.phase === "downloading" ? `下载中 ${narrationStatus.progress ?? ""}%` : "模型未就绪"}</span></button>}
        {sensitive && <button className="row settings-status-link" onClick={() => void window.skillRecorder.openSettings("privacy")}><span className={`badge ${sensitive.enabled && sensitive.ocr === "ready" ? "good" : "warn"}`}>{sensitive.enabled && sensitive.ocr === "ready" ? "✓" : "!"}</span><span className="row-label">隐私保护</span><span className="row-note">{!sensitive.enabled ? "已关闭" : sensitive.ocr === "ready" ? "已开启 · 本地处理" : "模型未就绪"}</span></button>}
        <BrowserSettingsPanel summary />
      </div>


      <p className="hint">{TOGGLE_SHORTCUT} 随时开始或结束录制</p>

      {showRecordingWarning && (
        <RecordingPrivacyWarning
          starting={warningStarting}
          onStart={(options) => void startAfterWarning(options)}
          onReview={() => openPrivacyReview("warning")}
          onClose={() => setShowRecordingWarning(false)}
        />
      )}
      {privacyReviewOrigin && (
        <WhatsRecorded
          onClose={closePrivacyReview}
          onReviewed={() => void completePrivacyReview()}
          sensitive={sensitive}
          onOpenSettings={() => void window.skillRecorder.openSettings("privacy")}
        />
      )}
    </div>
  );
}
