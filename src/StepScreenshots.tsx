import type { CaptureRegion } from "../common/capture-region";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Screenshot = { timeMs: number; dataUrl: string; regions: CaptureRegion[] };
function ScreenshotImage({ frame }: { frame: Screenshot }) {
  return <div className="screenshot-image"><img src={frame.dataUrl} alt={`录制 ${timestamp(frame.timeMs)} 时的界面`} loading="lazy" />{frame.regions.map((box, i) => <span key={i} className="screenshot-region" style={{ left:`${box.x*100}%`, top:`${box.y*100}%`, width:`${box.width*100}%`, height:`${box.height*100}%` }} />)}</div>;
}
const timestamp = (ms: number) => `${Math.floor(ms / 60000)}:${(ms / 1000 % 60).toFixed(1).padStart(4, "0")}`;

export function StepScreenshots({ sessionId, startMs, endMs, excludedFiles }: { sessionId: string; startMs?: number; endMs?: number; excludedFiles?: string[] }) {
  const [frames, setFrames] = useState<Screenshot[]>([]);
  const [status, setStatus] = useState("正在加载截图…");
  const [selected, setSelected] = useState<Screenshot | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const exclusions = JSON.stringify(excludedFiles ?? []);
  useEffect(() => {
    let active = true;
    setFrames([]);
    setStatus("正在加载截图…");
    const request = excludedFiles?.length
      ? window.skillRecorder.stepScreenshots(sessionId, startMs, endMs, JSON.parse(exclusions))
      : window.skillRecorder.stepScreenshots(sessionId, startMs, endMs);
    void request.then(result => {
      if (!active) return;
      setFrames(result);
      setStatus(startMs === undefined ? "此步骤没有时间信息，无法匹配截图" : "此时间段没有对应截图");
    }).catch((error: unknown) => { if (active) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message.includes("No handler") || message.includes("is not a function") ? "截图接口尚未加载，请重启应用" : `截图加载失败：${message}`);
    } });
    return () => { active = false; };
  }, [sessionId, startMs, endMs, exclusions]);
  useEffect(() => {
    if (!selected) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
      if (event.key === "Tab") { event.preventDefault(); closeRef.current?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, [selected]);
  return <div className="step-screenshots">
    {frames.length ? <>
      <span className="step-screenshot-label">对应截图 · 点击放大</span>
      <div className="step-screenshot-row">{frames.map(frame => <button key={frame.timeMs} className="step-screenshot" onClick={() => setSelected(frame)} aria-label={`放大 ${timestamp(frame.timeMs)} 的截图`}>
        <ScreenshotImage frame={frame} />
        <span>{timestamp(frame.timeMs)}</span>
      </button>)}</div>
    </> : <span className="step-screenshot-label">{status}</span>}
    {selected && createPortal(<div className="screenshot-overlay" onClick={() => setSelected(null)}>
      <div className="screenshot-dialog" role="dialog" aria-modal="true" aria-label="查看步骤截图" onClick={event => event.stopPropagation()}>
        <div className="screenshot-dialog-head"><span>录制截图 · {timestamp(selected.timeMs)}</span><button ref={closeRef} onClick={() => setSelected(null)}>关闭</button></div>
        <ScreenshotImage frame={selected} />
      </div>
    </div>, document.body)}
  </div>;
}
