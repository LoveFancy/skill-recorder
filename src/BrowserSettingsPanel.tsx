import { useEffect, useState } from "react";
import type { BrowserStatus } from "../common/browser";
export function BrowserSettingsPanel(){
  const [status,setStatus]=useState<BrowserStatus|null>(null);
  const [open,setOpen]=useState(false);
  useEffect(()=>{let alive=true;const refresh=()=>window.skillRecorder.browserStatus().then(s=>{if(alive)setStatus(s);}).catch(()=>{});void refresh();const timer=setInterval(refresh,1500);return()=>{alive=false;clearInterval(timer);};},[]);
  return <section style={{fontSize:12,width:"100%"}}>
    <button type="button" className="hud-link" onClick={()=>setOpen(!open)}>Chrome 插件 · {status?.connected?(status.bound?"已绑定":"已连接，待绑定"):"未连接"}{status?.sessionId?` · 已采集 ${status.eventCount} 条`:""}</button>
    {open&&<div style={{lineHeight:1.7,padding:"8px 0"}}>
      <div>首次安装：打开 chrome://extensions，启用开发者模式，点击“加载已解压的扩展程序”，选择以下目录。</div>
      <div style={{overflowWrap:"anywhere",color:"#78716c"}}>{status?.extensionDir}</div>
      <button type="button" onClick={()=>void window.skillRecorder.revealBrowserExtension()}>打开插件目录</button>
      <div>点击 Chrome 插件中的“采集当前标签页”。桌面录制源请选择该 Chrome 窗口或所在屏幕；跨站需要重新授权绑定。</div>
      {status?.error&&<div role="alert" style={{color:"#b45309"}}>{status.error}</div>}
    </div>}
  </section>;
}
