import { useEffect, useRef, useState } from "react";
import type { ProcessingStatus, ManagedSourcePreview, CapabilityManifest } from "../common/agents";
import type { ProcessingAction, ProcessingResult } from "../common/processing-api";
import type { SettingsFormListener, SettingsFormState } from "./settings-form";
import { BuiltinToolsSettings } from "./BuiltinToolsSettings";
const labels={available:"已就绪","not-installed":"未安装","auth-required":"需登录",incompatible:"版本不兼容","check-failed":"检查失败"};
export function ProcessingSettingsPanel({embedded=false,onSaved,onFormState}:{embedded?:boolean;onSaved?:()=>void;onFormState?:SettingsFormListener}) {
  const [status,setStatus]=useState<ProcessingStatus|null>(null),[preview,setPreview]=useState<ManagedSourcePreview|null>(null),[enabled,setEnabled]=useState<string[]>([]),[preference,setPreference]=useState("auto"),[busy,setBusy]=useState(false),[error,setError]=useState(""),[confirmed,setConfirmed]=useState(false),[snapshot,setSnapshot]=useState<CapabilityManifest|null>(null);
  const serial=useRef(0);
  const [builtinForm,setBuiltinForm]=useState<SettingsFormState|null>(null);
  const apply=(r:ProcessingResult)=>{if(r.status){setStatus(r.status);setPreference(r.status.settings.backendPreference);setEnabled(r.status.managed?.capabilities.filter(c=>c.enabled).map(c=>c.ref)??[]);onSaved?.();}if(r.preview){setPreview(r.preview);setEnabled(r.preview.capabilities.filter(c=>c.enabled).map(c=>c.ref));setConfirmed(false);}if(r.snapshot)setSnapshot(r.snapshot);};
  const perform=async(action:ProcessingAction)=>{const n=++serial.current;setBusy(true);setError("");try{const r=await window.skillRecorder.processing(action);if(n!==serial.current)return false;if(!r.ok){setError(r.error??"操作失败");return false;}apply(r);return true;}catch{setError("无法连接智能处理服务，请重试。");return false;}finally{if(n===serial.current)setBusy(false);}};
  useEffect(()=>{void perform({kind:"status"});return()=>{serial.current++;};},[]);
  const managed=status?.managed,capabilities=preview?.capabilities??managed?.capabilities??[];
  const selectionChanged=JSON.stringify([...enabled].sort())!==JSON.stringify(managed?.capabilities.filter(c=>c.enabled).map(c=>c.ref).sort()??[]);
  const changed=!!status&&(preference!==status.settings.backendPreference||selectionChanged||!!preview||!!builtinForm?.dirty);
  async function save(){
    if(!status)return false;
    if(builtinForm?.dirty && !await builtinForm.save())return false;
    if((selectionChanged||preview)&&!confirmed){setError("请确认本次启用范围与来源变化。");return false;}
    if(selectionChanged||preview){if(!managed)return false;const ok=await perform({kind:"managed-save",input:{baseRevision:preview?.baseRevision??managed.activeConfigRevision,sourceSnapshotId:preview?.sourceSnapshotId??managed.sourceSnapshotId,enabledRefs:enabled,confirmed:true}});if(!ok)return false;setPreview(null);setConfirmed(false);}
    if(preference!==status.settings.backendPreference){let current=status.settings;if(selectionChanged||preview){try{const fresh=await window.skillRecorder.processing({kind:"status"});if(!fresh.ok||!fresh.status)throw new Error();current=fresh.status.settings;}catch{setError("能力已保存，处理策略尚未保存，请重新加载后重试。");return false;}}const ok=await perform({kind:"save",settings:{...current,backendPreference:preference as "auto"|"api"|"local-agent"}});if(!ok)return false;}
    return true;
  }
  useEffect(()=>{onFormState?.({dirty:changed,busy:busy||!!builtinForm?.busy,save});});
  const body=<div className="processing-panel">
    {error&&<p className="settings-local-error" role="alert">{error}</p>}
    {!status?<p>正在检查本地 Agent 与专用环境…</p>:<>
      <div className="processing-heading"><strong>处理后端</strong><button className="linky" disabled={busy||changed} onClick={()=>void perform({kind:"status"})}>重新检查</button></div>
      <select aria-label="处理后端" value={preference} disabled={busy} onChange={e=>setPreference(e.target.value)}><option value="auto">优先本地 Agent，未安装时用 API</option><option value="local-agent">只使用本地 Agent</option><option value="api">使用模型 API</option></select>
      <p>Claude Code · {labels[status.availability.status]} {status.availability.agentVersion}</p>
      {status.error&&<details className="processing-error"><summary>配置异常 · 查看原因</summary><p>{status.error}</p></details>}
      <BuiltinToolsSettings onFormState={setBuiltinForm}/>
      {managed&&<>
        <section className="settings-card"><div className="processing-heading"><strong>Skill Recorder 专用环境</strong><span>{managed.isolationStatus==="verified"?"受控加载":"无法保证隔离"}</span></div><p>自动管理，复用 Claude 登录；不修改全局配置，不需要关联项目。</p><p className="processing-path">{managed.directory}</p><p>配置版本 {managed.activeConfigRevision.slice(0,8)} · {new Date(managed.checkedAt).toLocaleString()}</p>
          <details><summary>配置来源与加载边界</summary><p>{managed.isolationMethod}</p><p>{managed.coveredSources.join("、")||"尚无全局能力来源"}</p>{managed.omittedSources.map(s=><p key={s}>{s}</p>)}<p>旧项目记录仅供历史追溯，不导入其专属能力。</p></details>
        </section>
        <div className="processing-heading"><strong>本应用启用范围</strong><button className="secondary" disabled={busy||selectionChanged||!!preview||!!builtinForm?.dirty} onClick={()=>void perform({kind:"managed-sync"})}>刷新能力来源</button></div>
        {preview&&<section className="settings-notice"><strong>复核来源变化</strong><p>新增默认关闭；命令、参数、凭据引用或 Skill 资源变化需重新选择。保存前现有配置继续有效。</p>{preview.capabilities.filter(c=>c.change!=="unchanged").map(c=><p key={c.ref}>{c.name} · {{added:"新增",changed:"变化，待复核",removed:"已移除",unchanged:"未变化"}[c.change]}</p>)}<button className="linky" disabled={busy} onClick={()=>{setPreview(null);setEnabled(managed.capabilities.filter(c=>c.enabled).map(c=>c.ref));setConfirmed(false);}}>取消同步</button></section>}
        {(["mcp","skill"] as const).map(kind=><section key={kind} className="managed-capability-group"><h3>{kind==="mcp"?"MCP":"Skills"}</h3><p className="edit-hint">{kind==="mcp"?"只对保存后启用的 MCP 主动检查连接；开启不授予业务操作权限。":"选中的说明和文本资源提供给模型；脚本不会执行，不是可调用工具。"}</p>
          {!capabilities.some(c=>c.kind===kind)&&<p>未发现{kind==="mcp"?" MCP":" Skills"}。可在线下配置 Claude 后同步；仍可使用录制材料生成 Skill。</p>}
          {capabilities.filter(c=>c.kind===kind).map(c=><div className="managed-capability-row" key={c.ref}><label className="processing-trust"><input type="checkbox" checked={enabled.includes(c.ref)} disabled={busy||c.reviewState==="missing"||c.reviewState==="conflict"||managed.isolationStatus!=="verified"} onChange={e=>{setEnabled(prior=>e.target.checked?[...prior,c.ref]:prior.filter(ref=>ref!==c.ref));setConfirmed(false);}}/><strong>{c.name}</strong><span>{c.error??(enabled.includes(c.ref)?"已选择":"未选择")}</span></label><details><summary>来源与说明</summary><p>{c.description}</p><p className="processing-path">{c.source}</p></details></div>)}
        </section>)}
        {(selectionChanged||preview)&&<label className="processing-trust"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>我已复核启用范围。主动检查会启动所选 MCP 进程，可能要求认证；Skill 资源会作为模型参考。此设置不修改 Claude 全局配置。</label>}
        <button className="secondary" disabled={busy||changed||!enabled.some(ref=>capabilities.some(c=>c.ref===ref&&c.kind==="mcp"))} onClick={()=>void perform({kind:"capabilities",workspaceId:managed.environmentId,refresh:"connection"})}>检查已启用 MCP 连接（启动进程）</button>
        {snapshot?.servers.map(s=><details key={s.id} className={s.status==="connection-failed"?"settings-local-error":undefined}><summary>{s.name} · {s.status==="connected"?"已连接，业务权限未核验":s.status==="connection-failed"?"连接失败":"未核验"}</summary><p>{s.lastError?.message??"业务补证仍使用人工增强任务包。"}</p></details>)}
      </>}
      {preference==="api"&&<p>API 参数在“AI 模型”中配置。API 不继承本地 MCP / Skills。</p>}
      <div className="settings-save-bar"><span>{changed?"有尚未保存的更改":"设置已保存；只影响后续任务"}</span><button className="secondary" disabled={busy||!changed} onClick={()=>void save()}>保存处理设置</button></div>
    </>}
  </div>;
  return embedded?body:<details className="ai-settings"><summary>配置智能处理</summary>{body}</details>;
}
