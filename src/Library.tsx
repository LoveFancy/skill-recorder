import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { Analysis, AnalysisStep } from "../common/analysis";
import type {
  AnalyzeProgress,
  AutomationBuildProgress,
  NarrationStatus,
  SensitiveReport,
  SessionSummary,
  SkillBuildProgress,
  SkillPlacement,
  SkillPreview,
} from "../common/ipc";
import { AiSettingsPanel } from "./AiSettingsPanel";
import type {
  BuildTarget,
  BuiltSkill,
  SkillArchitecture,
  SkillPlan,
} from "../common/skill";
import {
  ARCHITECTURES,
  DEFAULT_TARGET,
  TARGETS,
  buildTargetFor,
} from "../common/skill";
import type { AutomationPlan, BuiltAutomation } from "../common/automation";
import {
  DEFAULT_NARRATION_LANGUAGE,
  NARRATION_MODEL_DOWNLOAD_LABEL,
  narrationLanguageLabel,
} from "../common/narration";
import {
  AnalysisStepTiles,
  AutomationStepTiles,
  EditableText,
  ScheduleEditor,
  SkillStepTiles,
} from "./plan-edit";
import { formatBytes, formatDur, formatWhen, shortLabel } from "./format";
import { skillPlacementModel, skillTargetFor } from "./skill-placement";
import { SkillReviewModal } from "./SkillReviewModal";
import { initialSkillReviewState, SkillOperationGuard, skillReviewBusy, skillReviewReducer } from "./skill-review-state";
import { SensitiveReview } from "./SensitiveReview";
import { AnalysisRecovery, type AnalysisRun } from "./analysis-recovery";

export function Library() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [narrationStatus, setNarrationStatus] = useState<NarrationStatus | null>(null);

  const loadSessions = useCallback(async () => {
    const list = await window.skillRecorder.listSessions();
    setSessions(list);
    setLoaded(true);
    setSelectedId((prev) => prev ?? list[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void loadSessions();
    return window.skillRecorder.onStatusChanged((s) => {
      if (s.state !== "recording") void loadSessions();
    });
  }, [loadSessions]);

  useEffect(() => {
    void window.skillRecorder.narrationStatus().then(setNarrationStatus);
    return window.skillRecorder.onNarrationStatusChanged((next) => {
      setNarrationStatus(next);
      if (next.phase === "idle") void loadSessions();
    });
  }, [loadSessions]);

  const deleteSession = useCallback(async (id: string) => {
    setNotice(null);
    const res = await window.skillRecorder.deleteSession(id);
    if (!res.ok) {
      setNotice(res.error ?? "无法删除这条录制。");
      return;
    }
    setSessions((prev) => {
      const idx = prev.findIndex((s) => s.id === id);
      const next = prev.filter((s) => s.id !== id);
      setSelectedId((cur) => {
        if (cur !== id) return cur;
        if (next.length === 0) return null;
        return (next[idx] ?? next[next.length - 1]).id;
      });
      return next;
    });
  }, []);

  const selected = sessions.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="lib">
      <aside className="lib-list">
        <div className="lib-list-head">
          <span className="eyebrow">录制记录</span>
          <span className="pill">{sessions.length}</span>
        </div>
        {notice && (
          <button className="sess-notice" onClick={() => setNotice(null)} title="关闭提示">
            {notice}
          </button>
        )}
        <div className="lib-list-scroll">
          <SessionsList
            sessions={sessions}
            loaded={loaded}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDelete={deleteSession}
          />
        </div>
      </aside>
      <main className="lib-detail">
        {selected ? (
          <AnalysisWorkspace
            key={selected.id}
            summary={selected}
            narrationStatus={narrationStatus}
            onChanged={loadSessions}
          />
        ) : (
          <div className="detail-empty">
            <span className="eyebrow">未选择录制</span>
            <p>选择左侧录制，查看分析出的任务目标和操作步骤。</p>
          </div>
        )}
      </main>
    </div>
  );
}

/* --- Sessions list -------------------------------------------------------- */

function SessionsList({
  sessions,
  loaded,
  selectedId,
  onSelect,
  onDelete,
}: {
  sessions: SessionSummary[];
  loaded: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void | Promise<void>;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (sessions.length === 0) {
    return <p className="sessions-empty">{loaded ? "暂无录制。" : "正在加载…"}</p>;
  }
  return (
    <ul className="sess-list">
      {sessions.map((s) =>
        confirmId === s.id ? (
          <li key={s.id}>
            <div className="sess-confirm" role="alertdialog" aria-label="确认删除">
              <div className="sess-confirm-text">
                <span className="sess-confirm-title">删除这条录制？</span>
                <span className="sess-confirm-sub">
                  This cannot be undone.
                  {s.sizeBytes != null && ` 可释放 ${formatBytes(s.sizeBytes)} 本机空间。`}
                </span>
              </div>
              <div className="sess-confirm-actions">
                <button className="linky" onClick={() => setConfirmId(null)}>取消</button>
                <button
                  className="danger"
                  onClick={() => {
                    setConfirmId(null);
                    void onDelete(s.id);
                  }}
                >删除</button>
              </div>
            </div>
          </li>
        ) : (
          <li key={s.id}>
            <div className="sess-row">
              <button
                className={`sess ${s.id === selectedId ? "on" : ""}`}
                onClick={() => onSelect(s.id)}
              >
                <div className="sess-top">
                  <span className="sess-when">{formatWhen(s.startedAt)}</span>
                  <span className="sess-tags">
                    {s.hasSkill && <span className="tag ok">技能</span>}
                    {s.hasAutomation && <span className="tag auto">自动化</span>}
                    {!s.hasSkill && !s.hasAutomation && s.analysis && (
                      <span className="tag an">已分析</span>
                    )}
                    {!s.hasSkill && !s.hasAutomation && !s.analysis && !s.processed && (
                      <span className="tag warn">处理中</span>
                    )}
                    {!s.hasSkill && !s.hasAutomation && !s.analysis && s.processed && (
                      <span className="tag recorded">已录制</span>
                    )}
                  </span>
                </div>
                <div className="sess-intent">
                  {s.analysis
                    ? s.analysis.title?.trim() || shortLabel(s.analysis.intent)
                    : "尚未分析"}
                </div>
                <div className="sess-sub">
                  {s.durationMs != null && <span>{formatDur(s.durationMs)}</span>}
                  {s.sizeBytes != null && (
                    <span
                      className="sess-size"
                      title={`本条录制占用 ${s.sizeBytes.toLocaleString()} 字节`}
                    >
                      {formatBytes(s.sizeBytes)}
                    </span>
                  )}
                  {s.analysis && <span>{s.analysis.stepCount} steps</span>}
                  {s.hasVideo && <span>视频</span>}
                  {s.hasAudio && !s.hasNarration && <span>旁白待转写</span>}
                  {s.hasNarration && <span>旁白</span>}
                </div>
              </button>
              <button
                className="sess-del"
                aria-label={`删除 ${formatWhen(s.startedAt)} 的录制`}
                title="删除录制"
                onClick={() => setConfirmId(s.id)}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path
                    d="M3 4.5h10M6.4 4.5V3.3c0-.44.36-.8.8-.8h1.6c.44 0 .8.36.8.8v1.2M4.7 4.5l.5 8.2c.02.42.37.75.8.75h4c.42 0 .77-.33.8-.75l.5-8.2"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </li>
        ),
      )}
    </ul>
  );
}

/* --- Analysis workspace --------------------------------------------------- */

const DownloadGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M8 2.6v6.2m0 0 2.3-2.3M8 8.8 5.7 6.5"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M3.2 10.4v1.2c0 .6.5 1.1 1.1 1.1h7.4c.6 0 1.1-.5 1.1-1.1v-1.2"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SavedGlyph = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path
      d="M3.4 8.4 6.3 11.3 12.6 4.8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * Subtle, per-recording "下载诊断包" affordance shown in the session
 * header. A quiet download icon packages the whole session (private capture data)
 * into a `.zip` the user can hand to us; a privacy-warning modal gates the actual
 * download. It says nothing about where to send the file — that's shared separately.
 */
function DebugDownload({ sessionId }: { sessionId: string }) {
  const [phase, setPhase] = useState<"idle" | "confirm" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  const download = useCallback(async () => {
    setPhase("saving");
    setErrorMsg("");
    const res = await window.skillRecorder.exportDebugBundle(sessionId);
    if (res.ok) setPhase("saved");
    else if (res.canceled) setPhase("idle");
    else {
      setErrorMsg(res.error ?? "无法创建诊断包。");
      setPhase("error");
    }
  }, [sessionId]);

  // Let the "已保存" acknowledgement fade back to the quiet icon on its own.
  useEffect(() => {
    if (phase !== "saved") return;
    const t = setTimeout(() => setPhase("idle"), 3200);
    return () => clearTimeout(t);
  }, [phase]);

  // While the warning is up, focus it and close on Escape — matching the app's sheets.
  useEffect(() => {
    if (phase !== "confirm") return;
    dialogRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPhase("idle");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  const label =
    phase === "saving"
      ? "正在生成诊断包…"
      : phase === "saved"
        ? "诊断包已保存"
        : "下载诊断详情";

  return (
    <div className="debug-dl">
      {phase === "error" && (
        <span className="debug-dl-note" title={errorMsg}>保存失败</span>
      )}
      <button
        className={`debug-dl-icon${phase === "saved" ? " is-saved" : ""}`}
        onClick={() => setPhase("confirm")}
        disabled={phase === "saving"}
        aria-label={label}
        title={label}
      >
        {phase === "saving" ? (
          <span className="spinner" aria-hidden />
        ) : phase === "saved" ? (
          <SavedGlyph />
        ) : (
          <DownloadGlyph />
        )}
      </button>

      {phase === "confirm" && (
        <div className="sheet-backdrop" onClick={() => setPhase("idle")}>
          <div
            ref={dialogRef}
            className="sheet debug-sheet"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="debug-dl-title"
            aria-describedby="debug-dl-desc"
            tabIndex={-1}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="sheet-head">
              <span className="sheet-icon" aria-hidden>
                <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
                  <rect
                    x="4.4"
                    y="8.7"
                    width="11.2"
                    height="7.9"
                    rx="1.9"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <path
                    d="M6.9 8.7V6.7a3.1 3.1 0 0 1 6.2 0v2"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                  <circle cx="10" cy="12.4" r="1.1" fill="currentColor" />
                </svg>
              </span>
              <h2 id="debug-dl-title">包含隐私信息</h2>
            </header>

            <p className="sheet-lead" id="debug-dl-desc">此诊断包包含本次录制的全部内容：视频、截图、访问网址、剪贴板、语音和转写。请仅分享给可信的人。</p>

            <div className="sheet-actions">
              <button className="linky" onClick={() => setPhase("idle")}>取消</button>
              <button className="record-cta" onClick={() => void download()}>下载 .zip</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AnalysisError({ error }: { error: string }) {
  return <div className="analysis-error"><p>{error}</p><AiSettingsPanel /></div>;
}

function AnalysisWorkspace({
  summary,
  narrationStatus,
  onChanged,
}: {
  summary: SessionSummary;
  narrationStatus: NarrationStatus | null;
  onChanged: () => void | Promise<void>;
}) {
  const sessionId = summary.id;
  const voicePending = summary.hasAudio && !summary.hasNarration;
  const voiceLanguage = narrationLanguageLabel(
    summary.narrationLanguage ?? DEFAULT_NARRATION_LANGUAGE,
  );
  const voiceBusy =
    narrationStatus?.activeSessionId === sessionId && narrationStatus.phase !== "idle";
  const voiceError =
    narrationStatus?.activeSessionId == null || narrationStatus.activeSessionId === sessionId
      ? narrationStatus?.error
      : null;
  const voiceStale =
    summary.analysis != null &&
    (summary.narrationSegmentCount ?? 0) > 0 &&
    summary.narrationUpdatedAt != null &&
    (summary.analysis.narrationSourceUpdatedAt == null ||
      summary.narrationUpdatedAt > summary.analysis.narrationSourceUpdatedAt);

  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const recovery = useRef(new AnalysisRecovery());
  const latestRun = useRef<AnalysisRun | null>(null);
  const workspaceLive = useRef(false);
  const [statusLine, setStatusLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Informational summary of what the on-device scan redacted before sending;
  // set alongside a successful analysis, cleared at the start of the next run.
  const [review, setReview] = useState<SensitiveReport | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftIntent, setDraftIntent] = useState("");
  const [confirmReanalysis, setConfirmReanalysis] = useState(false);
  // Directly-editable steps (the source of truth downstream); persisted on a short
  // debounce so typing stays instant. `stepsDirty` gates the persist so seeding from
  // a freshly loaded analysis never writes back.
  const [steps, setSteps] = useState<AnalysisStep[]>([]);
  const stepsDirty = useRef(false);
  const stepsRef = useRef<AnalysisStep[]>([]);
  stepsRef.current = steps;
  // The final stage: pick a target, then build a skill or an automation. A recording
  // that is already exactly one kind opens straight to it; otherwise it opens to the
  // analysis, where "创建…" starts the target picker.
  const initialLaunch: LaunchTarget =
    summary.hasSkill && !summary.hasAutomation
      ? "skill"
      : summary.hasAutomation && !summary.hasSkill
        ? "automation"
        : "none";
  const [launch, setLaunch] = useState<LaunchTarget>(initialLaunch);
  const [chosenArch, setChosenArch] = useState<SkillArchitecture>(DEFAULT_TARGET.architecture);
  useEffect(() => {
    workspaceLive.current = true;
    return () => {
      workspaceLive.current = false;
      recovery.current.invalidate();
    };
  }, [sessionId]);

  useEffect(() => {
    let live = true;
    void Promise.all([
      window.skillRecorder.getAnalysis(sessionId),
      window.skillRecorder.getSensitiveReport(sessionId),
    ]).then(([a, r]) => {
      if (!live) return;
      setAnalysis(a);
      setSteps(a?.steps ?? []);
      stepsDirty.current = false;
      // Rehydrate the redaction summary so it survives reopen (only when the session
      // is actually analyzed — never surface a stale report on an un-analyzed one).
      setReview(a ? r : null);
    });
    return () => {
      live = false;
    };
  }, [sessionId]);

  // Persist directly-edited steps on a short debounce (no agent, no re-analysis).
  useEffect(() => {
    if (!stepsDirty.current) return;
    const t = setTimeout(() => {
      stepsDirty.current = false;
      void window.skillRecorder.updateAnalysis({ sessionId, steps: stepsRef.current }).then((res) => {
        if (res.ok && res.analysis) setAnalysis(res.analysis);
        void onChanged();
      });
    }, 500);
    return () => clearTimeout(t);
  }, [steps, sessionId, onChanged]);

  // Flush any pending step edits when leaving this session, so nothing is lost.
  useEffect(() => {
    return () => {
      if (stepsDirty.current) {
        void window.skillRecorder.updateAnalysis({ sessionId, steps: stepsRef.current });
        stepsDirty.current = false;
      }
    };
  }, [sessionId]);

  const onStepsChange = useCallback((next: AnalysisStep[]) => {
    stepsDirty.current = true;
    setSteps(next);
  }, []);

  // Single latest status line (no growing log).
  useEffect(() => {
    return window.skillRecorder.onAnalyzeProgress((p: AnalyzeProgress) => {
      if (p.sessionId !== sessionId) return;
      setStatusLine(p.message);
      // The invocation, not a progress event, owns the busy state.
    });
  }, [sessionId]);

  const executeRun = useCallback(
    async (token: AnalysisRun) => {
      latestRun.current = token;
      setEditing(false);
      setDraftTitle("");
      setDraftIntent("");
      setReview(null);
      setError(null);
      setAnalyzing(true);
      setStatusLine("正在启动…");
      try {
        const res = await window.skillRecorder.analyze(sessionId);
        if (!workspaceLive.current || !recovery.current.accepts(token)) return;
        if (res.ok && res.analysis) {
          setAnalysis(res.analysis);
          setSteps(res.analysis.steps);
          stepsDirty.current = false;
          // Preserve the existing narration/redaction pipeline and result handling.
          setReview(res.review ?? null);
        } else {
          const message = res.error ?? "分析失败";
          setError(message);
        }
      } catch (err) {
        if (workspaceLive.current && recovery.current.accepts(token)) {
          const message = String(err);
          setError(message);
        }
      } finally {
        if (workspaceLive.current && recovery.current.isCurrent(token)) {
          recovery.current.finishRun(token);
          setAnalyzing(false);
          try {
            await onChanged();
          } catch (err) {
            // A refresh failure must not be mistaken for an interrupted analysis.
            if (workspaceLive.current && latestRun.current === token) {
                      setError(`无法刷新录制记录： ${String(err)}`);
            }
          }
        }
      }
    },
    [sessionId, onChanged],
  );

  const run = useCallback(async () => {
    const token = recovery.current.beginRun();
    if (token) await executeRun(token);
  }, [executeRun]);

  const cancel = useCallback(async () => {
    const token = latestRun.current;
    recovery.current.cancelRun();
    setStatusLine("正在停止…");
    try {
      await window.skillRecorder.cancelAnalysis(sessionId);
    } catch (err) {
      if (workspaceLive.current && latestRun.current === token) {
        setError(`无法取消分析： ${String(err)}`);
      }
    }
  }, [sessionId]);

  const startEdit = useCallback(() => {
    if (!analysis) return;
    setDraftTitle(analysis.title ?? "");
    setDraftIntent(analysis.intent);
    setError(null);
    setEditing(true);
  }, [analysis]);

  const saveEdit = useCallback(async () => {
    const res = await window.skillRecorder.updateAnalysis({
      sessionId,
      title: draftTitle.trim(),
      intent: draftIntent.trim() || undefined,
    });
    if (res.ok && res.analysis) {
      setAnalysis(res.analysis);
      setEditing(false);
    } else {
      setError(res.error ?? "无法保存修改");
    }
    void onChanged();
  }, [sessionId, draftTitle, draftIntent, onChanged]);

  if (launch === "picker") {
    return (
      <TargetPicker
        startedAt={summary.startedAt}
        onPick={(t) => {
          setChosenArch(t.architecture);
          setLaunch(t.kind);
        }}
        onClose={() => setLaunch("none")}
      />
    );
  }

  if (launch === "skill") {
    return (
      <SkillBuilderView
        sessionId={sessionId}
        architecture={chosenArch}
        startedAt={summary.startedAt}
        hasSkill={summary.hasSkill}
        onClose={() => {
          setLaunch("none");
          void onChanged();
        }}
      />
    );
  }

  if (launch === "automation") {
    return (
      <AutomationBuilderView
        sessionId={sessionId}
        architecture={chosenArch}
        startedAt={summary.startedAt}
        hasAutomation={summary.hasAutomation}
        onClose={() => {
          setLaunch("none");
          void onChanged();
        }}
      />
    );
  }

  return (
    <section className="ws">
      <div className="ws-head">
        <div className="ws-titles">
          <span className="eyebrow">分析</span>
          <span className="ws-when">{formatWhen(summary.startedAt)}</span>
        </div>
        <div className="ws-foot-actions">
          {analysis && !analyzing && summary.processed && (
            <button className="secondary" onClick={() => setConfirmReanalysis(true)}>重新分析</button>
          )}
          <DebugDownload sessionId={sessionId} />
        </div>
      </div>

      <div className="ws-body">
        {voicePending && voiceError && !analyzing && (
          <p className="voice-analysis-note">
            Couldn't transcribe your {voiceLanguage} voice, so this analysis doesn't include it.
            Your audio is saved — analyzing again will retry.
          </p>
        )}

        {analysis && !analyzing && (voiceStale || confirmReanalysis) && (
          <div className="voice-card">
            <div className="voice-card-copy">
              <strong>{confirmReanalysis ? "重新分析这条录制？" : "分析后新增了语音转写"}</strong>
              <span>录制内容将再次发送到配置的 AI 服务。分析成功后将替换当前摘要、步骤和编辑内容。</span>
            </div>
            {confirmReanalysis ? (
              <div className="voice-card-actions">
                <button className="linky" onClick={() => setConfirmReanalysis(false)}>取消</button>
                <button
                  className="secondary"
                  onClick={() => {
                    setConfirmReanalysis(false);
                    setEditing(false);
                    void run();
                  }}
                >替换分析</button>
              </div>
            ) : (
              <button className="secondary" onClick={() => setConfirmReanalysis(true)}>加入旁白重新分析</button>
            )}
          </div>
        )}

        {!summary.processed && (
          <p className="ws-note">录制仍在处理，请稍后再试。</p>
        )}

        {summary.processed && !analysis && !analyzing && (
          <div className="ws-empty">
            <p className="ws-empty-lead">逐步查看这条录制中的操作。</p>
            <button className="record-cta" onClick={() => void run()}>分析录制</button>
            <details className="analyze-disclosure">
              <summary>哪些内容会发送给 AI 服务</summary>
              <p>
                选择分析后，事件时间线、窗口标题、网址、剪贴板预览、屏幕截图、语音文本等内容将发送到配置的 AI 服务进行处理。{" "}
                <span className="cloud-analysis-caution">请勿分析可能包含密码、令牌、API 密钥、凭据或其他敏感机密信息的录制。</span>{" "}
                默认会先在本机隐藏文本和截图中的密码、密钥、邮箱及证件号码等敏感信息。可在“采集内容”中关闭保护，但它可能漏检，不能保证完全安全。
              </p>
            </details>
            {voicePending && (
              <p className="voice-analysis-note">
                {narrationStatus?.model === "ready"
                  ? `先将 ${voiceLanguage} 旁白转写为原语言文本，再进行分析。`
                  : `先将 ${voiceLanguage} 旁白转写为原语言文本，再进行分析。首次需下载 ${NARRATION_MODEL_DOWNLOAD_LABEL} 语音模型。`}
              </p>
            )}
          </div>
        )}

        {summary.processed && review && !analyzing && (
          <SensitiveReview report={review} onDismiss={() => setReview(null)} />
        )}

        {analyzing && (
          <div className="status-line">
            <span className="spinner" />
            <span className="status-text">
              {voiceBusy ? narrationWorkLabel(narrationStatus) : statusLine || "正在处理…"}
            </span>
            <button className="linky status-cancel" onClick={cancel}>取消</button>
          </div>
        )}

        {analyzing && narrationStatus?.phase === "downloading" && (
          <p className="voice-analysis-note">首次分析需下载约 250 MB 的语音模型，之后无需重复下载。</p>
        )}

        {error && (
          <AnalysisError
            error={error}
          />
        )}

        {analysis && !analyzing && (
          <div className="ws-read">
            <div className="summary">
              <div className="summary-head">
                <span className="eyebrow">操作概述</span>
                {!editing && (
                  <button className="linky" onClick={startEdit}>编辑</button>
                )}
              </div>

              {editing ? (
                <div className="summary-edit">
                  <label className="edit-field">
                    <span className="edit-label">名称</span>
                    <input
                      className="edit-title"
                      value={draftTitle}
                      placeholder="简短名称，例如：整理研究资料"
                      autoFocus
                      onChange={(e) => setDraftTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void saveEdit();
                        } else if (e.key === "Escape") setEditing(false);
                      }}
                    />
                    <span className="edit-hint">显示在录制记录列表中</span>
                  </label>
                  <label className="edit-field">
                    <span className="edit-label">目标</span>
                    <textarea
                      className="edit-intent"
                      value={draftIntent}
                      placeholder="用一句话描述任务目标"
                      onChange={(e) => setDraftIntent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setEditing(false);
                      }}
                    />
                  </label>
                  <div className="edit-actions">
                    <button className="linky" onClick={() => setEditing(false)}>取消</button>
                    <button className="secondary" onClick={() => void saveEdit()}>保存</button>
                  </div>
                </div>
              ) : (
                <>
                  <h2 className="summary-text">{analysis.intent}</h2>
                  {analysis.intentRationale && (
                    <p className="summary-why">{analysis.intentRationale}</p>
                  )}
                </>
              )}
            </div>

            <div className="story-edit">
              <div className="summary-head">
                <span className="eyebrow">步骤</span>
                <span className="edit-hint">点击步骤可编辑、排序、添加或删除，修改自动保存</span>
              </div>
              <AnalysisStepTiles sessionId={sessionId} steps={steps} onChange={onStepsChange} />
            </div>
          </div>
        )}
      </div>

      {analysis && !analyzing && (
        <div className="ws-foot">
          <span className="foot-status">{launchFootStatus(summary)}</span>
          <div className="ws-foot-actions">
            {summary.hasSkill && (
              <button className="secondary" onClick={() => setLaunch("skill")} title="打开基于这条录制创建的技能">打开技能 →</button>
            )}
            {summary.hasAutomation && (
              <button
                className="secondary"
                onClick={() => setLaunch("automation")}
                title="打开基于这条录制创建的自动化"
              >打开自动化 →</button>
            )}
            <button
              className="record-cta"
              onClick={() => setLaunch("picker")}
              title="将这条录制转换为技能或自动化"
            >
              {summary.hasSkill || summary.hasAutomation ? "再次创建 →" : "创建…"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function narrationWorkLabel(status: NarrationStatus | null): string {
  if (!status) return "正在处理…";
  if (status.phase === "transcribing") return "正在转写旁白…";
  if (status.phase === "loading") return "正在准备语音模型…";
  if (status.phase === "downloading") {
    return status.progress == null
      ? "正在下载语音模型…"
      : `正在下载语音模型… ${status.progress}%`;
  }
  return "正在处理…";
}

/* --- Final stage: target picker + builders -------------------------------- */

/** Which final-stage surface the analysis workspace is showing. */
type LaunchTarget = "none" | "picker" | "skill" | "automation";

function launchFootStatus(summary: SessionSummary): string {
  if (summary.hasSkill && summary.hasAutomation) return "技能与自动化已创建";
  if (summary.hasSkill) return "技能已创建";
  if (summary.hasAutomation) return "自动化已创建";
  return "";
}

/** "你希望创建什么？" — picks both kind and architecture up front. */
function TargetPicker({
  startedAt,
  onPick,
  onClose,
}: {
  startedAt: number | null;
  onPick: (target: BuildTarget) => void;
  onClose: () => void;
}) {
  return (
    <section className="ws">
      <div className="ws-head">
        <div className="ws-titles">
          <span className="eyebrow">创建</span>
          <span className="ws-when">{formatWhen(startedAt)}</span>
        </div>
        <button className="ghost" onClick={onClose} title="返回分析">取消</button>
      </div>
      <div className="ws-body">
        <div className="sb-arch">
          <p className="sb-lead">你希望基于这条录制创建什么？</p>
          <div className="arch-grid">
            {TARGETS.map((t) => (
              <button
                key={`${t.kind}:${t.architecture}`}
                className="arch-card"
                disabled={!t.enabled}
                onClick={() => t.enabled && onPick(t)}
              >
                <span className="arch-name">{t.label}</span>
                <span className="arch-note">{t.enabled ? t.note : "即将推出"}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* --- Skill builder ------------------------------------------------------- */

type BuildPhase = "loading" | "ready" | "planning" | "plan" | "creating" | "done";

function SkillBuilderView({
  sessionId,
  architecture: initialArch,
  startedAt,
  hasSkill,
  onClose,
}: {
  sessionId: string;
  architecture: SkillArchitecture;
  startedAt: number | null;
  hasSkill: boolean;
  onClose: () => void;
}) {
  const defaultPlacementFor = useCallback(
    (architecture: SkillArchitecture): SkillPlacement =>
      skillPlacementModel(skillTargetFor(architecture)).defaultPlacement,
    [],
  );
  // If this recording is already a skill, hold on a spinner until we've loaded it,
  // so we never flash the planning state before jumping to the skill.
  const [{ phase, preview, reviewOpen, statusLine, error }, dispatch] = useReducer(
    skillReviewReducer, hasSkill, initialSkillReviewState,
  );
  const [architecture, setArchitecture] = useState<SkillArchitecture>(initialArch);
  const [plan, setPlan] = useState<SkillPlan | null>(null);
  const [exportedPath, setExportedPath] = useState("");
  const [builtName, setBuiltName] = useState("");
  const operations = useRef(new SkillOperationGuard());
  const flowVersion = useRef(0);
  const stopping = useRef(false);
  const mounted = useRef(false);
  const previewRef = useRef<SkillPreview | null>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const reviewButtonRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<SkillPlacement>(() => defaultPlacementFor(initialArch));
  const placementModel = useMemo(() => skillPlacementModel(skillTargetFor(architecture)), [architecture]);

  const discardPreview = useCallback(async (id: string, reportError = false) => {
    const version = flowVersion.current;
    try {
      const result = await window.skillRecorder.discardSkillPreview(sessionId, id);
      if (!result.ok) throw new Error(result.error ?? "无法清除预览");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (reportError && mounted.current && flowVersion.current === version) {
        dispatch({ type: "error", error: message });
      }
      else console.warn("Could not discard skill preview", cause);
    }
  }, [sessionId]);

  const invalidatePreview = useCallback(() => {
    flowVersion.current++;
    const previous = previewRef.current;
    previewRef.current = null;
    dispatch({ type: "invalidate" });
    if (previous) void discardPreview(previous.id, true);
  }, [discardPreview]);

  const updatePlan = useCallback((part: Partial<SkillPlan>) => {
    invalidatePreview();
    setPlan((prev) => (prev ? { ...prev, ...part } : prev));
  }, [invalidatePreview]);

  // Leaving the builder (session switch or Close) discards an in-progress plan —
  // we don't save drafts — so stop any run that's still going in the background.
  useEffect(() => {
    mounted.current = true;
    const guard = operations.current;
    return () => {
      mounted.current = false;
      flowVersion.current++;
      if (guard.invalidate()) {
        void window.skillRecorder.cancelSkill(sessionId).then((result) => {
          if (!result.ok) throw new Error("无法取消技能生成");
        }).catch((cause: unknown) => {
          console.warn("Could not cancel skill work on departure", cause);
        });
      }
      const previous = previewRef.current;
      previewRef.current = null;
      if (previous) void discardPreview(previous.id);
    };
  }, [sessionId, discardPreview]);

  // Reopen straight to the exported state if this recording already has a skill.
  useEffect(() => {
    let live = true;
    const version = flowVersion.current;
    void window.skillRecorder.getSkill(sessionId).then((s: BuiltSkill | null) => {
      if (!live || flowVersion.current !== version) return;
      if (s?.exportedPath) {
        setBuiltName(s.name);
        setExportedPath(s.exportedPath);
        setArchitecture(s.architecture);
        // We don't persist how it was placed, so reopening infers the architecture's
        // current default placement from the manifest.
        setPlacement(defaultPlacementFor(s.architecture));
        if (s.plan) setPlan(s.plan);
        dispatch({ type: "done" });
      } else if (hasSkill) {
        // We expected a skill but couldn't load it; fall back to the ready screen.
        dispatch({ type: "settle", phase: "ready" });
      }
    }).catch((cause: unknown) => {
      if (live && flowVersion.current === version) dispatch({
        type: "settle", phase: "ready",
        error: cause instanceof Error ? cause.message : "无法打开技能",
      });
    });
    return () => {
      live = false;
    };
  }, [sessionId, hasSkill, defaultPlacementFor]);

  useEffect(() => {
    return window.skillRecorder.onSkillProgress((p: SkillBuildProgress) => {
      if (p.sessionId === sessionId && mounted.current && operations.current.busy && !stopping.current) {
        dispatch({ type: "progress", message: p.message });
      }
    });
  }, [sessionId]);

  const runPlan = useCallback(async () => {
    const operation = operations.current.begin();
    if (!operation) return;
    invalidatePreview();
    flowVersion.current++;
    dispatch({ type: "start", phase: "planning", message: "正在生成技能计划…" });
    try {
      const res = await window.skillRecorder.buildSkill({ sessionId, architecture });
      if (!mounted.current || !operations.current.isCurrent(operation)) return;
      if (res.ok && res.plan) {
        setPlan(res.plan);
        dispatch({ type: "settle", phase: "plan" });
      } else {
        dispatch({ type: "settle", phase: "ready", error: res.error ?? "计划生成失败" });
      }
    } catch (cause) {
      if (mounted.current && operations.current.isCurrent(operation)) {
        dispatch({ type: "settle", phase: "ready", error: cause instanceof Error ? cause.message : "计划生成失败" });
      }
    } finally {
      operations.current.finish(operation);
    }
  }, [sessionId, architecture, invalidatePreview]);

  const review = useCallback(async () => {
    if (!plan) return;
    dispatch({ type: "visibility", open: true });
    if (previewRef.current) return;
    const operation = operations.current.begin();
    if (!operation) return;
    flowVersion.current++;
    dispatch({ type: "start", phase: "preparing", message: "正在生成 SKILL.md 预览…" });
    try {
      const res = await window.skillRecorder.prepareSkill(sessionId, plan);
      if (!mounted.current || !operations.current.isCurrent(operation)) {
        if (res.preview) void discardPreview(res.preview.id);
        return;
      }
      if (res.ok && res.preview) {
        previewRef.current = res.preview;
        dispatch({ type: "preview", preview: res.preview });
      } else {
        dispatch({ type: "settle", phase: "plan", error: res.error ?? "无法生成预览" });
      }
    } catch (cause) {
      if (mounted.current && operations.current.isCurrent(operation)) {
        dispatch({ type: "settle", phase: "plan", error: cause instanceof Error ? cause.message : "无法生成预览" });
      }
    } finally {
      operations.current.finish(operation);
    }
  }, [sessionId, plan, discardPreview]);

  const place = useCallback(
    async (which: SkillPlacement) => {
      if (!plan) return;
      const operation = operations.current.begin();
      if (!operation) return;
      flowVersion.current++;
      dispatch({ type: "start", phase: "creating", message: which === "export" ? "正在导出技能…" : "正在生成技能…" });
      try {
        const res = await window.skillRecorder.createSkill(sessionId, plan, which, previewRef.current?.id);
        if (!mounted.current) return;
        if (res.ok && res.skill) {
          if (!operations.current.commit(operation)) return;
          setBuiltName(res.skill.name);
          setExportedPath(res.path ?? res.skill.exportedPath ?? "");
          setPlacement(res.placement ?? which);
          previewRef.current = null;
          dispatch({ type: "done" });
        } else {
          if (!operations.current.isCurrent(operation)) return;
          // Folder-picker cancellation and placement failures both retain the candidate.
          // An expired candidate must be reviewed again explicitly, never silently regenerated.
          if (res.previewExpired) previewRef.current = null;
          dispatch({
            type: "settle",
            phase: "plan",
            previewExpired: res.previewExpired,
            error: res.canceled ? undefined : res.error ?? "无法创建技能",
          });
        }
      } catch (cause) {
        if (mounted.current && operations.current.isCurrent(operation)) {
          dispatch({ type: "settle", phase: "plan", error: cause instanceof Error ? cause.message : "无法创建技能" });
        }
      } finally {
        operations.current.finish(operation);
      }
    },
    [sessionId, plan],
  );

  const cancelRun = useCallback(async () => {
    if (stopping.current || !operations.current.busy) return;
    const cancellation = operations.current.beginCancellation();
    if (!cancellation) return;
    stopping.current = true;
    flowVersion.current++;
    const { operation, originalSettled } = cancellation;
    dispatch({ type: "start", phase: "stopping", message: "正在停止…" });
    let error: string | undefined;
    try {
      const res = await window.skillRecorder.cancelSkill(sessionId);
      if (!res.ok) throw new Error("无法取消技能生成");
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "无法取消技能生成";
    }
    // Acknowledging cancellation only marks the backend operation. Its original
    // request may still own a model turn or an open native folder picker.
    try {
      await originalSettled;
      if (mounted.current && operations.current.isCurrent(operation)) {
        dispatch({ type: "settle", phase: plan ? "plan" : "ready", error });
      }
    } finally {
      operations.current.finish(operation);
      stopping.current = false;
    }
  }, [sessionId, plan]);

  const restoreReviewFocus = useCallback(() => {
    if (mounted.current) (doneRef.current ?? reviewButtonRef.current ?? workspaceRef.current)?.focus();
  }, []);
  useEffect(() => {
    if (phase === "done") doneRef.current?.focus();
  }, [phase]);
  const busy = skillReviewBusy(phase);

  return (
    <section className="ws skill-builder" ref={workspaceRef} tabIndex={-1}>
      <div className="ws-head">
        <div className="ws-titles">
          <span className="eyebrow">{phase === "done" ? "技能" : "创建技能"}</span>
          <span className="ws-when">{formatWhen(startedAt)}</span>
        </div>
        <button
          className="ghost"
          onClick={onClose}
          disabled={busy}
          title={phase === "done" ? "查看这条录制的分析" : "返回分析"}
        >
          {phase === "done" ? "分析" : "关闭"}
        </button>
      </div>

      <div className="ws-body">
        {error && <AnalysisError error={error} />}

        {phase === "loading" && (
          <div className="status-line">
            <span className="spinner" />
            <span className="status-text">正在打开技能…</span>
          </div>
        )}

        {phase === "ready" && (
          <div className="sb-arch">
            <p className="sb-lead">Build a {archLabel(architecture)} skill from this recording.</p>
            <button className="record-cta" onClick={() => void runPlan()}>生成技能计划 →</button>
          </div>
        )}

        {busy && (
          <div className="status-line" role="status">
            <span className="spinner" />
            <span className="status-text">{statusLine || "正在处理…"}</span>
            <button className="linky status-cancel" onClick={cancelRun} disabled={phase === "stopping"}>取消</button>
            {(phase === "preparing" || preview) && (
              <button className="ghost" ref={reviewButtonRef} onClick={() => dispatch({ type: "visibility", open: true })}>查看 SKILL.md</button>
            )}
          </div>
        )}

        {phase === "plan" && plan && (
          <div className="sb-plan">
            <div className="sb-planhead">
              <EditableText
                as="div"
                className="sb-title ed-title"
                value={plan.title}
                placeholder="技能标题"
                ariaLabel="技能标题"
                onChange={(v) => updatePlan({ title: v })}
              />
              <code className="sb-slug">{plan.name}</code>
            </div>
            <EditableText
              as="p"
              multiline
              className="sb-desc ed-desc"
              value={plan.description}
              placeholder="用一句话描述技能的用途"
              ariaLabel="技能描述"
              onChange={(v) => updatePlan({ description: v })}
            />

            <div className="sb-sec">
              <span className="eyebrow">技能将执行的操作</span>
              <p className="sb-refine-hint">点击步骤或高亮值进行编辑，也可排序、添加或删除。</p>
              <SkillStepTiles
                steps={plan.steps}
                onChange={(steps) => updatePlan({ steps })}
                values={plan.values}
                onChangeValues={(values) => updatePlan({ values })}
              />
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="sb-done" ref={doneRef} tabIndex={-1}>
            <div className="sb-check" aria-hidden>
              ✓
            </div>
            <h2 className="sb-title">
              {placement === "install" ? placementModel.installDoneTitle : "技能已导出"}
            </h2>
            <p>
              <code className="sb-slug">{builtName}</code>{" "}
              {placement === "install"
                ? placementModel.installDoneMessage
                : `适用于 ${archLabel(architecture)}。请安装到该智能体的技能目录。`}
            </p>
            {exportedPath && <p className="sb-path">{exportedPath}</p>}
          </div>
        )}
      </div>

      {phase === "plan" && plan && (
        <div className="ws-foot">
          <span className="foot-status" />
          <div className="ws-foot-actions">
            <button className="ghost" ref={reviewButtonRef} onClick={() => void review()}>查看 SKILL.md</button>
            {placementModel.actions.map((action) => (
              <button
                key={action.placement}
                className={action.primary ? "record-cta" : "ghost"}
                onClick={() => void place(action.placement)}
                title={action.title}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="ws-foot">
          <span className="foot-status">技能已创建</span>
          <div className="ws-foot-actions">
            {exportedPath && (
              <button className="record-cta" onClick={() => void window.skillRecorder.revealSkill(sessionId)}>在文件夹中显示</button>
            )}
          </div>
        </div>
      )}
      {reviewOpen && (
        <SkillReviewModal
          preview={preview}
          busy={busy}
          stopping={phase === "stopping"}
          statusLine={statusLine}
          error={error}
          placementModel={placementModel}
          onPlace={(which) => void place(which)}
          onPrepare={() => void review()}
          onCancel={() => void cancelRun()}
          onClose={() => dispatch({ type: "visibility", open: false })}
          restoreFocus={restoreReviewFocus}
        />
      )}
    </section>
  );
}

function archLabel(id: SkillArchitecture): string {
  return ARCHITECTURES.find((a) => a.id === id)?.label ?? id;
}

/* --- Automation builder --------------------------------------------------- */

function AutomationBuilderView({
  sessionId,
  architecture: initialArch,
  startedAt,
  hasAutomation,
  onClose,
}: {
  sessionId: string;
  architecture: SkillArchitecture;
  startedAt: number | null;
  hasAutomation: boolean;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<BuildPhase>(hasAutomation ? "loading" : "ready");
  const [architecture, setArchitecture] = useState<SkillArchitecture>(initialArch);
  const [plan, setPlan] = useState<AutomationPlan | null>(null);
  const [statusLine, setStatusLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [exportedPath, setExportedPath] = useState("");
  const [builtName, setBuiltName] = useState("");
  const canceled = useRef(false);
  const inFlight = useRef(false);
  // The initial architecture can reflect a prior skill choice while a saved automation loads.
  const automationInstallTargetLabel =
    phase === "done"
      ? buildTargetFor(architecture, "automation").installTargetLabel
      : "";

  const updatePlan = useCallback((part: Partial<AutomationPlan>) => {
    setPlan((prev) => (prev ? { ...prev, ...part } : prev));
  }, []);

  useEffect(() => {
    return () => {
      if (inFlight.current) void window.skillRecorder.cancelAutomation(sessionId);
    };
  }, [sessionId]);

  // Reopen straight to the exported state if this recording already has one.
  useEffect(() => {
    let live = true;
    void window.skillRecorder.getAutomation(sessionId).then((a: BuiltAutomation | null) => {
      if (!live) return;
      if (a?.exportedPath) {
        setBuiltName(a.name);
        setExportedPath(a.exportedPath);
        setArchitecture(a.architecture);
        if (a.plan) setPlan(a.plan);
        setPhase("done");
      } else if (hasAutomation) {
        setPhase("ready");
      }
    });
    return () => {
      live = false;
    };
  }, [sessionId, hasAutomation]);

  useEffect(() => {
    return window.skillRecorder.onAutomationProgress((p: AutomationBuildProgress) => {
      if (p.sessionId === sessionId) setStatusLine(p.message);
    });
  }, [sessionId]);

  const runPlan = useCallback(async () => {
    canceled.current = false;
    inFlight.current = true;
    setError(null);
    setStatusLine("正在生成自动化计划…");
    setPhase("planning");
    const res = await window.skillRecorder.buildAutomation({ sessionId, architecture });
    inFlight.current = false;
    if (res.ok && res.plan) {
      setPlan(res.plan);
      setPhase("plan");
    } else if (!canceled.current) {
      setError(res.error ?? "计划生成失败");
      setPhase("ready");
    }
  }, [sessionId, architecture]);

  const create = useCallback(async () => {
    if (!plan) return;
    canceled.current = false;
    inFlight.current = true;
    setError(null);
    setStatusLine("正在生成自动化…");
    setPhase("creating");
    const res = await window.skillRecorder.createAutomation(sessionId, plan);
    inFlight.current = false;
    if (res.ok && res.automation) {
      setBuiltName(res.automation.name);
      setExportedPath(res.path ?? res.automation.exportedPath ?? "");
      setPhase("done");
    } else if (!canceled.current) {
      setError(res.error ?? "无法创建自动化");
      setPhase("plan");
    }
  }, [sessionId, plan]);

  const cancelRun = useCallback(async () => {
    canceled.current = true;
    inFlight.current = false;
    setStatusLine("正在停止…");
    await window.skillRecorder.cancelAutomation(sessionId);
    setPhase(plan ? "plan" : "ready");
  }, [sessionId, plan]);

  const busy = phase === "planning" || phase === "creating";

  return (
    <section className="ws">
      <div className="ws-head">
        <div className="ws-titles">
          <span className="eyebrow">{phase === "done" ? "自动化" : "创建自动化"}</span>
          <span className="ws-when">{formatWhen(startedAt)}</span>
        </div>
        <button
          className="ghost"
          onClick={onClose}
          disabled={busy}
          title={phase === "done" ? "查看这条录制的分析" : "返回分析"}
        >
          {phase === "done" ? "分析" : "关闭"}
        </button>
      </div>

      <div className="ws-body">
        {error && <AnalysisError error={error} />}

        {phase === "loading" && (
          <div className="status-line">
            <span className="spinner" />
            <span className="status-text">正在打开自动化…</span>
          </div>
        )}

        {phase === "ready" && (
          <div className="sb-arch">
            <p className="sb-lead">Build a {archLabel(architecture)} automation from this recording.</p>
            <button className="record-cta" onClick={() => void runPlan()}>生成自动化计划 →</button>
          </div>
        )}

        {busy && (
          <div className="status-line">
            <span className="spinner" />
            <span className="status-text">{statusLine || "正在处理…"}</span>
            <button className="linky status-cancel" onClick={cancelRun}>取消</button>
          </div>
        )}

        {phase === "plan" && plan && (
          <div className="sb-plan">
            <div className="sb-planhead">
              <EditableText
                as="div"
                className="sb-title ed-title"
                value={plan.title}
                placeholder="自动化标题"
                ariaLabel="自动化标题"
                onChange={(v) => updatePlan({ title: v })}
              />
              <code className="sb-slug">{plan.name}</code>
            </div>
            <EditableText
              as="p"
              multiline
              className="sb-desc ed-desc"
              value={plan.description}
              placeholder="用一句话描述自动化的用途"
              ariaLabel="自动化描述"
              onChange={(v) => updatePlan({ description: v })}
            />

            <div className="sb-sec">
              <span className="eyebrow">执行时间</span>
              <p className="sb-refine-hint">录制本身没有执行计划，请设置自动化的执行时间。</p>
              <ScheduleEditor
                schedule={plan.trigger.schedule}
                onChange={(schedule) => updatePlan({ trigger: { ...plan.trigger, schedule } })}
              />
              {plan.trigger.type === "condition" && plan.trigger.condition && (
                <span className="trigger-cond">Only when: {plan.trigger.condition}</span>
              )}
            </div>

            <div className="sb-sec">
              <span className="eyebrow">自动化将执行的操作</span>
              <p className="sb-refine-hint">点击步骤或高亮值进行编辑，也可排序、添加或删除。</p>
              <AutomationStepTiles
                steps={plan.steps}
                onChange={(steps) => updatePlan({ steps })}
                values={plan.values}
                onChangeValues={(values) => updatePlan({ values })}
              />
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="sb-done">
            <div className="sb-check" aria-hidden>
              ✓
            </div>
            <h2 className="sb-title">自动化已就绪</h2>
            <p>
              <code className="sb-slug">{builtName}</code> is built for {archLabel(architecture)}.
            </p>
            {exportedPath && <p className="sb-path">{exportedPath}</p>}
            <p className="sb-import-hint">
              Import it into {automationInstallTargetLabel}: open{" "}
              {automationInstallTargetLabel} → Automations → Import, and choose this bundle
              folder.
            </p>
          </div>
        )}
      </div>

      {phase === "plan" && plan && (
        <div className="ws-foot">
          <span className="foot-status" />
          <div className="ws-foot-actions">
            <button
              className="record-cta"
              onClick={() => void create()}
              title="创建并导出自动化配置"
            >创建并导出自动化</button>
          </div>
        </div>
      )}

      {phase === "done" && (
        <div className="ws-foot">
          <span className="foot-status">自动化已创建</span>
          <div className="ws-foot-actions">
            {exportedPath && (
              <button
                className="record-cta"
                onClick={() => void window.skillRecorder.revealAutomation(sessionId)}
              >在文件夹中显示</button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
