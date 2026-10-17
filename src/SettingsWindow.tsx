import { useCallback, useEffect, useRef, useState } from "react";
import { settingsSection, type SettingsSection } from "../common/settings";
import type { ProcessingStatus } from "../common/agents";
import type {
  NarrationStatus,
  RecorderStatus,
  SensitiveModelStatus,
} from "../common/ipc";
import {
  SENSEVOICE_LANGUAGES,
  narrationLanguageLabel,
  type NarrationLanguage,
} from "../common/narration";
import { AiSettingsPanel } from "./AiSettingsPanel";
import { BrowserSettingsPanel } from "./BrowserSettingsPanel";
import { ProcessingSettingsPanel } from "./ProcessingSettingsPanel";
import type { SettingsFormState } from "./settings-form";

const sections: { id: SettingsSection; label: string; description: string }[] =
  [
    {
      id: "general",
      label: "通用",
      description: "统一查看配置概况，选择分类管理具体设置。",
    },
    {
      id: "browser",
      label: "浏览器插件",
      description: "管理 Chrome 和 Edge 的插件安装、连接与录制状态。",
    },
    {
      id: "ai",
      label: "AI 模型",
      description: "配置 OpenAI 兼容 API，作为后备或主动选择的处理后端。",
    },
    {
      id: "agent",
      label: "Agent 能力",
      description: "管理本地 Agent、专用环境及从全局配置选择的 MCP / Skills。",
    },
    {
      id: "voice",
      label: "语音转写",
      description: "管理默认转写语言与 SenseVoice 本地语音模型。",
    },
    {
      id: "privacy",
      label: "隐私保护",
      description: "管理本地屏幕文本保护与隐私模型。",
    },
  ];
export function SettingsWindow() {
  const [section, setSection] = useState(() =>
    settingsSection(window.location.hash.split("/")[1]),
  );
  const [pending, setPending] = useState<SettingsSection | "close" | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const form = useRef<SettingsFormState | null>(null);
  const content = useRef<HTMLDivElement>(null);
  const onFormState = useCallback((state: SettingsFormState) => {
    form.current = state;
    setBusy(state.busy);
  }, []);
  const navigate = useCallback((target: SettingsSection | "close") => {
    if (target === "close") {
      void window.skillRecorder.closeSettings();
      return;
    }
    form.current = null;
    setBusy(false);
    setSection(target);
    window.location.hash = `settings/${target}`;
    content.current?.scrollTo(0, 0);
  }, []);
  const request = useCallback(
    (target: SettingsSection | "close") => {
      if (form.current?.busy) return;
      if (form.current?.dirty) setPending(target);
      else navigate(target);
    },
    [navigate],
  );
  useEffect(() => {
    const close = window.skillRecorder.onSettingsCloseRequested(() =>
      request("close"),
    );
    const change = window.skillRecorder.onSettingsSection((target) =>
      request(target),
    );
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (saving) return;
        if (pending) setPending(null);
        else request("close");
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      close();
      change();
      window.removeEventListener("keydown", key);
    };
  }, [request, pending, saving]);
  const current = sections.find((s) => s.id === section)!;
  return (
    <div className="settings-window">
      <aside className="settings-sidebar" inert={!!pending}>
        <h1>设置</h1>
        <button
          className="settings-back"
          disabled={busy}
          onClick={() => request("close")}
        >
          ‹ 返回应用
        </button>
        <nav aria-label="设置分类">
          {sections.map((s) => (
            <button
              key={s.id}
              disabled={busy}
              aria-current={section === s.id ? "page" : undefined}
              onClick={() => {
                if (section !== s.id) request(s.id);
              }}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <p>
          所有页面共用这些配置
          <br />
          不会自动修改当前任务
        </p>
      </aside>
      <main className="settings-main" inert={!!pending}>
        <header className="settings-header">
          <span>设置 / {current.label}</span>
          <button
            disabled={busy}
            aria-label="关闭设置"
            onClick={() => request("close")}
          >
            ×
          </button>
        </header>
        <div className="settings-content" ref={content}>
          <h2>{current.label}</h2>
          <p className="settings-description">{current.description}</p>
          {section === "general" && <GeneralSettings onNavigate={request} />}
          {section === "browser" && <BrowserSettingsPanel />}
          {section === "ai" && (
            <>
              <p className="settings-notice">
                本地 Agent 也能完成分析、增强和生成。处理策略及启用能力在{" "}
                <button className="linky" onClick={() => request("agent")}>
                  Agent 能力
                </button>{" "}
                中设置。API 保存不代表连接已经验证。
              </p>
              <AiSettingsPanel embedded onFormState={onFormState} />
            </>
          )}
          {section === "agent" && (
            <ProcessingSettingsPanel embedded onFormState={onFormState} />
          )}
          {(section === "voice" || section === "privacy") && (
            <CaptureSettings key={section} kind={section} onFormState={onFormState} />
          )}
        </div>
        <footer className="settings-footer">
          <span>
            {busy
              ? "操作中，请稍候…"
              : "设置只影响后续任务；关闭后回到原界面。"}
          </span>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => request("close")}
          >
            完成并返回
          </button>
        </footer>
      </main>
      {pending && (
        <div className="settings-confirm-scrim">
          <section
            className="settings-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="settings-unsaved-title"
          >
            <h2 id="settings-unsaved-title">有尚未保存的更改</h2>
            <p>离开前是否保存当前分类的设置？</p>
            <div className="processing-actions">
              <button
                className="secondary"
                disabled={saving}
                autoFocus
                onClick={() => setPending(null)}
              >
                继续编辑
              </button>
              <button
                className="secondary"
                disabled={saving}
                onClick={() => {
                  const target = pending;
                  setPending(null);
                  navigate(target);
                }}
              >
                放弃更改
              </button>
              <button
                className="record-cta"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  const target = pending;
                  try {
                    if (await form.current?.save()) {
                      setPending(null);
                      navigate(target);
                    } else setPending(null);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "保存中…" : "保存并离开"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function GeneralSettings({
  onNavigate,
}: {
  onNavigate: (s: SettingsSection) => void;
}) {
  const [processing, setProcessing] = useState<ProcessingStatus | null>(null);
  const [ai, setAi] = useState("");
  const [browser, setBrowser] = useState("");
  const [privacy, setPrivacy] = useState("");
  const [voice, setVoice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    const failed = () => {
      if (live) setError("部分状态读取失败，请进入对应分类重新检查。");
    };
    void window.skillRecorder
      .processing({ kind: "status" })
      .then((r) => {
        if (live) setProcessing(r.status ?? null);
      })
      .catch(failed);
    void window.skillRecorder
      .aiSettings()
      .then((s) => {
        if (live)
          setAi(s.configured ? "API 已保存 · 连接未验证" : "尚未配置 API");
      })
      .catch(failed);
    void window.skillRecorder
      .browserStatus()
      .then((s) => {
        if (live)
          setBrowser(
            s.error
              ? "浏览器桥连接异常"
              : s.connected
                ? "已有浏览器连接"
                : "尚未检测到连接",
          );
      })
      .catch(failed);
    void window.skillRecorder.narrationStatus().then((s) => {
      if (live) setVoice(s.model === "ready" ? "本地模型已就绪" : s.phase === "downloading" ? "模型下载中" : "模型未就绪");
    }).catch(failed);
    void window.skillRecorder
      .sensitiveModelStatus()
      .then((s) => {
        if (live) setPrivacy(s.enabled ? "隐私保护已开启" : "隐私保护已关闭");
      })
      .catch(failed);
    return () => {
      live = false;
    };
  }, []);
  const workspace = processing?.settings.workspaces.find(
    (w) => w.id === processing.settings.defaultProcessingWorkspaceId,
  );
  return (
    <div className="settings-overview">
      {error && (
        <p className="settings-notice" role="status">
          {error}
        </p>
      )}
      {[
        { id: "browser" as const, label: "浏览器插件", note: browser },
        { id: "ai" as const, label: "AI 模型", note: ai },
        {
          id: "agent" as const,
          label: "Agent 能力",
          note: processing
            ? `${processing.backend === "api" ? "模型 API" : "Claude Code"} · ${processing.ready ? "已就绪" : "需要配置"}${workspace ? ` · ${workspace.name}` : ""}`
            : "正在检查…",
        },
        { id: "voice" as const, label: "语音转写", note: voice },
        { id: "privacy" as const, label: "隐私保护", note: privacy },
      ].map((s) => (
        <button
          key={s.id}
          className="settings-overview-row"
          onClick={() => onNavigate(s.id)}
        >
          <span>
            <strong>{s.label}</strong>
            <small>{s.note || "正在读取…"}</small>
          </span>
          <span aria-hidden>›</span>
        </button>
      ))}
    </div>
  );
}
function CaptureSettings({
  kind,
  onFormState,
}: {
  kind: "voice" | "privacy";
  onFormState: (s: SettingsFormState) => void;
}) {
  const [voice, setVoice] = useState<NarrationStatus | null>(null);
  const [privacy, setPrivacy] = useState<SensitiveModelStatus | null>(null);
  const [recorder, setRecorder] = useState<RecorderStatus | null>(null);
  const [language, setLanguage] = useState<NarrationLanguage | "">("");
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    const failed = () => {
      if (live) setMessage("无法加载部分设置，请关闭后重新打开设置页。");
    };
    if (kind === "voice") void window.skillRecorder
      .narrationStatus()
      .then((s) => {
        if (live) setVoice(s);
      })
      .catch(failed);
    if (kind === "privacy") void window.skillRecorder
      .sensitiveModelStatus()
      .then((s) => {
        if (live) {
          setPrivacy(s);
          setEnabled(s.enabled);
        }
      })
      .catch(failed);
    void window.skillRecorder
      .status()
      .then((s) => {
        if (live) {
          setRecorder(s);
          setLanguage(s.narrationLanguage);
        }
      })
      .catch(failed);
    const off1 = window.skillRecorder.onNarrationStatusChanged(setVoice),
      off2 = window.skillRecorder.onSensitiveModelStatusChanged(setPrivacy),
      off3 = window.skillRecorder.onStatusChanged(setRecorder);
    return () => {
      live = false;
      off1();
      off2();
      off3();
    };
  }, []);
  const locked =
    !recorder ||
    recorder.state === "recording" ||
    recorder.transition !== "none";
  const dirty =
    kind === "voice"
      ? !!recorder && language !== recorder.narrationLanguage
      : !!privacy && enabled !== privacy.enabled;
  async function save() {
    if (locked || (kind === "voice" ? !language : enabled === null)) {
      setMessage("停止录制后才可修改这些设置。");
      return false;
    }
    setBusy(true);
    setMessage("");
    try {
      if (kind === "voice" && language && language !== recorder!.narrationLanguage) {
        const r = await window.skillRecorder.setNarrationLanguage(language);
        if (!r.ok) throw new Error(r.error || "语言保存失败。");
        setRecorder(await window.skillRecorder.status());
      }
      if (kind === "privacy" && enabled !== null && enabled !== privacy!.enabled) {
        const r = await window.skillRecorder.setAdvancedProtection(enabled);
        if (!r.ok) throw new Error(r.error || "隐私设置保存失败。");
        setPrivacy(await window.skillRecorder.sensitiveModelStatus());
      }
      setMessage("设置已保存。");
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存失败。");
      return false;
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    onFormState({ dirty, busy, save });
  });
  async function download(kind: "voice" | "privacy") {
    setBusy(true);
    setMessage("");
    try {
      const r = await (kind === "voice"
        ? window.skillRecorder.downloadNarrationModel()
        : window.skillRecorder.downloadSensitiveModels());
      if (!r.ok) setMessage(r.error || "下载失败。");
    } catch {
      setMessage("下载失败，请重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-privacy">
      {locked && (
        <p className="settings-notice">
          录制进行中或正在切换状态：这些配置暂不可修改。
        </p>
      )}
      {kind === "voice" && <>
      <section className="settings-card">
        <div className="settings-card-title">
          <h3>语音转写</h3>
          <span>
            {voice?.model === "ready"
              ? "已就绪 · 本地处理"
              : voice?.phase === "downloading"
                ? `下载中 ${voice.progress ?? ""}%`
                : "需要下载模型"}
          </span>
        </div>
        <p>SenseVoice 多语言本地模型</p>
        {voice?.model !== "ready" && (
          <button
            className="secondary"
            disabled={busy || locked}
            onClick={() => void download("voice")}
          >
            下载 / 重试
          </button>
        )}
      </section>
      <label className="settings-field">
        默认转写语言
        <select
          value={language}
          disabled={locked || busy}
          onChange={(e) => setLanguage(e.target.value as NarrationLanguage)}
        >
          <option value="" disabled>
            正在读取…
          </option>
          {SENSEVOICE_LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {narrationLanguageLabel(l.code)}
            </option>
          ))}
        </select>
      </label>
      <p className="settings-description">旁白开关和麦克风仍可在首页快速选择。</p>
      </>}
      {kind === "privacy" && <section className="settings-card">
        <div className="settings-card-title">
          <h3>隐私保护</h3>
          <label>
            <input
              type="checkbox"
              disabled={locked || busy || enabled === null}
              checked={enabled ?? false}
              onChange={(e) => setEnabled(e.target.checked)}
            />{" "}
            开启本地屏幕文本保护
          </label>
        </div>
        <p>
          模型：
          {privacy?.ocr === "ready"
            ? "已就绪"
            : privacy?.ocr === "downloading"
              ? `下载中 ${privacy.progress ?? ""}%`
              : "尚未就绪"}
        </p>
        <p>
          关闭此选项会减少截图中的文本保护；录制材料仍按现有隐私处理流程扫描。
        </p>
        {privacy?.ocr !== "ready" && (
          <button
            className="secondary"
            disabled={busy || locked}
            onClick={() => void download("privacy")}
          >
            下载隐私模型 / 重试
          </button>
        )}
      </section>}
      <div className="settings-save-bar">
        <span>{message || (dirty ? "有尚未保存的更改" : "设置已保存")}</span>
        <button
          className="secondary"
          disabled={busy || locked || !dirty}
          onClick={() => void save()}
        >
          保存设置
        </button>
      </div>
    </div>
  );
}
