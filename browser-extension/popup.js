const status=document.getElementById('status');
async function refresh(){
  try{
    let timer;
    const s=await Promise.race([chrome.runtime.sendMessage({kind:'status'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('连接超时')),2000);})]).finally(()=>clearTimeout(timer));
    document.body.classList.toggle('recording',!!s.session);
    status.textContent=`${s.session?(s.captureReady?'● 正在录制':'正在准备网页采集'):'未录制'} · ${s.connected?'本地桥已连接':'等待桌面应用'}\n全部普通网页标签页 · 已同步 ${s.accepted} 条 · 待同步 ${s.pending} 条${s.error?'\n'+s.error:''}`;
  }catch{status.textContent='插件后台未响应，请在 chrome://extensions 中重新加载插件';}
}
document.getElementById('reconnect').onclick=async()=>{
  const button=document.getElementById('reconnect');button.disabled=true;
  try{await chrome.runtime.sendMessage({kind:'reconnect'});await refresh();}
  catch{status.textContent='重连失败，请在 chrome://extensions 中重新加载插件';}
  finally{button.disabled=false;}
};
void refresh();setInterval(refresh,1000);
