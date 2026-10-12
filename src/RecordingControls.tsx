import { useCallback, useEffect, useRef, useState } from "react";

import type {
  MicrophoneSettingsStatus,
  RecorderStatus,
} from "../common/ipc";
import type { TerminalStatus } from "../common/terminal";
import {
  DEFAULT_NARRATION_LANGUAGE,
  narrationLanguageLabel,
} from "../common/narration";
import { formatMs } from "./format";

export function RecordingControls() {
  const [status, setStatus] = useState<RecorderStatus | null>(null);
  const [microphoneSettings, setMicrophoneSettings] =
    useState<MicrophoneSettingsStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [showMicrophoneMenu, setShowMicrophoneMenu] = useState(false);
  const [microphonePending, setMicrophonePending] = useState(false);
  const [devicePending, setDevicePending] = useState(false);
  const [finishPending, setFinishPending] = useState<"done" | "discard" | null>(null);
  const [terminalStatus, setTerminalStatus] = useState<TerminalStatus | null>(null);
  const [annotationPending, setAnnotationPending] = useState(false);
  const [annotationMessage, setAnnotationMessage] = useState<string | null>(null);
  const [terminalPending, setTerminalPending] = useState(false);
  const [terminalConfirm, setTerminalConfirm] = useState<"done" | "discard" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const keepRecordingRef = useRef<HTMLButtonElement>(null);
  const microphoneControlRef = useRef<HTMLDivElement>(null);
  const microphoneMenuRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void window.skillRecorder.status().then(setStatus);
    void window.skillRecorder.microphoneSettings().then(setMicrophoneSettings);
    void window.skillRecorder.terminalStatus().then(setTerminalStatus);
    const offStatus = window.skillRecorder.onStatusChanged(setStatus);
    const offMicrophones =
      window.skillRecorder.onMicrophoneSettingsChanged(setMicrophoneSettings);
    const offTerminal =
      window.skillRecorder.onTerminalStatusChanged(setTerminalStatus);
    const offTerminalFinish =
      window.skillRecorder.onTerminalFinishConfirmationRequested(() => {
        setConfirmDiscard(false);
        setShowMicrophoneMenu(false);
        setTerminalConfirm("done");
      });
    return () => {
      offStatus();
      offMicrophones();
      offTerminal();
      offTerminalFinish();
    };
  }, []);

  const recording = status?.state === "recording";
  const startedAt = status?.startedAt ?? null;
  useEffect(() => {
    if (!recording || startedAt == null) {
      setElapsed(0);
      return;
    }
    const update = () => setElapsed(Math.max(0, Date.now() - startedAt));
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [recording, startedAt]);

  useEffect(() => {
    if (recording) return;
    if (confirmDiscard) setConfirmDiscard(false);
    if (showMicrophoneMenu) setShowMicrophoneMenu(false);
    setMicrophonePending(false);
    setDevicePending(false);
    setFinishPending(null);
    setTerminalConfirm(null);
    setTerminalPending(false);
  }, [confirmDiscard, recording, showMicrophoneMenu]);

  useEffect(() => {
    void window.skillRecorder.setRecordingControlsExpanded(
      confirmDiscard || showMicrophoneMenu || terminalConfirm !== null || actionError !== null,
    );
  }, [confirmDiscard, showMicrophoneMenu, terminalConfirm, actionError]);

  useEffect(() => {
    if (!confirmDiscard) return;
    keepRecordingRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setConfirmDiscard(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmDiscard]);

  useEffect(() => {
    if (!showMicrophoneMenu) return;
    microphoneMenuRef.current
      ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
      ?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowMicrophoneMenu(false);
    };
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        microphoneMenuRef.current?.contains(target) ||
        microphoneControlRef.current?.contains(target)
      ) {
        return;
      }
      setShowMicrophoneMenu(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [showMicrophoneMenu]);

  useEffect(() => {
    if (
      recording &&
      (status?.microphone.state === "error" ||
        microphoneSettings?.preferredDeviceUnavailable)
    ) {
      setConfirmDiscard(false);
      setShowMicrophoneMenu(true);
    }
  }, [
    microphoneSettings?.preferredDeviceUnavailable,
    recording,
    status?.microphone.state,
  ]);

  const toggleMicrophone = useCallback(async () => {
    if (!status) return;
    setMicrophonePending(true);
    setActionError(null);
    const enable = status.microphone.state !== "on";
    const result = await window.skillRecorder.setMicrophoneEnabled(enable);
    if (!result.ok) setActionError(result.error ?? "无法修改麦克风设置。");
    setMicrophonePending(false);
  }, [status]);

  const selectMicrophone = useCallback(async (deviceId: string) => {
    setDevicePending(true);
    setActionError(null);
    const result = await window.skillRecorder.selectMicrophone(deviceId);
    setMicrophoneSettings(result.status);
    if (!result.ok) {
      setActionError(result.error ?? "无法切换麦克风。");
    } else {
      setShowMicrophoneMenu(false);
    }
    setDevicePending(false);
  }, []);

  const done = useCallback(async (forceTerminal = false) => {
    setFinishPending("done");
    setActionError(null);
    const result = await window.skillRecorder.stop(forceTerminal);
    if (result.requiresTerminalConfirmation) {
      setTerminalConfirm("done");
      setFinishPending(null);
      return;
    }
    if (!result.ok) {
      setActionError(result.error ?? "无法结束录制。");
      setFinishPending(null);
    }
  }, []);

  const discard = useCallback(async (forceTerminal = false) => {
    setFinishPending("discard");
    setActionError(null);
    const result = await window.skillRecorder.discard(forceTerminal);
    if (result.requiresTerminalConfirmation) {
      setConfirmDiscard(false);
      setTerminalConfirm("discard");
      setFinishPending(null);
      return;
    }
    if (!result.ok) {
      const error = result.error ?? "无法丢弃录制。";
      setActionError(error);
      setFinishPending(null);
      window.alert(error);
    }
  }, []);

  const openTerminal = useCallback(async () => {
    setTerminalPending(true);
    setActionError(null);
    setConfirmDiscard(false);
    setShowMicrophoneMenu(false);
    const result = await window.skillRecorder.openTerminal();
    if (!result.ok) setActionError(result.error);
    setTerminalPending(false);
  }, []);

  const transitionBusy = status?.transition !== "none";
  const microphoneBusy =
    microphonePending ||
    devicePending ||
    status?.microphone.state === "starting" ||
    status?.microphone.state === "stopping";
  const lifecycleBusy = finishPending !== null || transitionBusy || !recording;
  const microphoneOn = status?.microphone.state === "on";
  const microphoneError = status?.microphone.state === "error";
  const narrationLanguage = narrationLanguageLabel(
    status?.narrationLanguage ?? DEFAULT_NARRATION_LANGUAGE,
  );
  const activeMicrophoneLabel =
    status?.microphone.activeDevice?.label ??
    microphoneSettings?.selectedDeviceLabel ??
    "系统默认";
  const microphoneLabel =
    status?.microphone.state === "starting"
      ? "启动中"
      : status?.microphone.state === "stopping"
        ? "停止中"
        : microphoneOn
          ? "执行日期"
          : microphoneError
            ? "重试"
            : "关闭";
  const error =
    actionError ??
    status?.microphone.error ??
    microphoneSettings?.error ??
    microphoneSettings?.fallback ??
    null;
  const captureLabel =
    status?.transition === "starting"
      ? "启动中"
      : status?.transition === "stopping"
        ? "保存中"
        : status?.transition === "discarding"
          ? "丢弃中"
          : "录制中";

  return (
    <div
      className={`recording-controls ${
        confirmDiscard || showMicrophoneMenu || terminalConfirm ? "expanded" : ""
      }`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && confirmDiscard) setConfirmDiscard(false);
      }}
    >
      {confirmDiscard && (
        <section
          className="recording-discard-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="recording-discard-title"
          aria-describedby="recording-discard-description"
        >
          <div>
            <h2 id="recording-discard-title">丢弃本次录制？</h2>
            <p id="recording-discard-description">屏幕视频、活动记录、终端输出和语音片段将被永久删除。</p>
          </div>
          <div className="recording-discard-actions">
            <button
              ref={keepRecordingRef}
              className="recording-keep"
              disabled={finishPending === "discard"}
              onClick={() => setConfirmDiscard(false)}
            >继续录制</button>
            <button
              className="recording-confirm-discard"
              disabled={finishPending === "discard"}
              onClick={() => void discard()}
            >
              {finishPending === "discard" ? "正在丢弃…" : "丢弃录制"}
            </button>
          </div>
        </section>
      )}

      {terminalConfirm && (
        <section
          className="recording-terminal-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="recording-terminal-title"
          aria-describedby="recording-terminal-description"
        >
          <div>
            <h2 id="recording-terminal-title">终端命令仍在运行</h2>
            <p id="recording-terminal-description">结束录制将停止命令，并将输出保存为已中断状态。</p>
          </div>
          <div className="recording-discard-actions">
            <button
              className="recording-keep"
              onClick={() => setTerminalConfirm(null)}
            >继续录制</button>
            <button
              className={
                terminalConfirm === "discard"
                  ? "recording-confirm-discard"
                  : "recording-close-terminal"
              }
              onClick={() => {
                const intent = terminalConfirm;
                setTerminalConfirm(null);
                if (intent === "discard") void discard(true);
                else void done(true);
              }}
            >
              {terminalConfirm === "discard"
                ? "关闭终端并丢弃"
                : "关闭终端并保存"}
            </button>
          </div>
        </section>
      )}

      {showMicrophoneMenu && (
        <section
          ref={microphoneMenuRef}
          className="recording-microphone-menu"
          aria-label="选择麦克风"
        >
          <header>
            <strong>麦克风</strong>
            <span>
              {microphoneOn
                ? `Using ${activeMicrophoneLabel}`
                : `下次使用：${microphoneSettings?.selectedDeviceLabel ?? "系统默认"}`}
            </span>
          </header>
          <div
            className="recording-microphone-options"
            role="radiogroup"
            aria-label="音频输入"
          >
            {microphoneSettings?.devices.map((device) => {
              const selected =
                device.id === microphoneSettings.selectedDeviceId;
              return (
                <button
                  key={device.id}
                  className={selected ? "selected" : ""}
                  role="radio"
                  aria-checked={selected}
                  aria-pressed={selected}
                  disabled={devicePending || finishPending !== null}
                  onClick={() => void selectMicrophone(device.id)}
                >
                  <span>{device.label}</span>
                  {selected && (
                    <span className="recording-microphone-selected">已选择</span>
                  )}
                </button>
              );
            })}
          </div>

          {error && (
            <p
              className={
                actionError ||
                status?.microphone.error ||
                microphoneSettings?.error
                  ? "error"
                  : "warn"
              }
              role={
                actionError ||
                status?.microphone.error ||
                microphoneSettings?.error
                  ? "alert"
                  : undefined
              }
            >
              {error}
            </p>
          )}
        </section>
      )}

      {actionError && !showMicrophoneMenu && <p className="recording-action-error" role="alert">{actionError}</p>}
      {annotationMessage && !actionError && <div className="recording-capture-feedback" role="status">{annotationMessage}</div>}
      <div className="recording-bar-wrap">
        <div className="recording-bar">
          <div className="recording-live" role="status" aria-label={`${captureLabel} ${formatMs(elapsed)}`}>
            <span className="recording-live-dot" aria-hidden />
            <span className="recording-live-copy">
              <strong>{captureLabel}</strong>
              <span>{formatMs(elapsed)}</span>
            </span>
          </div>

          <span className="recording-divider" aria-hidden />

          <div
            ref={microphoneControlRef}
            className={`recording-microphone-split ${
              microphoneOn ? "on" : ""
            } ${microphoneError ? "error" : ""}`}
          >
            <button
              className="recording-microphone"
              disabled={lifecycleBusy || microphoneBusy}
              aria-label={
                microphoneOn
                  ? `关闭 ${activeMicrophoneLabel}。旁白按 ${narrationLanguage} 转写。`
                  : microphoneError
                    ? `重试麦克风。${status?.microphone.error ?? ""}`
                    : `开启 ${microphoneSettings?.selectedDeviceLabel ?? "系统默认"}，使用 ${narrationLanguage} 旁白`
              }
              aria-pressed={microphoneOn}
              title={
                microphoneOn
                  ? `Mute ${activeMicrophoneLabel} · ${narrationLanguage} transcript`
                  : `开启 ${microphoneSettings?.selectedDeviceLabel ?? "系统默认"} · ${narrationLanguage} 转写`
              }
              onClick={() => void toggleMicrophone()}
            >
              <MicrophoneIcon off={!microphoneOn} />
              <span>{microphoneLabel}</span>
            </button>
            <button
              className="recording-microphone-menu-toggle"
              disabled={lifecycleBusy || microphoneBusy}
              aria-label="选择麦克风"
              aria-haspopup="dialog"
              aria-expanded={showMicrophoneMenu}
              title="选择麦克风"
              onClick={() => {
                setActionError(null);
                setConfirmDiscard(false);
                setShowMicrophoneMenu((open) => !open);
              }}
            >
              <ChevronIcon open={showMicrophoneMenu} />
            </button>
          </div>

          <button
            className={`recording-terminal ${
              terminalStatus?.state !== "closed" ? "active" : ""
            } ${terminalStatus?.state === "error" ? "error" : ""}`}
            disabled={lifecycleBusy || terminalPending}
            aria-label={
              terminalStatus?.state === "closed"
                ? "打开录制终端"
                : `切换到录制终端。${terminalStatus?.state ?? ""}`
            }
            title="打开仅用于本次录制的终端"
            onClick={() => void openTerminal()}
          >
            <TerminalIcon />
            <span>{terminalPending ? "打开中" : "终端"}</span>
            {terminalStatus?.state !== "closed" && (
              <span
                className={`recording-terminal-dot ${
                  terminalStatus?.state ?? "closed"
                }`}
                aria-hidden
              />
            )}
          </button>

          <div className="recording-capture-tools" role="group" aria-label="截图与标注工具">
            {([
              { mode:"crop", label:"截图", title:"拖动选取局部画面并保存截图" },
              { mode:"region", label:"框选", title:"在当前界面框选重点，双击或 Enter 确认" },
              { mode:"click", label:"点击", title:"在当前界面标记点击位置并保存截图" },
            ] as const).map(tool => <button key={tool.mode} className="recording-annotate" disabled={lifecycleBusy || annotationPending} title={tool.title} aria-label={tool.title} onClick={async () => {
              setAnnotationPending(true); setActionError(null); setAnnotationMessage(null);
              try {
                const result = await window.skillRecorder.annotateRegion(tool.mode);
                if (!result.ok) setActionError(result.error ?? "无法保存截图");
                else if (result.saved) setAnnotationMessage(tool.mode === "crop" ? "局部截图已保存" : "标注截图已保存");
              } catch { setActionError("无法保存截图"); }
              finally { setAnnotationPending(false); }
            }}><CaptureToolIcon mode={tool.mode} /></button>)}
          </div>

          <button
            className="recording-discard"
            disabled={lifecycleBusy}
            onClick={() => {
              setActionError(null);
              setShowMicrophoneMenu(false);
              setConfirmDiscard(true);
            }}
          >丢弃</button>
          <button className="recording-done" disabled={lifecycleBusy} onClick={() => void done(false)}>
            {finishPending === "done" || status?.transition === "stopping" ? "正在保存…" : "完成"}
          </button>
        </div>
        <span className="recording-drag-handle" aria-hidden />
      </div>

      <span className="recording-controls-live" aria-live="polite">
        {error ?? annotationMessage ?? ""}
      </span>
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
    >
      <path
        d={open ? "m3 7.5 3-3 3 3" : "m3 4.5 3 3 3-3"}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg width="17" height="16" viewBox="0 0 18 16" fill="none" aria-hidden>
      <rect x="1.5" y="2" width="15" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="m4.5 6 2 2-2 2M9 10h4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MicrophoneIcon({ off }: { off: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="7.5" y="2.5" width="5" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5 9.2a5 5 0 0 0 8.9 3.1M10 14.2v3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {!off && (
        <path
          d="M15 9.2c0 .7-.14 1.36-.4 1.96"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      )}
      {off && (
        <path
          d="M3.2 3.2 16.8 16.8"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function CaptureToolIcon({ mode }: { mode:"crop" | "region" | "click" }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
    {mode === "crop" ? <><path d="M4 8h4l2-3h4l2 3h4v12H4z"/><circle cx="12" cy="14" r="3"/></> : mode === "region" ? <><path d="M9 4H4v5m11-5h5v5M4 15v5h5m6 0h5v-5"/><rect x="7" y="7" width="10" height="10" rx="1"/></> : <><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3"/></>}
  </svg>;
}
