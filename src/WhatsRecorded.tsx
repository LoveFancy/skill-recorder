import { useEffect, useRef } from "react";

import type { SensitiveModelStatus } from "../common/ipc";

/** Human-readable status for the on-device protection model shown in the sheet. */
function protectionModelNote(status: SensitiveModelStatus | null): string {
  if (!status) return "正在检查…";
  switch (status.ocr) {
    case "ready":
      return "本地模型已就绪";
    case "downloading":
      return status.progress == null
        ? "正在设置本地模型…"
        : `正在设置本地模型… ${Math.round(status.progress)}%`;
    case "error":
      return "无法设置本地模型";
    default:
      return "本地模型尚未设置";
  }
}

/**
 * Plain-language disclosure of what the recorder captures, where it is stored,
 * and what leaves the machine on analysis. Every claim here is grounded in the
 * actual collectors and describer behavior, so it must be kept in sync with them.
 *
 * Also home to the Advanced-protection opt-out toggle: protection is on by default,
 * and this sheet is where the user reviews what it does and turns it off if they
 * don't want on-device screen-image scanning.
 */
export function WhatsRecorded({
  onClose,
  onReviewed,
  sensitive,
  advancedPending,
  onToggleAdvanced,
  onDownload,
}: {
  onClose: () => void;
  onReviewed: () => void;
  sensitive: SensitiveModelStatus | null;
  advancedPending: boolean;
  onToggleAdvanced: () => void;
  onDownload: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sheetRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const advancedOn = sensitive?.enabled ?? true;
  const showModelError = advancedOn && sensitive?.ocr === "error";
  const showDownloadAction =
    advancedOn && (sensitive?.ocr === "error" || sensitive?.ocr === "missing");

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        ref={sheetRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-recorded-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sheet-head">
          <span className="sheet-icon" aria-hidden>
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
          <h2 id="whats-recorded-title">采集内容</h2>
        </header>

        <p className="sheet-lead">本工具记录屏幕和操作活动，将操作转换为可复用技能。以下说明具体采集内容及可能发送的数据。</p>

        <section className="sheet-block">
          <h3>录制期间</h3>
          <p className="sheet-note">仅在开始和结束录制之间采集。</p>
          <ul>
            <li>切换到的应用及其窗口、文档标题。</li>
            <li>打开页面的网址。</li>
            <li>复制文本的简短预览，最多 120 个字符。</li>
            <li>以低帧率录制所选屏幕的无声视频。</li>
            <li>打开悬浮栏中的录制终端后，会采集命令、工作目录、退出状态、时间和完整输出。</li>
          </ul>
          <p className="sheet-caution">请勿输入、粘贴、展示、复制或口述密码、令牌、API 密钥等敏感信息。屏幕上可见的内容、复制文本预览与旁白都可能被录制。</p>
        </section>

        <section className="sheet-block">
          <h3>录制终端（仅在打开时）</h3>
          <ul>
            <li>仅采集从悬浮录制栏打开的终端。</li>
            <li>完整终端输出随录制保存，没有应用设置的大小限制。长时间运行或大量输出的命令可能增大录制体积。</li>
            <li>本应用不会修改终端配置、安装全局监听、监控已有终端，也不会在录制结束后继续记录命令。</li>
          </ul>
        </section>

        <section className="sheet-block">
          <h3>语音旁白（仅在启用时）</h3>
          <p className="sheet-note">默认关闭。可在旁白设置中选择麦克风和初始状态，再通过悬浮录制栏控制。</p>
          <ul>
            <li>启用旁白时会短暂打开并释放麦克风，用于请求权限和检测输入设备，此检查不会保存音频。</li>
            <li>仅在录制进行且麦克风开启时保存声音。</li>
            <li>关闭麦克风会结束当前语音片段并释放设备。再次开启或切换输入会创建新的片段，仍关联同一录制时间线。</li>
            <li>语音通过本地模型转写为文本，使用所选语言，使用 SenseVoice Small INT8，支持中文、粤语、英语、日语和韩语。首次转写需下载约 240 MB 的模型，由你决定何时开始。</li>
            <li>关闭旁白与录制栏麦克风后，不会打开麦克风。</li>
          </ul>
        </section>

        <section className="sheet-block">
          <h3>存储位置</h3>
          <ul>
            <li>所有内容都保存在本机的应用录制目录中。</li>
            <li>录制内容会保留，直到你从录制记录中删除它。</li>
          </ul>
        </section>

        <section className="sheet-block">
          <h3>发送用于分析的内容</h3>
          <ul>
            <li>录制期间不会向外发送数据。</li>
            <li>
              选择分析后，事件时间线、屏幕截图、旁白文本及分析所需的有限终端输出片段会发送到配置的 AI 服务。
            </li>
            <li>默认会在本机隐藏文本和截图中的密码、密钥、邮箱、银行卡号和证件号码等敏感信息，可在下方关闭。</li>
          </ul>
        </section>

        <section className={`sheet-block sheet-advp ${advancedOn ? "on" : ""}`}>
          <div className="sheet-advp-head">
            <div className="sheet-advp-copy">
              <h3>隐私保护</h3>
              <p className="sheet-note">默认开启。分析前在本机检查文本和截图，并隐藏敏感信息。关闭后将按原样发送录制内容。</p>
            </div>
            <button
              type="button"
              className="sheet-switch-btn"
              role="switch"
              aria-checked={advancedOn}
              aria-busy={advancedPending}
              aria-label="隐私保护"
              disabled={advancedPending}
              onClick={onToggleAdvanced}
            >
              <span className={`sheet-switch ${advancedOn ? "on" : ""}`} aria-hidden>
                <span className="sheet-switch-knob" />
              </span>
            </button>
          </div>
          {advancedOn && (
            <>
              <ul>
                <li>隐藏发送文本（包括旁白和终端输出）及截图中的密码、密钥、邮箱、银行卡号和证件号码等敏感信息。</li>
                <li>关闭后会原样发送录制内容，可能提高分析准确度，但不会隐藏信息。仅在录制不含敏感内容时关闭。</li>
                <li>所有保护处理均在本机执行。</li>
              </ul>
              <div className={`sheet-advp-status ${showModelError ? "is-error" : ""}`}>
                <span className="sheet-advp-model">{protectionModelNote(sensitive)}</span>
                {showDownloadAction && (
                  <button type="button" className="sheet-advp-download" onClick={onDownload}>
                    {sensitive?.ocr === "error" ? "重试" : "立即设置"}
                  </button>
                )}
              </div>
              <p className="sheet-caution">保护可能漏检或误判，无法保证完全有效。请仍然避免录制任何机密信息。</p>
            </>
          )}
        </section>

        <section className="sheet-block">
          <h3>不会采集的内容</h3>
          <ul>
            <li>不会记录键盘按键。</li>
            <li>不会采集系统终端、PowerShell 或其他终端应用的命令。</li>
            <li>仅在录制期间采集，不会在后台持续监控。</li>
          </ul>
        </section>

        <button className="sheet-close" onClick={onReviewed}>知道了</button>
      </div>
    </div>
  );
}
