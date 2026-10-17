import { useEffect, useState } from "react";
import type { BrowserStatus } from "../common/browser";

export function browserNote(status: BrowserStatus | null) {
  if (!status) return "检查中";
  if (status.error || status.browsers?.some((c) => c.error)) return "连接异常";
  if (!status.connected) return "未连接";
  return status.sessionId
    ? status.bound
      ? `正在录制 · ${status.eventCount} 条`
      : "正在准备网页采集"
    : "已连接";
}
export function BrowserSettingsPanel({
  summary = false,
}: {
  summary?: boolean;
}) {
  const [status, setStatus] = useState<BrowserStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      window.skillRecorder
        .browserStatus()
        .then((s) => {
          if (alive) setStatus(s);
        })
        .catch(() => {
          if (alive) setMessage("无法读取浏览器连接状态。");
        });
    void refresh();
    const timer = setInterval(refresh, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  async function refresh(reconnect = false) {
    setBusy(true);
    setMessage("");
    try {
      setStatus(
        await (reconnect
          ? window.skillRecorder.reconnectBrowser()
          : window.skillRecorder.browserStatus()),
      );
    } catch {
      setMessage("无法连接浏览器服务，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }
  if (summary)
    return (
      <button
        className="row settings-status-link"
        onClick={() => void window.skillRecorder.openSettings("browser")}
        title="打开浏览器插件设置"
      >
        <span
          className={`badge ${status?.error || status?.browsers?.some((c) => c.error) ? "bad" : status?.connected ? "good" : "warn"}`}
        >
          {status?.connected && !status.error ? "✓" : "!"}
        </span>
        <span className="row-label">浏览器插件</span>
        <span className="row-note">{message || browserNote(status)}</span>
      </button>
    );
  return (
    <section className="browser-settings settings-browser">
      <p className="settings-description">
        录制启动后覆盖浏览器中的多个标签页，无需逐页绑定。
      </p>
      {message && (
        <p className="analysis-error" role="alert">
          {message}
        </p>
      )}
      {(["chrome", "edge"] as const).map((name) => {
        const clients = status?.browsers?.filter((c) => c.name === name) ?? [];
        const connected = clients.length > 0;
        const error = clients.find((c) => c.error)?.error;
        const note = !status
          ? "检查中"
          : error
            ? "连接异常"
            : connected
              ? status.sessionId
                ? clients.some((c) => c.bound)
                  ? "录制中"
                  : "准备采集"
                : "已连接"
              : "未检测到连接";
        return (
          <section key={name} className="settings-card">
            <div className="settings-card-title">
              <h3>{name === "edge" ? "Microsoft Edge" : "Google Chrome"}</h3>
              <span
                className={
                  error
                    ? "settings-failed"
                    : connected
                      ? "settings-ready"
                      : "settings-muted"
                }
              >
                {note}
              </span>
            </div>
            <p>
              {connected
                ? `${clients.length} 个配置文件已连接${clients[0]?.version ? ` · 扩展 ${clients[0].version}` : ""}`
                : "请安装 / 重新加载插件，并允许访问需要录制的网站。"}
            </p>
            {error && (
              <details className="settings-local-error">
                <summary>查看异常详情</summary>
                <p>{error}</p>
              </details>
            )}
          </section>
        );
      })}
      {status?.connected &&
        (!status.browsers?.length ||
          status.browsers.some((c) => c.name === "unknown")) && (
          <p className="settings-notice">
            检测到旧版插件连接，无法区分浏览器。请重新加载最新插件后检查。
          </p>
        )}
      {status?.error && (
        <details className="settings-local-error">
          <summary>浏览器桥异常 · 查看详情</summary>
          <p>{status.error}</p>
        </details>
      )}
      <div className="processing-actions">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void refresh()}
        >
          刷新状态
        </button>
        <button
          className="secondary"
          disabled={busy || !!status?.sessionId}
          onClick={() => void refresh(true)}
        >
          {busy ? "处理中…" : "重新连接浏览器"}
        </button>
      </div>
      {status?.sessionId && (
        <p className="edit-hint">
          录制期间不重置浏览器桥；停止录制后可重新连接。
        </p>
      )}
      <h3>安装与更新插件</h3>
      <p>
        在 Chrome 的 chrome://extensions 或 Edge 的 edge://extensions
        中开启开发者模式，选择“加载已解压的扩展程序”，加载以下目录。更新后请重新加载插件。
      </p>
      <p className="settings-path">
        {status?.extensionDir || "正在读取插件目录…"}
      </p>
      <div className="processing-actions">
        <button
          className="secondary"
          onClick={() => void window.skillRecorder.revealBrowserExtension()}
        >
          打开插件目录
        </button>
        <button
          className="secondary"
          disabled={!status?.extensionDir}
          onClick={() =>
            void navigator.clipboard
              .writeText(status!.extensionDir)
              .then(() => setMessage("插件目录已复制。"))
              .catch(() => setMessage("无法复制，请手工复制上方目录。"))
          }
        >
          复制目录
        </button>
      </div>
      <p className="edit-hint">
        已连接表示桥接正常；录制中表示插件已确认采集会话。真实操作是否入库请查看录制证据时间线。
      </p>
    </section>
  );
}
