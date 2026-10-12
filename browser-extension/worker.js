const HOST='com.skillrecorder.browser';
let port=null,session=null,boundTab=null,queue=[],inFlight=false,draining=false,drainWaiting=false,error=null,accepted=0;
let serial=Promise.resolve();
const frames=new Map();
const ready=chrome.storage.local.get(['boundTab','queue']).then(s=>{boundTab=Number.isInteger(s.boundTab)?s.boundTab:null;queue=Array.isArray(s.queue)?s.queue.slice(0,2000):[];});
const persist=()=>chrome.storage.local.set({boundTab,queue});
const badge=()=>{chrome.action.setBadgeText({text:session&&boundTab!==null?'录制':''});chrome.action.setBadgeBackgroundColor({color:'#c2410c'});};
async function notify(kind,active=session){
  if(boundTab===null)return;
  const targets=[...(frames.get(boundTab)?.values()??[])];
  if(!targets.length)targets.push({frameId:0});
  await Promise.all(targets.map(async options=>{try{await chrome.tabs.sendMessage(boundTab,{kind,session:active},options);}catch{/* A navigated document has gone away. */}}));
}
function flush(){
  if(!port||!session||inFlight)return;
  if(!queue.length){if(draining && !drainWaiting){port.postMessage({kind:'drained'});draining=false;}return;}
  const batch=[];let bytes=0;
  for(const event of queue.slice(0,50)){const size=new TextEncoder().encode(JSON.stringify(event)).length;if(batch.length && bytes+size>200*1024)break;batch.push(event);bytes+=size;}
  inFlight=true;port.postMessage({kind:'events',events:batch});
}
function connect(){
  if(port)return;
  try{
    const p=chrome.runtime.connectNative(HOST);port=p;
    p.onMessage.addListener(m=>{
      serial=serial.then(async()=>{await ready;if(port!==p)return;
        if(m.kind==='session'){
          const next=m.session??null;
          if(next?.id!==session?.id){queue=queue.filter(e=>e.sessionId===next?.id);accepted=0;}
          session=next;error=null;inFlight=false;draining=false;drainWaiting=false;await persist();await notify('session');badge();p.postMessage({kind:'bound',bound:boundTab!==null});flush();
        }else if(m.kind==='ack'){
          const ids=new Set(m.ids);accepted+=queue.filter(e=>ids.has(e.eventId)).length;queue=queue.filter(e=>!ids.has(e.eventId));inFlight=false;await persist();flush();
        }else if(m.kind==='drain'){
          draining=true;drainWaiting=true;await notify('drain');
          // content flush messages are queued before its reply; finish after those handlers.
          serial=serial.then(()=>{drainWaiting=false;flush();});
        }else if(m.kind==='error'){error=m.error;inFlight=false;}
      }).catch(e=>{error=String(e);});
    });
    p.onDisconnect.addListener(()=>{error=chrome.runtime.lastError?.message||'桌面应用未连接';if(port===p)port=null;session=null;inFlight=false;void notify('session',null);badge();setTimeout(connect,2000);});
  }catch(e){error=String(e);}
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  // Serialize storage and native ACK operations so fast events cannot overwrite a queue snapshot.
  serial=serial.then(async()=>{await ready;
    if(m.kind==='capture'){
      if(!session||sender.tab?.id!==boundTab||m.event?.sessionId!==session.id){reply({ok:false});return;}
      // Trust only our isolated content script's focus-at-capture flag, not focus
      // at receipt: a debounced input may arrive after the user switched tabs.
      if(m.focusedAtCapture!==true){reply({ok:false});return;}
      if(queue.length>=2000||new TextEncoder().encode(JSON.stringify(queue)).length>8*1024*1024){error='浏览器待同步事件已满，采集暂停';port?.postMessage({kind:'capture-error',error});reply({ok:false});return;}
      queue.push({...m.event,tabId:boundTab,frameId:sender.frameId??0,documentId:sender.documentId});await persist();flush();reply({ok:true});
    }else if(m.kind==='content-ready'){
      if(sender.tab?.id!==undefined){const docs=frames.get(sender.tab.id)??new Map();docs.set(sender.frameId??0,sender.documentId?{documentId:sender.documentId}:{frameId:sender.frameId??0});frames.set(sender.tab.id,docs);}
      reply({session:sender.tab?.id===boundTab?session:null});
    }else if(m.kind==='bind'){
      await notify('drain');
      // Process pending captures from the old document before changing its binding.
      serial=serial.then(async()=>{boundTab=m.tabId;await persist();await notify('session');port?.postMessage({kind:'bound',bound:true});badge();reply({ok:true});}).catch(e=>reply({ok:false,error:String(e)}));
    }else if(m.kind==='unbind'){await notify('drain');serial=serial.then(async()=>{boundTab=null;await persist();port?.postMessage({kind:'bound',bound:false});badge();reply({ok:true});}).catch(e=>reply({ok:false,error:String(e)}));
    }else if(m.kind==='status'){connect();reply({connected:!!port,session,boundTab,pending:queue.length,accepted,error});}
  }).catch(e=>{error=String(e);reply({ok:false,error});});
  return true;
});
chrome.tabs.onRemoved.addListener(id=>{frames.delete(id);if(id===boundTab){boundTab=null;void persist();port?.postMessage({kind:'bound',bound:false});badge();}});
chrome.alarms.create('reconnect',{periodInMinutes:0.5});
chrome.alarms.onAlarm.addListener(()=>{connect();if(!inFlight)flush();});
void ready.then(async()=>{if(boundTab!==null){try{await chrome.tabs.get(boundTab);}catch{boundTab=null;await persist();}}connect();});
