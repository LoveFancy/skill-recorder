import { useEffect, useRef, useState } from "react";
import type { MailAccount } from "../common/builtin-tools";
import type { SettingsFormListener } from "./settings-form";

const empty:MailAccount = {address:"",username:"",imapHost:"",imapPort:993,smtpHost:"",smtpPort:465};
export function BuiltinToolsSettings({onFormState}:{onFormState:SettingsFormListener}) {
  const [account,setAccount]=useState(empty),[baseline,setBaseline]=useState(empty),[password,setPassword]=useState("");
  const [hasPassword,setHasPassword]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[loaded,setLoaded]=useState(false);
  const dirty=loaded && (JSON.stringify(account)!==JSON.stringify(baseline)||!!password);
  const saveRef=useRef<()=>Promise<boolean>>(async()=>true);
  useEffect(()=>{let alive=true;void window.skillRecorder.processing({kind:"builtin-status"}).then(result=>{
    if(!alive)return;
    if(!result.ok){setError(result.error??"无法读取内置工具配置");return;}
    const mail=result.builtins?.mail;
    const next=mail ? {address:mail.address,username:mail.username,imapHost:mail.imapHost,imapPort:mail.imapPort,smtpHost:mail.smtpHost,smtpPort:mail.smtpPort} : empty;
    setAccount(next);setBaseline(next);setHasPassword(!!mail?.hasPassword);setLoaded(true);
  }).catch(()=>{if(alive)setError("无法读取内置工具配置");});return()=>{alive=false;};},[]);
  async function save() {
    if(!dirty)return true;
    setBusy(true);setError("");
    try {
      const result=await window.skillRecorder.processing({kind:"builtin-mail-save",account:{...account,...(password?{password}:{})}});
      if(!result.ok)throw new Error(result.error??"保存失败");
      setPassword("");setBaseline(account);setHasPassword(true);return true;
    }catch(e){setError(e instanceof Error?e.message:"保存失败");return false;}finally{setBusy(false);}
  }
  saveRef.current=save;
  useEffect(()=>{onFormState({dirty,busy,save:()=>saveRef.current()});},[dirty,busy,onFormState]);
  const field=(key:keyof MailAccount,label:string,type="text")=><label className="builtin-mail-field" key={key}><span>{label}</span><input aria-label={label} type={type} value={account[key]} disabled={busy||!loaded} onChange={e=>setAccount(previous=>({...previous,[key]:type==="number"?Number(e.target.value):e.target.value}))}/></label>;
  return <section className="settings-card builtin-tools-settings">
    <div className="processing-heading"><strong>内置工具</strong><span>与本地扩展共同使用</span></div>
    <p><strong>浏览器 · Playwright</strong><br/>使用本机 Chrome，可读取网页、截图及执行浏览器操作。独立浏览器窗口支持手动登录；深度分析只启用读取工具。</p>
    <details><summary>邮箱 · IMAP / SMTP {hasPassword?"已配置":"待配置"}</summary>
      <p>使用邮箱密码或应用专用授权码。IMAP 使用 TLS；SMTP 支持 465 或 STARTTLS 端口。发送工具不会提供给深度分析。</p>
      <div className="builtin-mail-grid">
        {field("address","邮箱地址","email")}{field("username","登录用户名")}
        {field("imapHost","IMAP 服务器")}{field("imapPort","IMAP 端口","number")}
        {field("smtpHost","SMTP 服务器")}{field("smtpPort","SMTP 端口","number")}
        <label className="builtin-mail-field"><span>密码 / 授权码</span><input aria-label="邮箱密码或授权码" type="password" autoComplete="new-password" value={password} disabled={busy||!loaded} placeholder={hasPassword?"已保存，留空保持不变":"输入应用专用授权码"} onChange={e=>setPassword(e.target.value)}/></label>
      </div>
      {error&&<p role="alert" className="settings-local-error">{error}</p>}
      <p className="edit-hint">账号保存在本应用，授权码经系统加密。保存后点击“刷新能力来源”，勾选需要的工具并检查连接。</p>
      <button className="secondary" disabled={busy||!dirty} onClick={()=>void save()}>{busy?"正在保存…":"保存邮箱配置"}</button>
    </details>
    <p className="edit-hint">下方可同时选择内置工具、全局 MCP 和 Skills；不会修改 Claude 全局配置。</p>
  </section>;
}
