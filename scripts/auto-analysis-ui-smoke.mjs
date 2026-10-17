/** Isolated UI regression; no real recordings, model calls or user settings. */
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const jsdomPath = process.env.SKILL_RECORDER_JSDOM_MODULE;
if (!jsdomPath) throw new Error('Set SKILL_RECORDER_JSDOM_MODULE to an installed jsdom module.');
const { JSDOM } = await import(pathToFileURL(jsdomPath).href);
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/#library?autoAnalyze=new', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent']) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act, StrictMode } = await import('react');
const { createRoot } = await import('react-dom/client');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'auto-analysis-ui-'));
symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
try {
  await build({ configFile: false, logLevel: 'error', build: { outDir: temporary, emptyOutDir: false, lib: { entry: path.resolve('src/Library.tsx'), formats: ['es'], fileName: () => 'library.mjs' }, rollupOptions: { external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'], output: { banner: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } } } });
  const { Library } = await import(pathToFileURL(path.join(temporary, 'library.mjs')).href);
  const listeners = new Map();
  const listen = name => cb => { listeners.set(name, cb); return () => listeners.delete(name); };
  let processed = false;
  const calls = [];
  let complete;
  const summary = id => ({ id, startedAt: 1, durationMs: 1000, sizeBytes: 100, processed: id === 'old' || processed, hasSkill: false, hasAutomation: false, hasAudio: false, hasNarration: false, hasVideo: true, analysis: null });
  dom.window.skillRecorder = {
    listSessions: async () => [summary('old'), summary('new')],
    onStatusChanged: listen('status'), onLibrarySessionRequested: listen('select'),
    narrationStatus: async () => ({ model: 'ready', phase: 'idle', activeSessionId: null, error: null }),
    onNarrationStatusChanged: listen('narration'), onAnalyzeProgress: listen('progress'),
    getAnalysis: async () => null, getSensitiveReport: async () => null,
    captureTimeline: async () => null,
    analyze: id => { calls.push(id); return new Promise(resolve => { complete = resolve; }); },
  };
  const root = createRoot(document.getElementById('root'));
  const settle = async fn => { await act(async () => { await fn?.(); await new Promise(r => setTimeout(r, 15)); }); };
  await settle(() => root.render(createElement(StrictMode, null, createElement(Library))));
  await settle();
  assert.deepEqual(calls, [], 'wait for post-processing');
  assert.match(document.body.textContent, /完成后自动开始分析/);
  processed = true;
  await settle(() => listeners.get('status')({ state: 'idle' }));
  await settle();
  assert.deepEqual(calls, ['new'], 'StrictMode starts exactly the requested saved session once');
  assert.equal(dom.window.location.hash, '#library', 'consume the one-shot launch marker');
  assert.ok(document.querySelectorAll('.sess')[1].classList.contains('on'));
  await settle(() => listeners.get('status')({ state: 'idle' }));
  assert.deepEqual(calls, ['new'], 'repeated refresh does not restart');
  await settle(() => complete({ ok: false, error: '模拟服务失败' }));
  assert.match(document.body.textContent, /模拟服务失败/);
  await settle(() => listeners.get('status')({ state: 'idle' }));
  assert.deepEqual(calls, ['new'], 'failure is shown without an automatic retry loop');
  await settle(() => document.querySelectorAll('.sess')[0].click());
  await settle();
  assert.deepEqual(calls, ['new'], 'browsing older recordings does not analyze them');
  await settle(() => listeners.get('select')('new'));
  await settle();
  assert.deepEqual(calls, ['new', 'new'], 'an existing library handles a new explicit handoff');
  await settle(() => complete({ ok: false, error: '模拟服务失败' }));
  await settle(() => root.unmount());

  // Exercise the real Library routing, not just the document component in isolation.
  const documentCalls = [];
  Object.assign(dom.window.skillRecorder, {
    getAnalysis: async () => ({ version: 1, sessionId: 'old', revision: 1, createdAt: 1, title: '测试录制', intent: '浏览页面', intentConfidence: 'high', intentRationale: '', steps: [], feedbackLog: [], approved: true }),
    enhancement: async () => ({ ok: true }),
    onEnhancementChanged: listen('enhancement'),
    processing: async () => ({ ok: true, status: { ready: false } }),
    onSettingsChanged: listen('settings'),
    document: async action => { documentCalls.push(action); return { ok: true, documents: [] }; },
  });
  const switchRoot = createRoot(document.getElementById('root'));
  await settle(() => switchRoot.render(createElement(StrictMode, null, createElement(Library))));
  await settle();
  const chooseOutput = async kind => settle(() => {
    const select = document.querySelector('.output-kind-select select');
    select.value = kind;
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
  const generation = () => [...document.querySelectorAll('.workflow-stage')].find(stage => !stage.hidden);
  await settle(() => document.querySelectorAll('.workflow-nav button')[2].click());
  assert.equal(document.querySelectorAll('.output-product-grid button').length, 3);
  await settle(() => document.querySelectorAll('.output-product-grid button')[1].click());
  for (const kind of ['manual', 'sop', 'manual', 'sop']) {
    await chooseOutput(kind);
    assert.equal(generation().querySelector('h2')?.textContent, kind === 'manual' ? '使用手册' : 'SOP 操作说明', 'switching output keeps the matching generation page mounted');
    assert.equal(!!generation().querySelector('.doc-confirmation'), kind === 'manual', 'only manuals need source confirmation here');
    const cta = generation().querySelector('.doc-foot button');
    assert.equal(cta.textContent, kind === 'manual' ? '生成覆盖目录' : '生成 SOP');
    assert.equal(cta.disabled, kind === 'manual', 'SOP is one click; manual still requires source confirmation');
  }
  for (const kind of ['skill', 'undecided']) {
    await chooseOutput(kind);
    assert.match(generation().textContent, /你希望基于这条录制创建什么/, 'non-document outputs open the target picker instead of a blank stage');
    await settle(() => document.querySelectorAll('.output-product-grid button')[1].click());
  }
  await chooseOutput('manual');
  assert.equal(generation().querySelector('h2')?.textContent, '使用手册');
  assert.equal(documentCalls.some(action => action.kind === 'generate'), false, 'switching only loads documents; it never generates them');
  await settle(() => switchRoot.unmount());
  console.log('Auto-analysis UI smoke passed: saved-session selection, processing gate, StrictMode, one-shot trigger, errors, history browsing, existing-window handoff and output switching.');
} finally {
  rmSync(temporary, { recursive: true, force: true });
  dom.window.close();
}
