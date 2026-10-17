import { useEffect, useRef, useState } from "react";
import { LiveDictation } from "./live-dictation";

type Phase = "idle" | "requesting" | "recording" | "transcribing";

export function IntentVoiceInput({ disabled, onText, onBusyChange }: {
  disabled: boolean;
  onText: (text: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [needsModel, setNeedsModel] = useState(false);
  const mounted = useRef(true);
  const cleanup = useRef<(() => void) | null>(null);
  const stop = useRef<(() => Promise<void>) | null>(null);
  const callbacks = useRef({ onText, onBusyChange });
  callbacks.current = { onText, onBusyChange };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cleanup.current?.(); stop.current = null; };
  }, []);

  const start = async () => {
    setError(null); setNeedsModel(false); setPhase("requesting");
    callbacks.current.onBusyChange(true);
    let input: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      const model = await window.skillRecorder.narrationStatus();
      if (!mounted.current) return;
      if (model.model !== "ready") {
        setNeedsModel(true);
        throw new Error("语音模型尚未就绪，请先在语音设置中完成下载。");
      }
      const microphone = await window.skillRecorder.microphoneSettings();
      if (!mounted.current) return;
      input = await navigator.mediaDevices.getUserMedia({ audio: {
        deviceId: microphone.selectedDeviceId === "default" ? undefined : { exact: microphone.selectedDeviceId },
        channelCount: 1, echoCancellation: true, noiseSuppression: true,
      } });
      if (!mounted.current) { input.getTracks().forEach(track => track.stop()); return; }
      context = new AudioContext({ sampleRate: 16000 });
      const audioContext = context;
      const audioStream = input;
      let interval: ReturnType<typeof setInterval> | undefined;
      let limit: ReturnType<typeof setTimeout> | undefined;
      let stopping = false;
      let disposed = false;
      cleanup.current = () => {
        disposed = true;
        clearInterval(interval); clearTimeout(limit);
        audioStream.getTracks().forEach(track => { track.onended = null; track.stop(); });
        void audioContext.close().catch(() => undefined);
      };
      await context.audioWorklet.addModule(new URL("./intent-audio-worklet.js?no-inline", import.meta.url).href);
      if (!mounted.current) { cleanup.current?.(); return; }
      const source = context.createMediaStreamSource(input);
      const capture = new AudioWorkletNode(context, "intent-audio-capture");
      const mute = context.createGain(); mute.gain.value = 0;
      source.connect(capture).connect(mute).connect(context.destination);
      const dictation = new LiveDictation(samples => window.skillRecorder.transcribeIntent(samples), text => {
        if (mounted.current && !disposed) callbacks.current.onText(text);
      });
      let flushed: (() => void) | undefined;
      capture.port.onmessage = event => {
        if (event.data === "flushed") flushed?.();
        else if (!disposed) dictation.add(event.data as Float32Array);
      };
      const finish = async () => {
        if (stopping || disposed) return;
        stopping = true;
        clearInterval(interval); clearTimeout(limit);
        if (mounted.current) setPhase("transcribing");
        try {
          // Drain the audio thread before releasing the microphone.
          await new Promise<void>(resolve => {
            const timeout = setTimeout(resolve, 500);
            flushed = () => { clearTimeout(timeout); resolve(); };
            capture.port.postMessage("flush");
          });
          source.disconnect();
          audioStream.getTracks().forEach(track => { track.onended = null; track.stop(); });
          if (mounted.current && !disposed) await dictation.finish();
        } catch (err) {
          if (mounted.current) setError(err instanceof Error ? err.message : "语音转写失败，请重试。");
        } finally {
          cleanup.current?.(); stop.current = null;
          if (mounted.current) { setPhase("idle"); callbacks.current.onBusyChange(false); }
        }
      };
      stop.current = finish;
      interval = setInterval(() => { void dictation.preview().catch(err => {
        if (mounted.current) setError(err instanceof Error ? err.message : "语音转写失败，请重试。");
        void finish();
      }); }, 1500);
      limit = setTimeout(() => void finish(), 60_000);
      input.getAudioTracks().forEach(track => { track.onended = () => void finish(); });
      await context.resume();
      if (mounted.current) setPhase("recording");
    } catch (err) {
      cleanup.current?.();
      input?.getTracks().forEach(track => track.stop());
      if (context && context.state !== "closed") void context.close();
      if (!mounted.current) return;
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
      setError(denied ? "无法使用麦克风，请在系统设置中允许技能录制器访问麦克风。" : err instanceof Error ? err.message : "无法打开麦克风。");
      setPhase("idle"); callbacks.current.onBusyChange(false);
    }
  };

  return <>
    <button type="button" className={`intent-voice-button ${phase === "recording" ? "is-recording" : ""}`}
      disabled={disabled || phase === "requesting" || phase === "transcribing"}
      aria-pressed={phase === "recording"} onClick={phase === "recording" ? () => void stop.current?.() : () => void start()}>
      {phase === "recording" && <span className="intent-voice-dot" aria-hidden="true" />}
      {phase === "recording" ? "结束语音" : phase === "transcribing" ? "正在完成…" : phase === "requesting" ? "正在打开麦克风…" : "语音输入"}
    </button>
    <span className="intent-voice-feedback" role={error ? "alert" : "status"}>
      {error ?? (phase === "recording" ? "正在实时转写，最长 60 秒" : "")}
      {needsModel && <button type="button" onClick={() => void window.skillRecorder.openSettings("voice")}>语音设置</button>}
    </span>
  </>;
}
