/** Isolated DOM regression: never starts Electron, calls real Agents, or reads user settings.
 * Usage: SKILL_RECORDER_JSDOM_MODULE=/path/to/jsdom/lib/api.js node scripts/settings-ui-smoke.mjs
 * jsdom is deliberately optional; normal npm test needs no extra dependency.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
const jsdomPath = process.env.SKILL_RECORDER_JSDOM_MODULE;
if (!jsdomPath) throw new Error('Set SKILL_RECORDER_JSDOM_MODULE to an installed jsdom module.');
const { JSDOM } = await import(pathToFileURL(jsdomPath).href);
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/#settings/ai', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent']) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLElement.prototype.scrollTo = () => {};
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'settings-ui-'));
symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
try {
  await build({ configFile: false, logLevel: 'error', build: { outDir: temporary, emptyOutDir: false, lib: { entry: path.resolve('src/SettingsWindow.tsx'), formats: ['es'], fileName: () => 'settings.mjs' }, rollupOptions: { external: ['react', 'react/jsx-runtime'] } } });
  const { SettingsWindow } = await import(pathToFileURL(path.join(temporary, 'settings.mjs')).href);
  const listeners = new Map();
  const listen = name => cb => { listeners.set(name, cb); return () => listeners.delete(name); };
  let closes = 0, saves = 0, failSave = false, voiceSaves = 0, privacySaves = 0;
  let narrationLanguage = "zh";
  let ai = { baseUrl: 'https://example.test/v1', model: 'original', hasApiKey: true, configured: true, environmentOverride: false };
  let processingState;
  let managedSaves = 0;
  let mailSaves = 0;
  const processing = { ready: true, backend: 'local-agent', error: null, settings: { backendPreference: 'local-agent', defaultProcessingWorkspaceId: 'test', workspaces: [{ id: 'test', name: '测试', projectDirectory: '/synthetic/project' }] }, availability: { status: 'available', agentVersion: '2.1.251' } };
  processingState = processing;
  let privacy = { enabled: true, ocr: 'ready', error: null, progress: null };
  const api = {
    closeSettings: async () => { closes++; },
    onSettingsChanged: listen('changed'), onSettingsCloseRequested: listen('close'), onSettingsSection: listen('section'),
    aiSettings: async () => ai,
    saveAiSettings: async input => { saves++; if (failSave) return { ok: false, error: '模拟保存失败' }; ai = { ...ai, ...input }; return { ok: true, settings: ai }; },
    processing: async action => {
      if (action.kind === 'builtin-status') return {ok:true,builtins:{mail:null}};
      if (action.kind === 'builtin-mail-save') { mailSaves++; assert.equal(action.account.address,'user@example.com'); return {ok:true}; }
      if (action.kind === 'save') return {ok:true,status:{...processingState,settings:action.settings}};
      if (action.kind === 'managed-sync') return {ok:true,preview:{baseRevision:'revision-1',sourceSnapshotId:'source-2',checkedAt:1,capabilities:processingState.managed.capabilities.map(c=>({...c,change:'added'})),coveredSources:[],omittedSources:[]}};
      if (action.kind === 'managed-save') { managedSaves++; processingState={...processingState,managed:{...processingState.managed,activeConfigRevision:'revision-2',capabilities:processingState.managed.capabilities.map(c=>({...c,enabled:action.input.enabledRefs.includes(c.ref)}))}}; return {ok:true,status:processingState}; }
      return {ok:true,status:processingState};
    },
    browserStatus: async () => ({ connected: false, browsers: [], error: null, extensionDir: '/synthetic/extension', sessionId: null }),
    sensitiveModelStatus: async () => privacy,
    setAdvancedProtection: async enabled => { privacySaves++; privacy = { ...privacy, enabled }; return { ok: true }; },
    status: async () => ({ state: 'idle', transition: 'none', narrationLanguage }),
    setNarrationLanguage: async language => { voiceSaves++; narrationLanguage = language; return { ok: true }; },
    narrationStatus: async () => ({ model: 'ready', phase: 'idle' }),
    onNarrationStatusChanged: listen('voice'), onSensitiveModelStatusChanged: listen('privacy'), onStatusChanged: listen('recorder'),
  };
  dom.window.skillRecorder = api;
  const root = createRoot(document.getElementById('root'));
  const settle = async fn => { await act(async () => { await fn?.(); await new Promise(r => setImmediate(r)); }); };
  const click = async label => { const el = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === label); assert.ok(el, `button ${label}`); await settle(() => el.click()); };
  const changeModel = async value => { const input = [...document.querySelectorAll('input')].find(e => e.placeholder === '服务商提供的模型名称'); assert.ok(input); await settle(() => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); };
  await settle(() => root.render(createElement(SettingsWindow)));
  assert.equal(document.querySelectorAll('.settings-window').length, 1);
  await changeModel('draft'); await click('浏览器插件');
  assert.ok(document.querySelector('[role="alertdialog"]'), 'dirty navigation asks first');
  await click('继续编辑'); assert.equal(document.querySelector('input[placeholder="服务商提供的模型名称"]').value, 'draft');
  await settle(() => listeners.get('close')()); assert.ok(document.querySelector('[role="alertdialog"]'), 'native close uses same guard');
  await click('放弃更改'); assert.equal(closes, 1); assert.equal(saves, 0);
  await changeModel('second draft'); failSave = true; await click('Agent 能力'); await click('保存并离开');
  assert.match(document.body.textContent, /模拟保存失败/); assert.equal(document.querySelector('input[placeholder="服务商提供的模型名称"]').value, 'second draft');
  failSave = false; await click('Agent 能力'); await click('保存并离开');
  assert.equal(document.querySelector('nav [aria-current="page"]').textContent, 'Agent 能力');
  assert.equal(ai.model, 'second draft'); assert.ok(document.querySelector('.processing-panel'));
  assert.equal(document.querySelector('.processing-panel').closest('.analysis-error'), null, 'configuration never inherits an error wrapper');
  processingState = {...processing,managed:{environmentId:'test',directory:'/synthetic/managed',activeConfigRevision:'revision-1',sourceSnapshotId:'source-1',checkedAt:1,isolationStatus:'verified',isolationMethod:'safe-mode',coveredSources:[],omittedSources:[],capabilities:[{ref:'skill-1',kind:'skill',name:'业务规则',description:'说明',source:'/synthetic/skill',enabled:false,reviewState:'confirmed',change:'unchanged',error:null}]}};
  await click('重新检查');
  assert.doesNotMatch(document.body.textContent,/关联 \/ 创建目录/);
  await click('刷新能力来源');
  assert.match(document.body.textContent,/复核来源变化/);
  let capability=document.querySelector('.managed-capability-row input');
  await settle(()=>capability.click());
  await click('保存处理设置');assert.equal(managedSaves,0,'selection needs explicit confirmation');
  const acknowledgement=[...document.querySelectorAll('label')].find(e=>e.textContent.includes('我已复核启用范围')).querySelector('input');
  await settle(()=>acknowledgement.click());
  const strategy=document.querySelector('select[aria-label="处理后端"]');
  await settle(()=>{strategy.value='api';strategy.dispatchEvent(new Event('change',{bubbles:true}));});
  await click('保存处理设置');assert.equal(managedSaves,1);
  assert.equal(processingState.managed.capabilities[0].enabled,true);
  assert.equal(document.querySelector('select[aria-label="处理后端"]').value,'api','combined save preserves the new capability revision and backend choice');
  for (const [label,value] of [['邮箱地址','user@example.com'],['登录用户名','user@example.com'],['IMAP 服务器','imap.example.com'],['SMTP 服务器','smtp.example.com'],['邮箱密码或授权码','synthetic-password']]) {
    const input=document.querySelector(`input[aria-label="${label}"]`);
    await settle(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});
  }
  await click('浏览器插件');assert.ok(document.querySelector('[role="alertdialog"]'),'mail edits participate in the settings dirty guard');
  await click('保存并离开');assert.equal(mailSaves,1);
  assert.match(document.body.textContent, /Google Chrome/); assert.match(document.body.textContent, /Microsoft Edge/);
  await click('语音转写');
  assert.equal(document.querySelector('input[type="checkbox"]'), null, 'voice excludes privacy controls'); await settle(() => listeners.get('recorder')({ state: 'recording', transition: 'none', narrationLanguage: 'zh' }));
  assert.ok(document.querySelector('select').disabled, 'recording locks conflicting settings');
  await settle(() => listeners.get('recorder')({ state: 'idle', transition: 'none', narrationLanguage: 'zh' }));
  const language = document.querySelector('select');
  await settle(() => { language.value = 'en'; language.dispatchEvent(new Event('change', { bubbles: true })); });
  await click('隐私保护'); assert.ok(document.querySelector('[role="alertdialog"]'), 'voice has independent dirty guard');
  await click('保存并离开');
  assert.equal(voiceSaves, 1); assert.equal(privacySaves, 0, 'saving voice does not save privacy');
  assert.equal(document.querySelector('select'), null, 'privacy excludes voice controls');
  const protection = document.querySelector('input[type="checkbox"]');
  await settle(() => protection.click());
  assert.equal(privacy.enabled, true, 'editing does not immediately change privacy settings');
  await click('保存设置'); assert.equal(privacy.enabled, false); assert.equal(privacySaves, 1); assert.equal(voiceSaves, 1);
  assert.match(document.body.textContent, /设置已保存/);
  await settle(() => root.unmount());
  await build({ configFile: false, logLevel: 'error', build: { outDir: temporary, emptyOutDir: false, lib: { entry: path.resolve('src/EnhancementWorkspace.tsx'), formats: ['es'], fileName: () => 'enhancement.mjs' }, rollupOptions: { external: ['react', 'react/jsx-runtime', 'react-dom'] } } });
  const { EnhancementWorkspace } = await import(pathToFileURL(path.join(temporary, 'enhancement.mjs')).href);
  processingState = { ...processing, ready: false, error: '请选择并信任一个 Agent 项目目录。' };
  const enhanceRoot = createRoot(document.getElementById('root'));
  const failed={run:{runId:'run',status:'failed',error:'Claude Code 认证不可用'},package:{preparationId:'prep',status:'frozen',questions:[],answers:[],gaps:[],materials:[],userNotes:'',revision:1},progress:[]};
  await settle(() => enhanceRoot.render(createElement(EnhancementWorkspace, { sessionId: 'synthetic', workflow: failed, analysis: { steps: [] }, onWorkflow: () => {}, onGenerate: () => {} })));
  assert.match(document.body.textContent, /请选择并信任/);
  assert.match(document.body.textContent,/深度分析未完成/);
  assert.match(document.body.textContent,/Claude Code 认证不可用/);
  processingState = processing;
  await settle(() => listeners.get('changed')());
  assert.doesNotMatch(document.body.textContent, /请选择并信任/);
  assert.ok([...document.querySelectorAll('button')].find(e => e.textContent === '重试'));
  assert.doesNotMatch(document.body.textContent,/准备深度分析/,'persisted failures cannot look like a new task');
  assert.equal(document.querySelector('.processing-panel'), null, 'enhancement contains no embedded configuration');
  const retryActions=[];
  window.skillRecorder.enhancement=async action=>{retryActions.push(action);return {ok:true,workflow:{...failed,run:null,package:{...failed.package,status:action.kind==='prepare'?'ready':'frozen'}}};};
  const paused={...failed,run:{...failed.run,status:'paused',activeMs:300001,budget:{activeMs:300000,maxExternalCalls:20},error:'累计时长预算已耗尽，请明确增加额度。'}};
  await settle(()=>enhanceRoot.render(createElement(EnhancementWorkspace,{sessionId:'synthetic',workflow:paused,analysis:{steps:[]},onWorkflow:()=>{},onGenerate:()=>{}})));
  assert.match(document.body.textContent,/基于原始材料重新规划/);
  await click('重试');
  assert.deepEqual(retryActions.map(action=>action.kind),['prepare','confirm','run']);
  assert.equal(retryActions[2].continueRun,false);assert.notEqual(retryActions[2].runId,'run');
  const identifying={version:1,package:{preparationId:'prep',status:'identifying',questions:[],answers:[],gaps:[],materials:[],userNotes:'',revision:1,clarificationPolicyVersion:2},run:null};
  await settle(()=>enhanceRoot.render(createElement(EnhancementWorkspace,{sessionId:'synthetic',workflow:identifying,analysis:{steps:[]},onWorkflow:()=>{},onGenerate:()=>{}})));
  assert.match(document.body.textContent,/正在深度分析/);
  assert.match(document.body.textContent,/规划分析与匹配工具/);
  assert.equal(document.querySelectorAll('[aria-current="step"]').length,1);
  const checking={...identifying,package:{...identifying.package,backend:'local-agent',preparedAt:Date.now()-1000},progress:[{sequence:100,at:Date.now(),phase:'checking',status:'running',title:'正在自检 Claude 与模型',detail:'等待模型返回有效结果。',model:'test-model[1m]'}]};
  await settle(()=>enhanceRoot.render(createElement(EnhancementWorkspace,{sessionId:'synthetic',workflow:checking,analysis:{steps:[]},onWorkflow:()=>{},onGenerate:()=>{}})));
  assert.match(document.querySelector('.deep-head h2').textContent,/正在检查连接/);
  assert.match(document.querySelector('[aria-current="step"]').textContent,/检查 Claude 与模型连接/);
  assert.match(document.querySelector('[aria-label="当前使用模型"]').textContent,/test-model\[1m\]/);
  assert.match(document.querySelector('.deep-live-action').textContent,/正在自检/);
  const ticking={...failed,run:{...failed.run,status:'running',phase:'reading',createdAt:Date.now()-2700000,attemptStartedAt:Date.now()},progress:[{sequence:100,at:Date.now(),phase:'reading',status:'running',title:'读取材料',detail:'Read',model:'claude-sonnet-4-6'}]};
  await settle(()=>enhanceRoot.render(createElement(EnhancementWorkspace,{sessionId:'synthetic',workflow:ticking,analysis:{steps:[]},onWorkflow:()=>{},onGenerate:()=>{}})));
  const totalClock=document.querySelector('[aria-label="本次任务总用时"]');assert.match(totalClock.textContent,/总用时 \d+ 秒/);assert.doesNotMatch(totalClock.textContent,/\./);
  assert.match(document.querySelector('[aria-label="当前使用模型"]').textContent,/claude-sonnet-4-6/);
  const clock=document.querySelector('[aria-label="当前步骤用时"]');assert.match(clock.textContent,/00:00\.\d{2}/);
  const before=clock.textContent;await new Promise(r=>setTimeout(r,35));assert.notEqual(clock.textContent,before);
  assert.match(document.querySelector('.deep-live-action').textContent,/读取材料/);
  const actionHistory={...ticking,progress:[{sequence:99,at:Date.now(),phase:'reading',status:'running',title:'已建立材料索引',detail:'2 个步骤'},{...ticking.progress[0],at:Date.now()},{sequence:101,at:Date.now(),phase:'reading',status:'running',title:'正在生成工具请求',detail:'mail / search'},{sequence:102,at:Date.now(),phase:'reading',status:'running',title:'正在生成工具请求',detail:'mail / search'}]};
  await settle(()=>enhanceRoot.render(createElement(EnhancementWorkspace,{sessionId:'synthetic',workflow:actionHistory,analysis:{steps:[]},onWorkflow:()=>{},onGenerate:()=>{}})));
  assert.equal(document.querySelectorAll('[aria-label="最近执行记录"] li').length,3);
  assert.match(document.querySelector('.deep-live-action').textContent,/已建立材料索引.*读取材料.*mail \/ search/);
  await click('展开详情');assert.match(document.querySelector('.deep-timeline details').textContent,/正在生成工具请求/);
  await click('收起详情');
  const reading={...failed,run:{...failed.run,status:'running',phase:'reading',createdAt:Date.now(),budget:{activeMs:300000}},progress:[{sequence:4,at:1,phase:'finalizing',status:'completed',title:'深度分析完成',detail:'旧记录'}]};
  await settle(()=>enhanceRoot.render(createElement(EnhancementWorkspace,{sessionId:'synthetic',workflow:reading,analysis:{steps:[]},onWorkflow:()=>{},onGenerate:()=>{}})));
  assert.match(document.querySelector('[role="status"]').textContent,/读取材料与深度分析/);
  assert.doesNotMatch(document.body.textContent,/深度分析完成|旧记录/);
  assert.match(document.querySelector('[aria-label="当前使用模型"]').textContent,/确认中/);
  assert.doesNotMatch(document.querySelector('[aria-label="当前使用模型"]').textContent,/claude-sonnet/);
  assert.equal(document.querySelectorAll('[aria-current="step"]').length,1);
  assert.doesNotMatch(document.body.textContent,/当前没有需要向你澄清|集中回答|集中问答/,'loading cannot announce empty results');
  let releaseStop;let stopAction;
  window.skillRecorder.enhancement=async action=>{stopAction=action;return new Promise(resolve=>{releaseStop=()=>resolve({ok:true,workflow:{...reading,run:{...reading.run,status:'canceled',error:'任务已取消。'}}});});};
  await click('停止任务');assert.equal(stopAction.kind,'cancel');assert.ok([...document.querySelectorAll('button')].find(button=>button.textContent==='正在停止…'&&button.disabled));
  assert.equal([...document.querySelectorAll('button')].some(button=>button.textContent==='重试'),false);
  await settle(()=>releaseStop());
  await settle(()=>enhanceRoot.render(createElement(EnhancementWorkspace,{sessionId:'synthetic',workflow:{...reading,run:{...reading.run,status:'canceled',error:'任务已取消。'}},analysis:{steps:[]},onWorkflow:()=>{},onGenerate:()=>{}})));
  assert.match(document.body.textContent,/任务已停止/);assert.ok([...document.querySelectorAll('button')].find(button=>button.textContent==='重试'));
  const screenshotRequests=[];
  window.skillRecorder.stepScreenshots=async(...args)=>{screenshotRequests.push(args);return [{timeMs:args[1],dataUrl:'data:image/png;base64,aW1hZ2U=',regions:[]}];};
  const resultAnalysis={intent:'打开页面并查看最新帖子',steps:[{id:'s1',title:'打开页面',detail:'打开列表页面。',startMs:1000,endMs:2000},{id:'s2',title:'查看最新帖子',detail:'切换最新后查看第一条。',startMs:3000,endMs:4000}]};
  const completed={...failed,run:{...failed.run,status:'completed'},result:{summary:'LONG_TECHNICAL_SUMMARY',remainingGapRefs:[],claims:[{id:'c1',stepRefs:['s1'],text:'通过导航链接进入页面',kind:'observed',reason:'事件与截图一致',evidenceRefs:['e1']},{id:'c2',stepRefs:['s2'],text:'浏览时长需要用户确认',kind:'unknown',reason:'尚未确认',evidenceRefs:[]},{id:'c3',stepRefs:['s1','s2'],text:'两步之间的整体关系',kind:'observed',reason:'跨步骤发现',evidenceRefs:[]}]},evidence:[{id:'e1',summary:'导航事件依据'}]};
  await settle(()=>enhanceRoot.render(createElement(EnhancementWorkspace,{key:'completed',sessionId:'synthetic',workflow:completed,analysis:resultAnalysis,onWorkflow:()=>{},onGenerate:()=>{}})));
  assert.equal(document.querySelectorAll('.deep-result-step').length,2);
  assert.match(document.querySelector('.deep-result-story .summary-text').textContent,/打开页面并查看最新帖子/);
  assert.doesNotMatch(document.querySelector('.deep-head').textContent,/LONG_TECHNICAL_SUMMARY/);
  assert.equal(document.querySelector('.deep-overview-details').open,false);
  assert.match(document.querySelectorAll('.deep-result-step')[0].textContent,/通过导航链接进入页面/);
  assert.doesNotMatch(document.querySelectorAll('.deep-result-step')[0].textContent,/跨步骤发现/);
  assert.match(document.querySelectorAll('.deep-result-step')[1].textContent,/待确认/);
  assert.doesNotMatch(document.querySelector('.deep-result-story').textContent,/查看依据|展开分析与依据|事件与截图一致|导航事件依据|LONG_TECHNICAL_SUMMARY|本次分析使用/);
  assert.equal(document.querySelectorAll('.deep-result-step')[0].textContent.split('通过导航链接进入页面').length-1,1);
  assert.deepEqual(screenshotRequests,[['synthetic',1000,2000],['synthetic',3000,4000]]);
  await settle(()=>document.querySelector('[aria-label="放大 0:01.0 的截图"]').click());
  assert.ok(document.querySelector('[role="dialog"][aria-label="查看步骤截图"]'));
  await click('关闭');assert.equal(document.querySelector('[aria-label="查看步骤截图"]'),null);
  const reviewed={...completed,result:{...completed.result,screenshotReviews:[{file:'frames/useless.jpg',decision:'discard'},{file:'frames/useful.jpg',decision:'keep'}]}};
  screenshotRequests.length=0;
  await settle(()=>enhanceRoot.render(createElement(EnhancementWorkspace,{key:'reviewed',sessionId:'synthetic',workflow:reviewed,analysis:resultAnalysis,onWorkflow:()=>{},onGenerate:()=>{}})));
  assert.deepEqual(screenshotRequests,[['synthetic',1000,2000,['frames/useless.jpg']],['synthetic',3000,4000,['frames/useless.jpg']]]);
  await settle(() => enhanceRoot.unmount());
  console.log('PASS: configuration refresh removes stale errors and enables preparation without starting an Agent');
  console.log('PASS: independent layout, dirty navigation, native close guard, discard, failed-save retention, save-and-leave, neutral configuration, browser categories, recording lock');
} finally { dom.window.close(); rmSync(temporary, { recursive: true, force: true }); }
