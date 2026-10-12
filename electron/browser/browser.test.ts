import { AnalysisSchema } from "../../common/analysis";
import { createReadTools } from "../builders/read-tools";
import test from "node:test";
import { once } from "node:events";
import { rm } from "node:fs/promises";
import assert from "node:assert/strict";
import { mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { validateBrowserEvent } from "./protocol";
import { BrowserBridge } from "./bridge";
import { SessionStore } from "../recorder/session-store";
import { EventBus } from "../recorder/event-bus";
import { createLogger } from "../logger";
import { processSession } from "../pipeline";
import { createDescriberTools } from "../describer/tools";
import { scanSession, buildRedactor } from "../sensitive/scanner";

const event=(sessionId="browser-test",capturedAt=Date.now())=>({eventId:"real-click-1",sessionId,capturedAt,action:"click",url:"https://user:pass@example.com/settings?token=secret#detail",title:"设置",tabId:1,frameId:0,viewport:{width:1000,height:800,dpr:2,scrollX:0,scrollY:0},point:{x:20,y:30},element:{tag:"button",name:"保存",locators:[{kind:"css",value:"#save",unique:true}],bounds:{x:10,y:10,width:60,height:30}}});
test("browser protocol rejects stale/future/invalid events and strips credentials",()=>{
 const now=Date.now(),raw=event("browser-test",now-500);
 const accepted=validateBrowserEvent(raw,"browser-test",now-1000,now);
 assert.equal(accepted.capturedAt,now-500);assert.equal(accepted.url,"https://example.com/settings");
 assert.equal(accepted.coordinateSpace,"css-viewport");
 assert.throws(()=>validateBrowserEvent(raw,"different",now-1000,now),/stale/);
 assert.throws(()=>validateBrowserEvent({...raw,capturedAt:now-2000},"browser-test",now-1000,now),/capture time/);
 assert.throws(()=>validateBrowserEvent({...raw,capturedAt:now+3000},"browser-test",now-1000,now),/capture time/);
 assert.throws(()=>validateBrowserEvent({...raw,viewport:{...raw.viewport,dpr:Infinity}},"browser-test",now-1000,now));
 const protectedEvent=validateBrowserEvent({...raw,element:{...raw.element,inputType:"password",name:"密码",value:"SHOULD_NEVER_LEAK",text:"SHOULD_NEVER_LEAK"}},"browser-test",now-1000,now);
 assert.equal(protectedEvent.element?.redacted,true);assert.ok(!JSON.stringify(protectedEvent).includes("SHOULD_NEVER_LEAK"));
});

const binary=path.join(process.cwd(),"native/bin",`${process.platform==='win32'?'windows':process.platform}-${process.arch==='x64'?'amd64':process.arch}`,process.platform==='win32'?'browser-host.exe':'browser-host');
test("native host → durable session → timeline → required model evidence, with retry and stop",{skip:!existsSync(binary)},async()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),"browser-chain-")),previous=process.env.SKILL_RECORDER_SESSIONS_DIR;
 process.env.SKILL_RECORDER_SESSIONS_DIR=path.join(root,"sessions");
 const bridge=new BrowserBridge(path.join(root,"profile"),process.cwd());let host:ReturnType<typeof spawn>|undefined,store:SessionStore|undefined;
 try{
  await bridge.initialize(false);
  const meta={id:"browser-test",startedAt:Date.now()-1000,stoppedAt:null,platform:process.platform,appVersion:"test"};
  store=new SessionStore(meta);const bus=new EventBus();bus.attach(store);
  bridge.start({sessionDir:store.dir,log:createLogger("test"),publish:(type,payload)=>{bus.publish({type,source:"chrome-extension",payload} as any);},publishDurable:(type,payload)=>bus.publishDurable({type,source:"chrome-extension",payload} as any)});
  const helperDir=path.join(root,'profile/browser-companion');
  const { readdirSync } = await import('node:fs');
  const helper=readdirSync(helperDir).find(file=>file.endsWith(path.basename(binary)))!;
  host=spawn(path.join(helperDir,helper),[],{stdio:['pipe','pipe','pipe']});
  let buffer=Buffer.alloc(0);const messages:any[]=[];
  host.stdout!.on('data',(chunk:Buffer)=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4&&buffer.length>=buffer.readUInt32LE(0)+4){const n=buffer.readUInt32LE(0);messages.push(JSON.parse(buffer.subarray(4,4+n).toString()));buffer=buffer.subarray(4+n);}});
  const send=(value:unknown)=>{const b=Buffer.from(JSON.stringify(value)),h=Buffer.alloc(4);h.writeUInt32LE(b.length);host!.stdin!.write(Buffer.concat([h,b]));};
  const wait=async(predicate:()=>boolean)=>{const start=Date.now();while(!predicate()){if(Date.now()-start>10000)throw new Error('Native bridge timeout; received kinds: '+messages.map(m=>m.kind).join(',')+'; bridge: '+JSON.stringify(bridge.status()));await new Promise(r=>setTimeout(r,10));}};
  await wait(()=>messages.some(m=>m.kind==='session'));
  const raw=event(meta.id,Date.now()-500);send({kind:'events',events:[raw]});
  await wait(()=>messages.filter(m=>m.kind==='ack').length===1);
  const persisted=JSON.parse(readFileSync(path.join(store.dir,'events.jsonl'),'utf8').trim());
  assert.equal(persisted.payload.element.locators[0].value,'#save');assert.equal(persisted.epoch,raw.capturedAt);assert.equal(persisted.t,raw.capturedAt-meta.startedAt);
  send({kind:'events',events:[raw]});await wait(()=>messages.filter(m=>m.kind==='ack').length===2);assert.equal(store.eventCount,1);
  send({kind:'events',events:[{...raw,eventId:'stale',sessionId:'old-session'}]});await wait(()=>messages.some(m=>m.kind==='error'));assert.equal(store.eventCount,1);
  // Verify the last input, already captured but not yet transmitted, is included before drain ACK.
  const stop=bridge.stop();await wait(()=>messages.some(m=>m.kind==='drain'));
  send({kind:'events',events:[{...raw,eventId:'last-input',action:'input',element:{...raw.element,tag:'input',value:'person@example.com'}}]});
  await wait(()=>messages.filter(m=>m.kind==='ack').length===3);send({kind:'drained'});await stop;
  bus.detach();store.finalize(Date.now());await store.whenClosed();
  send({kind:'events',events:[{...raw,eventId:'after-stop'}]});await new Promise(r=>setTimeout(r,30));assert.equal(store.eventCount,2);
  await processSession(store.dir);
  const bundle=JSON.parse(readFileSync(path.join(store.dir,'bundle.json'),'utf8'));assert.equal(bundle.stats.meaningfulEventCount,2);assert.deepEqual(bundle.steps[0].eventSeqs,[0,1]);assert.deepEqual(bundle.steps[0].browserEventIds,["real-click-1","last-input"]);
  const scan=await scanSession(meta.id);assert.ok(scan.values.includes('person@example.com'),'nested input should be scanned');
  let submitted=false;const tools=createDescriberTools({sessionDir:store.dir,startedAt:meta.startedAt,extractor:null,redaction:{current:{redactText:buildRedactor(scan.values),frameRedactor:null}},onSubmit:()=>{submitted=true;}});
  const invoke=(name:string,args:unknown={})=>tools.find(t=>t.name===name)!.handler(args,{sessionId:meta.id,toolCallId:'test',toolName:name,arguments:args});
  const timeline=JSON.parse(String(await invoke('get_timeline')));assert.equal(timeline.browserCoverage.total,2);assert.equal(timeline.steps[0].browserActionCount,2);
  const draft={title:'保存设置',intent:'保存设置',steps:[{id:'s1',title:'保存',detail:'点击保存按钮，定位候选 #save',browserEventIds:['real-click-1','last-input']}]};
  const rejection=await invoke('submit_analysis',draft) as any;assert.match(rejection.textResultForLlm,/get_browser_actions/);assert.equal(submitted,false);
  const evidence=String(await invoke('get_browser_actions'));assert.ok(evidence.includes('#save'));assert.ok(!evidence.includes('person@example.com'));
  const unlinked=await invoke('submit_analysis',{...draft,steps:draft.steps.map(s=>({...s,browserEventIds:[]}))}) as any;
  assert.match(unlinked.textResultForLlm,/missing from the trajectory/);assert.equal(submitted,false);
  const badRefs=await invoke('submit_analysis',{...draft,steps:draft.steps.map(s=>({...s,browserEventIds:['unknown']}))}) as any;
  assert.match(badRefs.textResultForLlm,/Unknown browserEventIds/);
  await invoke('submit_analysis',draft);assert.equal(submitted,true);
  const analysis=AnalysisSchema.parse({version:1,sessionId:meta.id,revision:1,createdAt:Date.now(),intent:draft.intent,intentConfidence:'high',intentRationale:'实际浏览器操作',steps:draft.steps,feedbackLog:[]});
  const builderTool=createReadTools({sessionDir:store.dir,analysis}).find(t=>t.name==='get_browser_targets')!;
  const targets=String(await builderTool.handler({}, {sessionId:meta.id,toolCallId:'builder',toolName:builderTool.name,arguments:{}}));
  assert.ok(targets.includes('#save'));assert.ok(!targets.includes('person@example.com'));assert.equal(JSON.parse(targets).total,2);

 }finally{
  if(host && host.exitCode===null && host.signalCode===null){const exited=once(host,'exit');host.kill();await exited;}
  bridge.close();store?.dispose();await store?.whenClosed();
  if(previous===undefined)delete process.env.SKILL_RECORDER_SESSIONS_DIR;else process.env.SKILL_RECORDER_SESSIONS_DIR=previous;
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
 }
});

test("long browser recordings require all pages, including final operations",async()=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'browser-pages-'));
 try{
  writeFileSync(path.join(dir,'events.jsonl'),Array.from({length:201},(_,seq)=>JSON.stringify({seq,epoch:1000+seq*1000,type:'browser.action',payload:{...event('long',1000+seq*1000),eventId:`click-${seq}`}})).join('\n'));
  const tools=createDescriberTools({sessionDir:dir,startedAt:1000,extractor:null,redaction:{current:null},onSubmit:()=>{}});
  const invoke=(name:string,args:unknown={})=>tools.find(t=>t.name===name)!.handler(args,{sessionId:'long',toolCallId:'test',toolName:name,arguments:args});
  const first=JSON.parse(String(await invoke('get_browser_actions')));assert.equal(first.events.length,100);assert.equal(first.nextOffset,100);
  const reject=await invoke('submit_analysis',{}) as any;assert.match(reject.textResultForLlm,/offset=100/);
  await invoke('get_browser_actions',{offset:100});assert.match((await invoke('submit_analysis',{}) as any).textResultForLlm,/offset=200/);
  const last=JSON.parse(String(await invoke('get_browser_actions',{offset:200})));assert.equal(last.events[0].atMs,200000);assert.equal(last.nextOffset,null);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
