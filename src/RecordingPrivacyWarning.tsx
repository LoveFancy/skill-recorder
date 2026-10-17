import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { StartOptions } from "../common/ipc";
import { IntentVoiceInput } from "./IntentVoiceInput";

export function RecordingPrivacyWarning({ starting, onStart, onReview, onClose, error, disclosure, detailsExpanded = false, onVoiceBusyChange }: {
  onVoiceBusyChange?: (busy: boolean) => void;
  detailsExpanded?: boolean;
  disclosure?: ReactNode;
  error?: string | null;
  starting: boolean;
  onStart: (options: Pick<StartOptions, "intent" | "outputKind">) => void;
  onReview?: () => void;
  onClose: () => void;
}) {
  const intentRef = useRef<HTMLTextAreaElement>(null);
  const [outputKind, setOutputKind] = useState<StartOptions["outputKind"]>();
  const [intent, setIntent] = useState("");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const voicePrefix = useRef("");
  const ready = !!outputKind && !!intent.trim() && !starting && !voiceBusy;

  useEffect(() => {
    intentRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !starting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, starting]);

  return (
    <div className="sheet-backdrop" onClick={starting ? undefined : onClose}>
      <form className={`recording-intent${detailsExpanded ? " details-expanded" : ""}`} role="dialog" aria-modal="true" aria-labelledby="recording-intent-title" aria-busy={starting}
        onClick={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); if (ready) onStart({ intent: intent.trim(), outputKind }); }}>
        <header className="recording-intent-head">
          <h2 id="recording-intent-title">{detailsExpanded ? "采集内容与隐私说明" : "这次想记录什么？"}</h2>
          <button type="button" className="intent-close" onClick={onClose} disabled={starting} aria-label="关闭">×</button>
        </header>

        <div className="recording-intent-body">
        <fieldset className="intent-output-options" disabled={starting}>
          <legend>希望产出什么</legend>
          {([ ["sop", "操作说明（SOP）"], ["skill", "可复用技能（Skill）"], ["manual", "使用手册"], ["undecided", "暂不确定"] ] as const).map(([value, label]) => (
            <label key={value} className={outputKind === value ? "selected" : ""}>
              <input type="radio" name="output-kind" checked={outputKind === value} onChange={() => setOutputKind(value)} />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        <label className="intent-goal">
          <span>你想让它帮你完成什么？</span>
          <div className="intent-textarea-shell">
          <textarea ref={intentRef} value={intent} maxLength={1200} disabled={starting} readOnly={voiceBusy} onChange={(event) => setIntent(event.target.value)}
            placeholder="例如：根据订单准备报价单，确认后发给客户。" />
          <IntentVoiceInput disabled={starting || (intent.length >= 1200 && !voiceBusy)} onBusyChange={(busy) => {
            if (busy) voicePrefix.current = `${intent}${intent && !/\s$/.test(intent) ? "\n" : ""}`;
            else intentRef.current?.focus();
            setVoiceBusy(busy); onVoiceBusyChange?.(busy);
          }} onText={(text) => setIntent(`${voicePrefix.current}${text}`.slice(0, 1200))} />
          </div>
        </label>

        {disclosure ?? (onReview && <button type="button" className="intent-disclosure" onClick={onReview}>查看本次会采集哪些内容</button>)}
        {error && <p className="intent-error" role="alert">{error}</p>}
        </div>
        <footer className="recording-intent-actions">
          <button type="button" className="linky" onClick={onClose} disabled={starting}>取消</button>
          <button type="submit" className="record-cta" disabled={!ready}>{starting ? "正在启动…" : "确认并开始录制"}</button>
        </footer>
      </form>
    </div>
  );
}
