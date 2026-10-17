const HOST='com.skillrecorder.browser';
let connected=false;
let captureReady=false;
let port=null,session=null,queue=[],inFlight=false,draining=false,drainWaiting=false,error=null,accepted=0;
let serial=Promise.resolve();
let ackTimer=null,flightIds=new Set();
const ACK_TIMEOUT_MS=5000;
function clearFlight(){clearTimeout(ackTimer);ackTimer=null;flightIds.clear();inFlight=false;}
const frames=new Map();
const ready=chrome.storage.local.get(['queue']).then(s=>{queue=Array.isArray(s.queue)?s.queue.slice(0,2000):[];});
const persist=()=>chrome.storage.local.set({queue});
const badge=()=>{
  chrome.action.setBadgeText({text:session?'REC':connected?'ON':''});
  chrome.action.setBadgeBackgroundColor({color:session?'#dc2626':'#00875a'});
  chrome.action.setTitle({title:session?'技能录制器 · 正在录制':connected?'技能录制器 · 已连接':'技能录制器 · 未连接'});
};
// A suspended/discarded page must not block bridge state or recording shutdown.
async function bounded(operation){
  let timer;
  try{return await Promise.race([operation,new Promise(resolve=>{timer=setTimeout(resolve,800);})]);}
  finally{clearTimeout(timer);}
}
async function notify(kind,active=session){
  await Promise.all([...frames].flatMap(([tabId,docs])=>[...docs.values()].map(async options=>{
    try{await bounded(chrome.tabs.sendMessage(tabId,{kind,session:active},options));}catch{/* Document closed or navigated. */}
  })));
}
async function prepareTabs(){
  const tabs=await chrome.tabs.query({});
  await Promise.all(tabs.filter(t=>/^https?:\/\//.test(t.url??'')).map(async t=>{
    try{await bounded(chrome.scripting.executeScript({target:{tabId:t.id,allFrames:true},files:['content.js']}));}
    catch{/* Restricted pages are not injectable. */}
  }));
}
function flush(retryIds=null){
  if(!port||!session||inFlight)return;
  if(!queue.length){if(draining && !drainWaiting){port.postMessage({kind:'drained'});draining=false;}return;}
  const batch=[];let bytes=0;
  const pending=retryIds?queue.filter(event=>retryIds.has(event.eventId)):queue;
  for(const event of pending.slice(0,50)){const size=new TextEncoder().encode(JSON.stringify(event)).length;if(batch.length && bytes+size>200*1024)break;batch.push(event);bytes+=size;}
  const sendingPort=port;
  inFlight=true;flightIds=new Set(batch.map(event=>event.eventId));
  const sendingIds=flightIds;
  // Delivery can succeed while its ACK is lost. Resend the persisted events with
  // their original IDs; the desktop deduplicates only after its durable write.
  ackTimer=setTimeout(()=>{
    serial=serial.then(()=>{
      if(port!==sendingPort||flightIds!==sendingIds||!inFlight)return;
      const retryIds=new Set(sendingIds);
      clearFlight();flush(retryIds);
    }).catch(e=>{error=String(e);});
  },ACK_TIMEOUT_MS);
  try{sendingPort.postMessage({kind:'events',events:batch});}
  catch(e){clearFlight();error=String(e);sendingPort.disconnect();}
}
function connect(){
  if(port)return;
  try{
    const p=chrome.runtime.connectNative(HOST);port=p;
    p.onMessage.addListener(m=>{
      serial=serial.then(async()=>{await ready;if(port!==p)return;
        if(m.kind==='session'){
          p.postMessage({kind:'client-info',browser:/Edg\//.test(navigator.userAgent)?'edge':'chrome',version:chrome.runtime.getManifest().version});
          connected=true;
          const next=m.session??null;
          if(next?.id!==session?.id){queue=queue.filter(e=>e.sessionId===next?.id);accepted=0;}
          session=next;captureReady=false;error=null;clearFlight();draining=false;drainWaiting=false;badge();await persist();if(session)await prepareTabs();await notify('session');captureReady=!!session;p.postMessage({kind:'bound',bound:captureReady});flush();
        }else if(m.kind==='ack'){
          if(!Array.isArray(m.ids))return;
          const ids=new Set(m.ids);
          // An ACK for a previous retry must not release a newer batch.
          if(![...flightIds].some(id=>ids.has(id)))return;
          accepted+=queue.filter(e=>ids.has(e.eventId)).length;queue=queue.filter(e=>!ids.has(e.eventId));
          for(const id of ids)flightIds.delete(id);
          if(!flightIds.size)clearFlight();
          await persist();flush();
        }else if(m.kind==='drain'){
          captureReady=false;draining=true;drainWaiting=true;await notify('drain');
          // content flush messages are queued before its reply; finish after those handlers.
          serial=serial.then(()=>{drainWaiting=false;flush();});
        }else if(m.kind==='error'){error=m.error;clearFlight();}
      }).catch(e=>{error=String(e);});
    });
    p.onDisconnect.addListener(()=>{if(port!==p)return;error=chrome.runtime.lastError?.message||'桌面应用未连接';port=null;connected=false;captureReady=false;session=null;clearFlight();void notify('session',null);badge();setTimeout(connect,2000);});
  }catch(e){error=String(e);}
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(m.kind==='reconnect'){const previous=port;port=null;connected=false;captureReady=false;session=null;clearFlight();previous?.disconnect();void notify('session',null);badge();connect();reply({ok:true});return false;}
  if(m.kind==='status'){connect();reply({connected,session,captureReady,pending:queue.length,accepted,error});return false;}
  // Serialize storage and native ACK operations so fast events cannot overwrite a queue snapshot.
  serial=serial.then(async()=>{await ready;
    if(m.kind==='capture'){
      if(!session||!Number.isInteger(sender.tab?.id)||m.event?.sessionId!==session.id){reply({ok:false});return;}
      // Trust only our isolated content script's focus-at-capture flag, not focus
      // at receipt: a debounced input may arrive after the user switched tabs.
      if(m.focusedAtCapture!==true){reply({ok:false});return;}
      if(queue.length>=2000||new TextEncoder().encode(JSON.stringify(queue)).length>8*1024*1024){error='浏览器待同步事件已满，采集暂停';port?.postMessage({kind:'capture-error',error});reply({ok:false});return;}
      queue.push({...m.event,tabId:sender.tab.id,frameId:sender.frameId??0,documentId:sender.documentId});await persist();flush();reply({ok:true});
    }else if(m.kind==='content-ready'){
      if(sender.tab?.id!==undefined){const docs=frames.get(sender.tab.id)??new Map();docs.set(sender.frameId??0,sender.documentId?{documentId:sender.documentId}:{frameId:sender.frameId??0});frames.set(sender.tab.id,docs);}
      reply({session:sender.tab?.id!==undefined?session:null});
    }
  }).catch(e=>{error=String(e);reply({ok:false,error});});
  return true;
});
chrome.tabs.onRemoved.addListener(id=>{frames.delete(id);});
chrome.alarms.create('reconnect',{periodInMinutes:0.5});
chrome.alarms.onAlarm.addListener(()=>{connect();if(!inFlight)flush();});
void ready.then(()=>{connect();badge();});
