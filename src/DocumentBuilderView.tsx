import { useEffect, useRef, useState } from "react";
import {
  OUTPUT_TEMPLATES, type DocumentAction, type DocumentContent, type DocumentKind,
  type DocumentOutline, type DocumentView,
} from "../common/output";

const label = (kind: DocumentKind) => kind === "sop" ? "SOP 操作说明" : "使用手册";

function DocumentImage({ sessionId, artifactId, assetId }: { sessionId: string; artifactId: string; assetId: string }) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void window.skillRecorder.document({ kind: "asset", sessionId, artifactId, assetId }).then(r => {
      if (!live) return;
      if (r.ok && r.assetDataUrl) setSrc(r.assetDataUrl); else setError(r.error ?? "截图不可用");
    }).catch(() => { if (live) setError("截图读取失败"); });
    return () => { live = false; };
  }, [sessionId, artifactId, assetId]);
  return src ? <img className="doc-image" src={src} alt="已脱敏的操作截图，请核对画面" /> : <small>{error || "读取脱敏截图…"}</small>;
}

export function DocumentBuilderView({ sessionId, kind, sourceConfirmed = false, onClose }: { sessionId: string; kind: DocumentKind; sourceConfirmed?: boolean; onClose: () => void }) {
  const [documents, setDocuments] = useState<DocumentView[]>([]);
  const [view, setView] = useState<DocumentView | null>(null);
  const [content, setContent] = useState<DocumentContent | null>(null);
  const [outline, setOutline] = useState<DocumentOutline>([]);
  const [audience, setAudience] = useState("业务操作者");
  const [scope, setScope] = useState("本次录制及已确认材料覆盖的任务与功能");
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [regenerate, setRegenerate] = useState(false);
  const live = useRef(false);
  const pending = useRef(false);
  const loadVersion = useRef(0);

  const select = (next: DocumentView | null) => {
    setView(next); setContent(next?.artifact.content ?? null); setOutline(next?.artifact.outline ?? []);
    setAudience(next?.artifact.request.audience ?? "业务操作者");
    setScope(next?.artifact.request.scope ?? "本次录制及已确认材料覆盖的任务与功能");
    setNotes(next?.artifact.request.notes ?? "");
    setDirty(false); setConfirmed(false); setRegenerate(false); setNotice("");
  };
  const refresh = async (selected?: DocumentView) => {
    const version = ++loadVersion.current;
    const result = await window.skillRecorder.document({ kind: "list", sessionId });
    if (!live.current || version !== loadVersion.current) return;
    if (!result.ok) throw new Error(result.error ?? "读取文档失败。");
    const docs = (result.documents ?? []).filter(d => d.artifact.request.kind === kind);
    setDocuments(docs);
    select(selected ?? docs[0] ?? null);
  };
  useEffect(() => {
    live.current = true;
    void refresh().catch(e => { if (live.current) setError(String(e)); });
    return () => {
      live.current = false; loadVersion.current++;
      if (pending.current) void window.skillRecorder.document({ kind: "cancel", sessionId });
    };
  }, [sessionId, kind]);

  const perform = async (action: DocumentAction) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await window.skillRecorder.document(action);
      if (!live.current) return;
      if (result.canceled) return;
      if (!result.ok) throw new Error(result.error ?? "文档处理失败。");
      await refresh(result.document);
      if (result.path && live.current) setNotice(`已导出：${result.path}`);
    } catch (e) { if (live.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { pending.current = false; if (live.current) setBusy(false); }
  };
  const a = view?.artifact;
  const historical = !!a && documents.some(d => d.artifact.id === a.id && d.artifact.revision > a.revision);
  const locked = busy || historical || !!view?.stale;
  const update = (part: Partial<DocumentContent>) => { if (content) { setContent({ ...content, ...part }); setDirty(true); } };
  const generate = (newArtifact = false) => {
    if (kind === "manual" && !sourceConfirmed && !confirmed) { setError("请先确认使用已审核的基础分析制作文档。"); return; }
    void perform({ kind: "generate", sessionId, request: { kind, audience: audience.trim() || "业务操作者", scope: scope.trim() || "本次录制及已确认材料覆盖的任务与功能", ...(notes.trim() ? {notes: notes.trim()} : {}) }, artifactId: newArtifact ? undefined : a?.id });
  };
  const customFields = <>
    <label className="doc-field">适用读者<input value={audience} maxLength={500} disabled={busy || (!!a && !regenerate)} onChange={e => setAudience(e.target.value)} /></label>
    <label className="doc-field">覆盖范围<textarea value={scope} maxLength={3000} disabled={busy || (!!a && !regenerate)} onChange={e => setScope(e.target.value)} /></label>
    <label className="doc-field">额外要求<textarea value={notes} placeholder="可选，例如：面向新同事，突出容易出错的操作。" maxLength={3000} disabled={busy || (!!a && !regenerate)} onChange={e => setNotes(e.target.value)} /></label>
  </>;
  return <section className="ws document-workspace" aria-busy={busy}>
    <div className="ws-head doc-head">
      <div><span className="doc-kicker">文档生成</span><h2>{label(kind)}</h2><p>{kind === "sop" ? "把录制中的实际操作，整理成清晰、可复现的操作流程。" : "围绕已演示的功能，整理适用范围、操作方法与使用说明。"}</p></div>
    </div>
    <div className="ws-body">
      {documents.length > 0 && <label className="doc-field">已保存文档与历史版本
        <select value={a ? `${a.id}:${a.revision}` : ""} disabled={busy || dirty} onChange={e => select(documents.find(d => `${d.artifact.id}:${d.artifact.revision}` === e.target.value) ?? null)}>
          <option value="">新建文档</option>
          {documents.map(d => <option key={`${d.artifact.id}:${d.artifact.revision}`} value={`${d.artifact.id}:${d.artifact.revision}`}>{d.artifact.content?.title ?? "手册目录"} · 修订 {d.artifact.revision} · {d.artifact.status === "reviewed" ? "已审核" : "草稿"}{d.stale ? " · 来源已变化" : ""}</option>)}
        </select>
      </label>}
      {historical && <p className="generation-draft">历史版本只读；选择最新版本后可编辑或导出。</p>}
      {view?.stale && <p className="generation-draft">来源已变化，当前内容仅供查看。重新生成后再审核导出，旧版本和编辑会保留。</p>}
      {kind === "manual" && <section className="doc-setup" aria-labelledby="doc-setup-title">
        <div className="doc-section-heading"><h3 id="doc-setup-title">文档设置</h3><span>{OUTPUT_TEMPLATES[kind].label} · v{OUTPUT_TEMPLATES[kind].version}</span></div>
        {customFields}
        <details className="doc-generation-notes"><summary>生成说明</summary><p>保留实际操作方式，不翻译为 MCP／替代 CLI。仅使用基础分析及当前已审核的补充事实。{kind === "manual" ? "先生成覆盖目录，确认目录后再生成正文。" : "生成后可编辑、审核并导出文档。"}</p></details>
      </section>}
      {kind === "manual" && (!a || regenerate) && !sourceConfirmed && <div className="doc-source-confirmation">
        <h3>确认文档来源</h3>
        <label className="doc-confirmation"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} /><span>我已确认基础分析可用于制作本次文档；未审核增强不作为事实。</span></label>
        {regenerate && <p>重新生成会创建新修订，已保存的历史版本不变。未保存编辑请先保存草稿。</p>}
      </div>}
      {a?.outline && !content && <div className="doc-outline">
        <h3>审核目录与覆盖范围</h3><p>无证据的章节只能标记为“待补充”。目录确认后才生成正文。</p>
        {outline.map((item, i) => <fieldset key={item.id} disabled={locked}>
          <legend>章节 {i + 1}</legend>
          <label className="doc-field">标题<input value={item.title} onChange={e => { setOutline(outline.map((x, j) => j === i ? { ...x, title: e.target.value } : x)); setDirty(true); }} /></label>
          <label className="doc-field">范围<textarea value={item.scope} onChange={e => { setOutline(outline.map((x, j) => j === i ? { ...x, scope: e.target.value } : x)); setDirty(true); }} /></label>
          <label>覆盖状态 <select value={item.coverage} onChange={e => { setOutline(outline.map((x, j) => j === i ? { ...x, coverage: e.target.value as typeof item.coverage } : x)); setDirty(true); }}><option value="covered">已覆盖</option><option value="partial">部分覆盖</option><option value="planned">待补充</option></select></label>
          <small>来源：{item.evidenceRefs.join("、") || "无"}</small>
        </fieldset>)}
      </div>}
      {a && content && <>
        <h3>编辑与审核</h3><p>修订 {a.revision} · {a.status === "reviewed" ? "已审核" : "草稿"}{dirty ? " · 有未保存编辑" : ""}</p>
        <fieldset disabled={locked} className="doc-editor">
          <label className="doc-field">标题<input value={content.title} onChange={e => update({ title: e.target.value })} /></label>
          <label className="doc-field">目的与范围<textarea value={content.purpose} onChange={e => update({ purpose: e.target.value })} /></label>
          {([ ["prerequisites", "前置条件"], ["exceptions", "异常与处理"], ["completion", "完成检查"], ["gaps", "待补充与限制"] ] as const).map(([key, title]) => <label className="doc-field" key={key}>{title}（每行一项）<textarea value={content[key].join("\n")} onChange={e => update({ [key]: e.target.value.split("\n").filter(Boolean) })} /></label>)}
          {content.sections.map((section, si) => <div className="enhancement-card" key={section.id}>
            <label className="doc-field">章节标题<input value={section.title} onChange={e => update({ sections: content.sections.map((s, i) => i === si ? { ...s, title: e.target.value } : s) })} /></label>
            <label className="doc-field">章节说明<textarea value={section.description} onChange={e => update({ sections: content.sections.map((s, i) => i === si ? { ...s, description: e.target.value } : s) })} /></label>
            {section.steps.map((step, ti) => {
              const change = (part: Partial<typeof step>) => update({ sections: content.sections.map((s, i) => i === si ? { ...s, steps: s.steps.map((t, j) => j === ti ? { ...t, ...part } : t) } : s) });
              return <div key={ti} className="doc-step"><h4>步骤 {ti + 1}</h4>
                {([ ["title", "步骤名称"], ["location", "界面入口"], ["action", "操作"], ["expectedResult", "结果说明"] ] as const).map(([key, title]) => <label className="doc-field" key={key}>{title}<textarea value={step[key]} onChange={e => change({ [key]: e.target.value })} /></label>)}
                <label>结果来源 <select value={step.resultStatus} onChange={e => change({ resultStatus: e.target.value as typeof step.resultStatus })}><option value="observed">录制可见</option><option value="confirmed">人工确认</option><option value="unknown">待确认</option></select></label>
                <small>来源：{step.evidenceRefs.join("、")}</small>
                {a.assets.length > 0 && <details><summary>关联脱敏截图（请核对与本步是否一致）</summary>{a.assets.map((asset, imageIndex) => <div key={asset.id}><label><input type="checkbox" checked={step.assetIds.includes(asset.id)} onChange={e => change({ assetIds: e.target.checked ? [...step.assetIds, asset.id] : step.assetIds.filter(id => id !== asset.id) })} /> 截图 {imageIndex + 1}</label><DocumentImage sessionId={sessionId} artifactId={a.id} assetId={asset.id} /></div>)}</details>}
              </div>;
            })}
            <small>章节来源：{section.evidenceRefs.join("、")}</small>
          </div>)}
        </fieldset>
        <details><summary>查看导出预览（已保存版本）</summary><pre className="doc-preview">{view.markdown}</pre></details>
      </>}
      {busy && <p role="status">正在处理文档，已保存版本会保留…</p>}
      {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    </div>
    <div className="ws-foot doc-foot">
      <div className="ws-foot-back">
        <button className="ghost" onClick={onClose} disabled={busy || dirty}>返回产物选择</button>
        {dirty && <button className="linky" disabled={busy} onClick={() => select(view)}>放弃未保存编辑</button>}
        {a && !historical && !dirty && <>
          <button className="linky" disabled={busy} onClick={() => { setRegenerate(!regenerate); setConfirmed(false); }}>重新生成新修订</button>
          <button className="linky" disabled={busy} onClick={() => select(null)}>另建一份文档</button>
        </>}
      </div>
      <div className="ws-foot-actions">
        {busy ? <button className="secondary" onClick={() => void window.skillRecorder.document({ kind: "cancel", sessionId })}>停止</button> : (!a || regenerate) ? <button className="record-cta" disabled={(kind === "manual" && !sourceConfirmed && !confirmed) || dirty} onClick={() => generate()}>{kind === "manual" ? "生成覆盖目录" : "生成 SOP"}</button> : <>
          {a.outline && !content && <button className="record-cta" disabled={locked} onClick={() => void perform({ kind: "outline", sessionId, artifactId: a.id, revision: a.revision, outline })}>确认目录并生成正文</button>}
          {content && <>
            <button className="secondary" disabled={locked} onClick={() => void perform({ kind: "edit", sessionId, artifactId: a.id, revision: a.revision, content, reviewed: false })}>保存草稿</button>
            <button className="secondary" disabled={locked || dirty} onClick={() => void perform({ kind: "export", sessionId, artifactId: a.id, revision: a.revision, draft: a.status !== "reviewed" })}>{a.status === "reviewed" ? "导出文档" : "导出草稿（含草稿标记）"}</button>
            <button className="record-cta" disabled={locked || content.gaps.length > 0} onClick={() => void perform({ kind: "edit", sessionId, artifactId: a.id, revision: a.revision, content, reviewed: true })}>确认内容并保存</button>
          </>}
        </>}
      </div>
    </div>
  </section>;
}
