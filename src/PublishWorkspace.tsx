import { useEffect, useState } from "react";
import type { DocumentView, OutputKind } from "../common/output";
import { renderSkillMarkdown, type BuiltSkill } from "../common/skill";

export type PublishSelection = { kind: OutputKind; id?: string; revision?: number };
type Channel = "feishu" | "wiki" | "skillhub" | "workmate";
type Product = { key: string; kind: OutputKind; title: string; version: string; status: string; markdown: string; resources: string; warning?: string };
const labels: Record<OutputKind, string> = { sop: "SOP 操作说明", manual: "产品使用手册", skill: "通用 Skill" };
const channels: Record<Channel, { name: string; mark: string; description: string }> = {
  feishu: { name: "飞书云文档", mark: "飞", description: "发布到团队文件夹，通过链接阅读" },
  wiki: { name: "Wiki 知识库", mark: "W", description: "归档到飞书知识库或其他 Wiki" },
  skillhub: { name: "SkillHub", mark: "S", description: "发布技能包，供发现、安装和使用" },
  workmate: { name: "Workmate", mark: "M", description: "发布兼容插件，安装后由使用者授权" },
};

function documentProduct(view: DocumentView): Product {
  const a = view.artifact;
  const used = new Set(a.content?.sections.flatMap(s => s.steps.flatMap(t => t.assetIds)) ?? []);
  return { key: `${a.id}:${a.revision}`, kind: a.request.kind, title: a.content?.title ?? "尚未生成正文", version: `修订 ${a.revision}`,
    status: view.stale ? "来源已变化" : a.status === "reviewed" ? "已审核" : "草稿", markdown: view.markdown,
    resources: `正文${used.size ? `与 ${used.size} 张脱敏截图` : ""}`,
    warning: view.stale ? "来源已变化，请返回生成更新内容。" : a.status !== "reviewed" ? "这份文档尚未审核，请返回生成核对并保存。" : a.content?.gaps.length ? "文档仍有待补充内容。" : undefined };
}

function skillProduct(skill: BuiltSkill): Product {
  const reviewed = skill.generation?.status === "reviewed" && !skill.generation.gaps.length;
  return { key: "skill", kind: "skill", title: skill.plan?.title || skill.name, version: "当前已保存版本", status: reviewed ? "已审核 · 执行未验证" : "需核对 · 执行未验证",
    markdown: renderSkillMarkdown(skill), resources: "SKILL.md 与依赖声明",
    warning: reviewed ? undefined : "请先核对技能内容及依赖；业务执行尚未验证。" };
}

/** UI only: reads saved artifacts. No publish, authorization or upload API is exposed here. */
export function PublishWorkspace({ sessionId, selection, onBack }: { sessionId: string; selection?: PublishSelection; onBack: () => void }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState("");
  const [channel, setChannel] = useState<Channel>(selection?.kind === "skill" ? "skillhub" : "feishu");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [platform, setPlatform] = useState("飞书知识库");
  const [visibility, setVisibility] = useState("workspace");
  const [confirmed, setConfirmed] = useState(false);
  const product = products.find(p => p.key === selected);
  const skill = product?.kind === "skill";
  const available: Channel[] = skill ? ["skillhub", "workmate"] : ["feishu", "wiki"];
  const reset = () => { setTarget(""); setPlatform("飞书知识库"); setVisibility("workspace"); setConfirmed(false); };

  useEffect(() => {
    let live = true;
    setLoading(true); setError(""); setProducts([]); setSelected("");
    void Promise.all([window.skillRecorder.document({ kind: "list", sessionId }), window.skillRecorder.getSkill(sessionId)]).then(([docs, built]) => {
      if (!live) return;
      if (!docs.ok) throw new Error(docs.error ?? "读取已保存文档失败。");
      // Only current revisions are selectable; old publication versions will have separate history once publishing is connected.
      const latest = new Map<string, DocumentView>();
      for (const d of docs.documents ?? []) if (!latest.has(d.artifact.id) || latest.get(d.artifact.id)!.artifact.revision < d.artifact.revision) latest.set(d.artifact.id, d);
      const next = [...latest.values()].filter(d => !!d.artifact.content).map(documentProduct);
      if (built) next.push(skillProduct(built));
      const chosen = next.find(p => selection?.kind === "skill" ? p.kind === "skill" : selection?.id ? p.key === `${selection.id}:${selection.revision}` : p.kind === selection?.kind) ?? next[0];
      setProducts(next); setSelected(chosen?.key ?? ""); setTitle(chosen?.title ?? "");
      setChannel(chosen?.kind === "skill" ? "skillhub" : "feishu"); reset();
    }).catch(e => { if (live) setError(e instanceof Error ? e.message : "读取成果失败。"); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [sessionId, selection?.kind, selection?.id, selection?.revision, retry]);

  const changeProduct = (key: string) => {
    const next = products.find(p => p.key === key);
    setSelected(key); setTitle(next?.title ?? ""); setChannel(next?.kind === "skill" ? "skillhub" : "feishu"); reset();
  };
  const summary = product && <section className="publication-summary" aria-label="本次发布摘要">
    <h3>本次发布</h3><dl><dt>内容</dt><dd>{product.title}</dd><dt>产物类型</dt><dd>{labels[product.kind]}</dd><dt>版本</dt><dd>{product.version}</dd><dt>内容状态</dt><dd>{product.status}</dd><dt>资源</dt><dd>{product.resources}</dd><dt>使用方式</dt><dd>{skill ? "安装到目标平台，使用者自行授权" : "打开链接阅读文档"}</dd></dl>
    <details><summary>预览已保存内容</summary><pre className="doc-preview">{product.markdown}</pre></details>
  </section>;

  return <section className="ws publication-workspace" aria-busy={loading}>
    <header className="ws-head publication-head"><div><span className="doc-kicker">发布与分享</span><h2>让这份成果被使用</h2><p>选择一个去处，将成果分享给需要的人。</p></div><span className="publication-badge">界面预览 · 渠道待接入</span></header>
    <div className="ws-body publication-body">
      {loading ? <p role="status">正在读取已保存成果…</p> : error ? <div role="alert"><p>{error}</p><button className="secondary" onClick={() => setRetry(n => n + 1)}>重新读取</button></div> : !product ? <section className="publication-empty"><h3>先生成一份成果</h3><p>完成 SOP、使用手册或 Skill 后，即可在这里选择发布去处。</p><button className="record-cta" onClick={onBack}>去生成</button></section> : <>
        <label className="doc-field publication-product">本次产物<select aria-label="本次产物" value={selected} onChange={e => changeProduct(e.target.value)}>{products.map(p => <option key={p.key} value={p.key}>{labels[p.kind]} · {p.title} · {p.version}</option>)}</select></label>
        {product.warning && <p className="generation-draft">{product.warning}</p>}
        <div className="publication-grid"><div>
          <h3>发布到哪里</h3><div className="publication-channels" role="group" aria-label="发布渠道">{available.map(id => <button key={id} className="publication-channel" aria-pressed={channel === id} onClick={() => { setChannel(id); reset(); }}><span className="publication-mark" aria-hidden="true">{channels[id].mark}</span><span><strong>{channels[id].name}</strong><small>{channels[id].description}</small></span><span className="publication-badge">待接入</span></button>)}</div>
          <form className="publication-config" onSubmit={e => e.preventDefault()}>
            <div className="publication-connection"><strong>{channels[channel].name}</strong><span>尚未连接 · 待接入</span></div>
            <p className="publication-hint">当前可预览发布配置，账号连接与上传功能尚未开放。填写内容仅保留在当前页面。</p>
            <label className="doc-field">发布标题<input value={title} maxLength={200} onChange={e => { setTitle(e.target.value); setConfirmed(false); }} /></label>
            {channel === "wiki" && <label className="doc-field">知识库平台<select value={platform} onChange={e => { setPlatform(e.target.value); setTarget(""); setConfirmed(false); }}><option>飞书知识库</option><option>其他 Wiki</option></select></label>}
            <label className="doc-field">{skill ? "目标工作区" : channel === "wiki" ? "知识空间与父页面" : "目标文件夹"}<input value={target} placeholder={skill ? "连接平台后选择工作区" : channel === "wiki" ? "连接后选择知识空间与父页面" : "连接后选择文件夹"} disabled aria-describedby="publication-unavailable" /></label>
            <label className="doc-field">可见范围{skill ? <select aria-label="可见范围" value={visibility} onChange={e => { setVisibility(e.target.value); setConfirmed(false); }}><option value="workspace">仅工作区成员（预期范围）</option><option value="link">持有链接的工作区成员（预期范围）</option></select> : <input readOnly value="连接并选择位置后查询继承权限" />}</label>
            <label className="doc-field">发布方式<select defaultValue="new"><option value="new">新建发布</option><option value="update" disabled>更新已有发布 · 接入后开放</option></select></label>
            {skill && <p className="publication-hint">{channel === "workmate" ? "按 Workmate 格式打包插件" : "发布 SKILL.md 与必要资源"}。分享页需保留依赖与“执行未验证”标记；不包含账号凭据。</p>}
            <p className="publication-hint">仅发布当前成果与必要的脱敏资源，不包含原始录屏、会话日志或本机路径。</p>
            <label className="publication-confirm"><input type="checkbox" checked={confirmed} disabled onChange={e => setConfirmed(e.target.checked)} /><span>连接渠道后，核对目标位置、可见范围与发布内容。</span></label>
          </form>
        </div><aside className="publication-summary-desktop">{summary}</aside><details className="publication-summary-mobile"><summary>查看本次发布内容</summary>{summary}</details></div>
        <section className="publication-history"><h3>发布记录</h3><p>暂无发布记录。渠道接入后，这里将显示远端版本与分享链接。</p></section>
      </>}
    </div>
    <footer className="ws-foot publication-foot"><div className="ws-foot-back"><button className="ghost" onClick={onBack}>返回生成</button><span id="publication-unavailable" className="foot-status">渠道待接入，暂不能上传或生成分享链接。</span></div>{product && <button className="record-cta" disabled title="真实发布接口尚未接入" aria-describedby="publication-unavailable">发布到{channels[channel].name}</button>}</footer>
  </section>;
}
