import sharp from "sharp";
import { AnalysisSchema } from "../common/analysis";
import { createReadTools } from "../electron/builders/read-tools";
/** Optional real-Chrome integration test. Uses a fresh profile, never the user's tabs.
 * macOS only: briefly installs a test native-host registration, restores it in finally.
 * Fixture manifest pre-grants only the loopback test site; production captures all HTTP/HTTPS sites.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,cpSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {BrowserBridge} from '../electron/browser/bridge';
import {SessionStore} from '../electron/recorder/session-store';
import {EventBus} from '../electron/recorder/event-bus';
import {createLogger} from '../electron/logger';
import {processSession} from '../electron/pipeline';
import {createDescriberTools} from '../electron/describer/tools';
const chrome=process.env.SKILL_RECORDER_TEST_CHROME??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if(process.platform!=='darwin'||!existsSync(chrome))throw new Error('Set SKILL_RECORDER_TEST_CHROME to Chrome 155+ on macOS');
const root=mkdtempSync(path.join(os.tmpdir(),'skill-recorder-chrome-e2e-'));
const registry=path.join(os.homedir(),'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.skillrecorder.browser.json');
const backup=existsSync(registry)?readFileSync(registry):null;
process.env.SKILL_RECORDER_SESSIONS_DIR=path.join(root,'sessions');
let browser:ReturnType<typeof spawn>|null=null,store:SessionStore|null=null;
const bridge=new BrowserBridge(path.join(root,'companion'),process.cwd());
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(req.url==='/frame'?`<button id="frame-save" onclick="this.textContent='完成'">框架保存</button>`:`<!doctype html><title>浏览器采集验证</title><style>body{padding:30px}input,select,button{display:block;margin:15px;height:30px}iframe{width:400px;height:150px}#save{width:120px}#space{height:1600px}</style><button id="save" onclick="this.textContent='保存完成'">保存设置</button><input id="name" aria-label="用户名"><input id="password" type="password" aria-label="密码"><select id="mode" aria-label="模式" size="2" style="height:60px"><option value="one">一</option><option value="two">二</option></select><button id="nav" onclick="history.pushState({},'', '/next');this.textContent='下一页'">下一页</button><iframe src="/frame"></iframe><div id="space"></div>`);});
const wait=async(predicate:()=>boolean|Promise<boolean>,label:string)=>{const start=Date.now();while(!await predicate()){if(Date.now()-start>10000)throw new Error(`Timeout: ${label}`);await new Promise(r=>setTimeout(r,30));}};
try{
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 await bridge.initialize();
 mkdirSync(path.join(root,"chrome-profile/NativeMessagingHosts"),{recursive:true});
 cpSync(registry,path.join(root,"chrome-profile/NativeMessagingHosts/com.skillrecorder.browser.json"));
 const extension=path.join(root,'extension');cpSync('browser-extension',extension,{recursive:true});
 const manifest=JSON.parse(readFileSync(path.join(extension,'manifest.json'),'utf8'));manifest.host_permissions=[origin+'/*'];manifest.content_scripts[0].matches=[origin+'/*'];writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
 const chromeEnv={...process.env};delete chromeEnv.__CFBundleIdentifier;delete chromeEnv.LaunchInstanceID;
 browser=spawn(chrome,[`--user-data-dir=${root}/chrome-profile`,'--remote-debugging-pipe','--enable-unsafe-extension-debugging','--no-first-run','--no-default-browser-check'],{env:chromeEnv,stdio:['ignore','ignore','pipe','pipe','pipe']});browser.stderr?.on('data',()=>{});
 let buffer='',id=0;const pending=new Map<number,{resolve:(value:any)=>void;reject:(e:Error)=>void}>();
 browser.stdio[4]!.on('data',chunk=>{buffer+=chunk;let pos;while((pos=buffer.indexOf('\0'))>=0){const m=JSON.parse(buffer.slice(0,pos));buffer=buffer.slice(pos+1);if(m.id){const entry=pending.get(m.id);pending.delete(m.id);if(m.error)entry?.reject(new Error(JSON.stringify(m.error)));else entry?.resolve(m.result);}}});
 const call=(method:string,params:unknown={},sessionId?:string):Promise<any>=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});(browser!.stdio[3] as any).write(JSON.stringify({id:n,method,params,...(sessionId?{sessionId}:{})})+'\0');});
 const attach=async(targetId:string)=>(await call('Target.attachToTarget',{targetId,flatten:true})).sessionId as string;
 const evaluate=async(sessionId:string,expression:string)=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},sessionId);if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await call('Extensions.loadUnpacked',{path:extension});
 await wait(()=>bridge.status().connected,'native host connect');
 const tab=await call('Target.createTarget',{url:origin});const page=await attach(tab.targetId);
 await wait(()=>evaluate(page,"document.readyState==='complete'"),'fixture loaded');
 const extensionId=JSON.parse(readFileSync('browser-extension/identity.json','utf8')).id;
 const popup=await call('Target.createTarget',{url:`chrome-extension://${extensionId}/popup.html`});const control=await attach(popup.targetId);
 await wait(()=>evaluate(control,"typeof chrome?.runtime?.sendMessage==='function'"),'extension control loaded');
 const meta={id:'chrome-real-test',startedAt:Date.now(),stoppedAt:null,platform:process.platform,appVersion:'test'};
 store=new SessionStore(meta);const bus=new EventBus();bus.attach(store);
 bridge.start({sessionDir:store.dir,log:createLogger('browser-smoke'),publish:(type,payload)=>{bus.publish({type,source:'chrome-extension',payload} as any);},publishDurable:(type,payload)=>bus.publishDurable({type,source:'chrome-extension',payload} as any)});
 await wait(async()=>{const s=await evaluate(control,"chrome.runtime.sendMessage({kind:'status'})");return s?.session?.id===meta.id&&s.captureReady;},'extension recording lifecycle');
 await call('Target.activateTarget',{targetId:tab.targetId});await call('Page.bringToFront',{},page);
 const capturedFrames:any[]=[];mkdirSync(path.join(store.dir,'video-frames'));
 const snapshot=async()=>{const bytes=Buffer.from((await call('Page.captureScreenshot',{format:'jpeg',quality:75},page)).data,'base64');const info=await sharp(bytes).metadata();const tMs=Date.now();const file=`video-frames/capture-${capturedFrames.length}.jpg`;writeFileSync(path.join(store!.dir,file),bytes);capturedFrames.push({file,tMs,offsetMs:tMs-meta.startedAt,width:info.width,height:info.height});};
 const clicks=async(selector:string,sessionId=page)=>{const rect=await evaluate(sessionId,`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',...rect,button:'left',clickCount:1},sessionId);await call('Input.dispatchMouseEvent',{type:'mouseReleased',...rect,button:'left',clickCount:1},sessionId);};
 await wait(()=>evaluate(page,'document.hasFocus()'),'Chrome page focused');
 await clicks('#save');await clicks('#name');await call('Input.insertText',{text:'测试用户'},page);
 await wait(()=>bridge.status().eventCount>=3,'real click/input persisted');await snapshot();
 await clicks('#password');await call('Input.insertText',{text:'NEVER_SAVE_THIS_PASSWORD'},page);
 await clicks('#mode option[value=two]');
 await wait(()=>readFileSync(path.join(store!.dir,'events.jsonl'),'utf8').includes('"action":"change"'),'real select change');
 await clicks('#nav');await wait(()=>evaluate(page,"location.pathname==='/next'"),'SPA route changed');
 await wait(()=>readFileSync(path.join(store!.dir,'events.jsonl'),'utf8').includes('/next'),'SPA event persisted');
 // Real click in the same-origin iframe, with top-level viewport dispatch.
 const frameRect=await evaluate(page,"(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return{x:r.x+40,y:r.y+20}})()");
 await call('Input.dispatchMouseEvent',{type:'mousePressed',...frameRect,button:'left',clickCount:1},page);await call('Input.dispatchMouseEvent',{type:'mouseReleased',...frameRect,button:'left',clickCount:1},page);
 await wait(()=>readFileSync(path.join(store!.dir,'events.jsonl'),'utf8').includes('frame-save'),'iframe real click');
 // A last input is immediately followed by Stop, before its 350ms debounce fires.
 await clicks('#name');await call('Input.insertText',{text:'结束前的输入'},page);
 await snapshot();await bridge.stop();bus.detach();store.finalize(Date.now());await store.whenClosed();
 writeFileSync(path.join(store.dir,'video-frames.json'),JSON.stringify({version:1,format:'jpeg',heartbeatMs:1000,frames:capturedFrames}));
 writeFileSync(path.join(store.dir,'video.json'),JSON.stringify({file:'screen.webm',startEpoch:meta.startedAt,durationMs:Date.now()-meta.startedAt,framesFile:'video-frames.json'}));
 const lines=readFileSync(path.join(store.dir,'events.jsonl'),'utf8'),events=lines.trim().split('\n').map(s=>JSON.parse(s));
 assert.ok(!lines.includes('NEVER_SAVE_THIS_PASSWORD'),'password leaked');
 assert.ok(events.some(e=>e.payload.action==='click'&&e.payload.element?.locators.some((l:any)=>l.value==='#save'&&l.unique)));
 assert.ok(events.some(e=>e.payload.action==='input'&&e.payload.element?.value?.includes('结束前的输入')),'last debounced input lost');
 assert.ok(events.some(e=>e.payload.frameId!==0&&e.payload.element?.locators.some((l:any)=>l.value==='#frame-save')));
 const count=events.length;await clicks('#save');await new Promise(r=>setTimeout(r,600));assert.equal(readFileSync(path.join(store.dir,'events.jsonl'),'utf8'),lines,'events captured after stop');
 await processSession(store.dir);const bundle=JSON.parse(readFileSync(path.join(store.dir,'bundle.json'),'utf8'));assert.equal(bundle.stats.meaningfulEventCount,count);assert.ok(bundle.stats.frameCount>0);
 const correlation=JSON.parse(readFileSync(path.join(store.dir,'correlation.json'),'utf8'));assert.ok(correlation.frames.some((f:any)=>f.nearestEventSeqs.some((seq:number)=>events[seq]?.type==='browser.action')));
 let submitted:any=null;const tools=createDescriberTools({sessionDir:store.dir,startedAt:meta.startedAt,extractor:null,redaction:{current:null},onSubmit:data=>{submitted=data;}});
 const invoke=(name:string,args:unknown={})=>tools.find(t=>t.name===name)!.handler(args,{sessionId:meta.id,toolCallId:'smoke',toolName:name,arguments:args});
 const timeline=JSON.parse(String(await invoke('get_timeline')));assert.equal(timeline.browserCoverage.total,count);
 const input=JSON.parse(String(await invoke('get_browser_actions')));assert.equal(input.events.length,count);
 await invoke('submit_analysis',{title:'浏览器采集验证',intent:'保存设置',steps:[{id:'save',title:'保存设置',detail:'真实点击保存设置按钮，定位候选 #save。填写用户名并切换页面。',browserEventIds:events.map(e=>e.payload.eventId)}]});assert.ok(submitted);
 const analysis=AnalysisSchema.parse({version:1,sessionId:meta.id,revision:1,createdAt:Date.now(),...submitted,feedbackLog:[]});writeFileSync(path.join(store.dir,'analysis.json'),JSON.stringify(analysis,null,2));
 assert.deepEqual(analysis.steps[0].browserEventIds,events.map(e=>e.payload.eventId));
 const builderTool=createReadTools({sessionDir:store.dir,analysis}).find(t=>t.name==='get_browser_targets')!;const targets=JSON.parse(String(await builderTool.handler({}, {sessionId:meta.id,toolCallId:'builder',toolName:builderTool.name,arguments:{}})));assert.equal(targets.total,count);assert.ok(JSON.stringify(targets).includes('#save'));
 const report={chrome:'real installed Chrome',events:count,actions:events.reduce((a:any,e)=>{a[e.payload.action]=(a[e.payload.action]??0)+1;return a;},{}),checks:['trusted clicks','select change','unique CSS candidate','input values','password excluded','SPA navigation','iframe identity','final input drain','stop exclusion','bundle eventSeqs','screenshot correlation','persisted analysis event references','builder locator input','model browser evidence','analysis submission'],artifacts:store.dir};
 writeFileSync(path.join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 await call('Browser.close');browser=null;
}finally{
 browser?.kill();server.close();bridge.close();store?.dispose();if(backup)writeFileSync(registry,backup);else rmSync(registry,{force:true});
 console.log(`Smoke artifacts: ${root}`);
}
