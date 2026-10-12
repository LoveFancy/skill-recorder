import { useEffect, useState } from "react";
import type { AiSettings } from "../common/ai";

export function AiSettingsPanel({ onSaved }: { onSaved?: () => void }) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let live = true;
    void window.skillRecorder.aiSettings().then((next) => {
      if (!live) return;
      setSettings(next); setBaseUrl(next.baseUrl); setModel(next.model);
    }).catch(() => { if (live) setMessage("无法加载 AI 设置。"); });
    return () => { live = false; };
  }, []);

  async function save() {
    setBusy(true); setMessage("");
    try {
      const result = await window.skillRecorder.saveAiSettings({ baseUrl, model,
        ...(clearKey ? { apiKey: "" } : key ? { apiKey: key } : {}),
      });
      if (!result.ok) { setMessage(result.error ?? "无法保存设置。"); return; }
      setSettings(result.settings ?? null); setKey(""); setClearKey(false);
      setMessage("设置已保存，可以重新发起分析或生成。"); onSaved?.();
    } catch { setMessage("无法保存 AI 设置。"); }
    finally { setBusy(false); }
  }

  return <details className="ai-settings">
    <summary>AI 设置</summary>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <p>使用支持工具调用和图片输入的 OpenAI 兼容接口。</p>
      <label>API 地址<input type="url" required value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" /></label>
      <label>模型<input required value={model} onChange={(event) => setModel(event.target.value)} placeholder="服务商提供的模型名称" /></label>
      <label>API 密钥<input type="password" autoComplete="off" value={key} disabled={clearKey} onChange={(event) => setKey(event.target.value)} placeholder={settings?.hasApiKey ? "已有密钥，留空保留" : "本地服务可留空"} /></label>
      {settings?.hasApiKey && <label className="ai-clear-key"><input type="checkbox" checked={clearKey} onChange={(event) => setClearKey(event.target.checked)} />删除已保存的密钥</label>}
      {settings?.environmentOverride && <p>环境变量优先于界面保存的设置。</p>}
      <button type="submit" className="row-action" disabled={busy}>{busy ? "正在保存…" : "保存设置"}</button>
      {message && <p role="status">{message}</p>}
    </form>
  </details>;
}
