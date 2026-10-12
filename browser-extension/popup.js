const status=document.getElementById('status');
async function refresh(){const s=await chrome.runtime.sendMessage({kind:'status'});status.textContent=`${s.connected?'本地桥已连接':'等待桌面应用'} · ${s.session?'录制中':'未录制'}\n${s.boundTab===null?'未绑定标签页':'已绑定标签页'} · 已同步 ${s.accepted} 条 · 待同步 ${s.pending} 条${s.error?'\n'+s.error:''}`;}
document.getElementById('bind').onclick=async()=>{
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id||!/^https?:\/\//.test(tab.url??''))throw new Error('请在普通 HTTP/HTTPS 网页中使用');
  const origin=new URL(tab.url).origin+'/*';
  if(!await chrome.permissions.request({origins:[origin]}))throw new Error('未授权当前站点');
  const id='site-'+await crypto.subtle.digest('SHA-256',new TextEncoder().encode(origin)).then(b=>Array.from(new Uint8Array(b)).slice(0,12).map(n=>n.toString(16).padStart(2,'0')).join(''));
  const existing=await chrome.scripting.getRegisteredContentScripts({ids:[id]});
  if(!existing.length)await chrome.scripting.registerContentScripts([{id,matches:[origin],js:['content.js'],allFrames:true,runAt:'document_start'}]);
  await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['content.js']});
  await chrome.runtime.sendMessage({kind:'bind',tabId:tab.id});await refresh();
 }catch(e){status.textContent=String(e.message??e);}
};
document.getElementById('unbind').onclick=async()=>{await chrome.runtime.sendMessage({kind:'unbind'});await refresh();};
void refresh();setInterval(refresh,1000);
