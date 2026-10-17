import type { Page } from '@playwright/test';

/** Installed before React loads; isolated in each browser context. Never imports main-process code. */
export async function installMockIPC(page: Page) {
  await page.addInitScript(() => {
    const calls: any[] = [];
    const documents: any[] = [];
    const listeners = new Map<string, Set<(...args: any[]) => void>>();
    const listen = (name: string) => (callback: (...args: any[]) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(callback);
      return () => listeners.get(name)!.delete(callback);
    };
    const state = { calls, documents, failNext: '', holdGeneration: false };
    (window as any).__uiTest = state;
    const content = () => ({ title: '网页回复邮件', purpose: '回复原邮件', prerequisites: [],
      sections: [{ id: 'reply', title: '回复邮件', description: '已演示功能', evidenceRefs: ['step:s1'], steps: [{ title: '点击回复', location: '邮件详情', action: '填写回复内容', expectedResult: '未证实发送结果', resultStatus: 'unknown', evidenceRefs: ['step:s1'], assetIds: [] }] }],
      exceptions: [], completion: [], gaps: [],
    });
    let release: ((value: unknown) => void) | undefined;
    const view = (artifact: any) => ({ artifact, stale: false, markdown: '# 网页回复邮件\n填写回复内容' });
    const mock = {
      listSessions: async () => [{ id: 'synthetic-recording', startedAt: 1, durationMs: 1000, sizeBytes: 100, processed: true, hasSkill: false, hasAutomation: false, hasAudio: false, hasNarration: false, hasVideo: true, analysis: null }],
      onStatusChanged: listen('status'), onLibrarySessionRequested: listen('select'),
      narrationStatus: async () => ({ model: 'ready', phase: 'idle', activeSessionId: null, error: null }),
      onNarrationStatusChanged: listen('narration'), onAnalyzeProgress: listen('progress'),
      getAnalysis: async () => ({ version: 1, sessionId: 'synthetic-recording', revision: 1, createdAt: 1, title: '测试录制', intent: '浏览页面', intentConfidence: 'high', intentRationale: '', steps: [], feedbackLog: [], approved: true }),
      getSensitiveReport: async () => null, captureTimeline: async () => null,
      enhancement: async () => ({ ok: true }), onEnhancementChanged: listen('enhancement'),
      processing: async () => ({ ok: true, status: { ready: false } }), onSettingsChanged: listen('settings'),
      document: async (action: any) => {
        calls.push(structuredClone(action));
        if (state.failNext === action.kind) { state.failNext = ''; return { ok: false, error: '合成测试：生成服务不可用' }; }
        if (action.kind === 'list') return { ok: true, documents: structuredClone(documents) };
        if (action.kind === 'cancel') { release?.({ ok: false, canceled: true }); release = undefined; return { ok: true }; }
        if (action.kind === 'generate') {
          if (state.holdGeneration) return new Promise(resolve => { release = resolve; });
          const old = documents.find(d => d.artifact.id === action.artifactId);
          const artifact = { id: old?.artifact.id ?? crypto.randomUUID(), sessionId: action.sessionId, request: action.request, revision: (old?.artifact.revision ?? 0) + 1, createdAt: Date.now(), content: action.request.kind === 'sop' ? content() : null, outline: action.request.kind === 'manual' ? [{ id: 'reply', title: '回复邮件', scope: '录制覆盖的功能', coverage: 'covered', evidenceRefs: ['step:s1'] }] : null, assets: [], status: 'draft', exports: [] };
          const next = view(artifact); documents.unshift(next); return { ok: true, document: structuredClone(next) };
        }
        if (['outline', 'edit', 'export'].includes(action.kind)) {
          const old = documents.find(d => d.artifact.id === action.artifactId);
          if (!old) throw new Error('Unknown synthetic artifact');
          if (action.kind === 'export') return { ok: true, document: structuredClone(old), path: '/synthetic/document.md' };
          const artifact = { ...old.artifact, revision: old.artifact.revision + 1, content: action.content ?? content(), status: action.reviewed ? 'reviewed' : 'draft' };
          const next = view(artifact); documents.unshift(next); return { ok: true, document: structuredClone(next) };
        }
        throw new Error(`Unexpected mock IPC document action: ${action.kind}`);
      },
    };
    (window as any).skillRecorder = mock;
  });
}
