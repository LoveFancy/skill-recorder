import { useEffect, useState } from "react";
import type { SensitiveModelStatus, StartOptions } from "../common/ipc";
import { RecordingPrivacyWarning } from "./RecordingPrivacyWarning";
import { WhatsRecorded } from "./WhatsRecorded";

export function RecordingPreparation() {
  const [starting, setStarting] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sensitive, setSensitive] = useState<SensitiveModelStatus | null>(null);
  useEffect(() => {
    void window.skillRecorder.sensitiveModelStatus().then(setSensitive);
    return window.skillRecorder.onSensitiveModelStatusChanged(setSensitive);
  }, []);

  const start = async (options: Pick<StartOptions, "intent" | "outputKind">) => {
    setStarting(true);
    setError(null);
    try {
      await window.skillRecorder.markRecordingPrivacyReviewed();
      const result = await window.skillRecorder.confirmStart(options);
      if (!result.ok) {
        setError(result.error ?? "无法开始录制，请重试。");
        setStarting(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法开始录制，请重试。");
      setStarting(false);
    }
  };

  return (
    <RecordingPrivacyWarning starting={starting} onStart={(options) => void start(options)}
      onClose={() => window.close()} error={error} detailsExpanded={detailsExpanded} onVoiceBusyChange={setVoiceBusy}
      disclosure={<WhatsRecorded inline compact disabled={voiceBusy || starting} onExpandedChange={setDetailsExpanded} sensitive={sensitive} onClose={() => {}} onReviewed={() => {}}
        onOpenSettings={() => void window.skillRecorder.openSettings("privacy")} />} />
  );
}
