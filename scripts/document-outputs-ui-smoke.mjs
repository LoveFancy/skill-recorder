/** Isolated DOM acceptance: no actual user recordings, model settings or business tools. */
import assert from 'node:assert/strict';
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';

const jsdomPath = process.env.SKILL_RECORDER_JSDOM_MODULE;
if (!jsdomPath) throw new Error('Set SKILL_RECORDER_JSDOM_MODULE to an installed jsdom module.');
const { JSDOM } = await import(pathToFileURL(jsdomPath).href);
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent']) globalThis[key] = dom.window[key];
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act, StrictMode } = await import('react');
const { createRoot } = await import('react-dom/client');
const temporary = mkdtempSync(path.join(os.tmpdir(), 'document-outputs-ui-'));
symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
const settle = async fn => { await act(async () => { await fn?.(); await new Promise(r => setTimeout(r, 20)); }); };
const button = text => [...document.querySelectorAll('button')].find(b => b.textContent === text);
try {
  await build({ configFile: false, logLevel: 'error', build: { outDir: temporary, emptyOutDir: false, lib: { entry: path.resolve('src/DocumentBuilderView.tsx'), formats: ['es'], fileName: () => 'documents.mjs' }, rollupOptions: { external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime'] } } });
  const { DocumentBuilderView } = await import(pathToFileURL(path.join(temporary, 'documents.mjs')).href);
  const root = createRoot(document.getElementById('root'));
  const calls = [];
  const documents = [];
  const content = { title: '网页回复邮件', purpose: '回复原邮件', prerequisites: [], sections: [{ id: 'reply', title: '回复邮件', description: '已演示功能', evidenceRefs: ['step:s1'], steps: [{ title: '点击回复', location: '邮件详情', action: '填写回复内容', expectedResult: '未证实发送结果', resultStatus: 'unknown', evidenceRefs: ['step:s1'], assetIds: [] }] }], exceptions: [], completion: [], gaps: [] };
  const view = a => ({ artifact: a, stale: false, markdown: '# 网页回复邮件\n填写回复内容' });
  const outline = [{ id: 'reply', title: '回复邮件', scope: '录制覆盖的功能', coverage: 'covered', evidenceRefs: ['step:s1'] }];
  dom.window.skillRecorder = { document: async action => {
    calls.push(action);
    if (action.kind === 'list') return { ok: true, documents: structuredClone(documents) };
    if (action.kind === 'generate') {
      const a = { id: crypto.randomUUID(), request: action.request, revision: 1, content: action.request.kind === 'sop' ? structuredClone(content) : null, outline: action.request.kind === 'manual' ? outline : null, assets: [], status: 'draft', exports: [] };
      const next = view(a); documents.unshift(next); return { ok: true, document: next };
    }
    if (action.kind === 'outline' || action.kind === 'edit' || action.kind === 'export') {
      const old = documents.find(d => d.artifact.id === action.artifactId);
      const a = { ...old.artifact, revision: old.artifact.revision + 1, content: action.content ?? structuredClone(content), status: action.reviewed || action.kind === 'export' ? 'reviewed' : 'draft' };
      const next = view(a); documents.unshift(next); return { ok: true, document: next, ...(action.kind === 'export' ? { path: '/chosen/document.md' } : {}) };
    }
    return { ok: true };
  } };
  const mount = (kind, sourceConfirmed = false) => settle(() => root.render(createElement(StrictMode, null, createElement(DocumentBuilderView, { key: `${kind}:${sourceConfirmed}`, sessionId: 'recording', kind, sourceConfirmed, onClose() {} }))));
  await mount('sop');
  assert.equal(button('生成 SOP').disabled, false, 'SOP generates directly without another confirmation');
  await mount('sop', true);
  assert.equal(button('生成 SOP').disabled, false, 'inherits source approval from previous stage');
  assert.equal(document.querySelector('.doc-source-confirmation'), null, 'no duplicate source confirmation');
  assert.equal(document.querySelector('.doc-customization'), null, 'SOP has no customization form');
  await settle(() => button('生成 SOP').click());
  assert.ok(button('确认内容并保存'));
  assert.equal(calls.filter(c => c.kind === 'generate').length, 1, 'StrictMode does not double submit');
  assert.equal(calls.find(c => c.kind === 'generate').request.audience, '业务操作者');
  assert.equal(calls.find(c => c.kind === 'generate').request.scope, '本次录制及已确认材料覆盖的任务与功能');
  assert.equal(calls.some(c => c.kind === 'outline'), false, 'SOP never uses outline/skill planning');
  await settle(() => button('确认内容并保存').click());
  assert.ok(button('导出文档'));
  await settle(() => button('导出文档').click());
  assert.match(document.body.textContent, /已导出：/);
  assert.ok(document.querySelector('select').options.length >= 3, 'saved revisions remain selectable');
  await mount('manual');
  await settle(() => document.querySelector('input[type=checkbox]').click());
  await settle(() => button('生成覆盖目录').click());
  assert.match(document.body.textContent, /审核目录与覆盖范围/);
  assert.equal(button('确认内容并保存'), undefined, 'manual stops for outline approval');
  await settle(() => button('确认目录并生成正文').click());
  assert.match(document.body.textContent, /编辑与审核/);
  assert.equal(calls.filter(c => c.kind === 'outline').length, 1);
  await settle(() => root.unmount());
  console.log('Document outputs UI smoke passed: source confirmation, SOP direct generation, manual outline gate, content review, export and revision browsing.');
} finally { rmSync(temporary, { recursive: true, force: true }); dom.window.close(); }
