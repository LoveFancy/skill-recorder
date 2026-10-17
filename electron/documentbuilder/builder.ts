import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  DocumentArtifactSchema, DocumentContentSchema, DocumentOutlineSchema, DocumentRequestSchema,
  OUTPUT_TEMPLATES, renderDocument, validateDocument,
  type DocumentArtifact, type DocumentContent, type DocumentOutline, type DocumentRequest, type DocumentView,
} from "../../common/output";
import { AgentBuilder, type BaseLive } from "../builders/agent-builder";
import { loadPersistedAnalysis } from "../describer/describer";
import { inputRevision } from "../enrichment/coordinator";
import { atomicJson, fingerprint, workflowStore } from "../enrichment/store";
import { redactValue } from "../enrichment/privacy";
import { sessionDir } from "../recorder/session-store";
import type { FrameRedactor } from "../sensitive/frame-redact";
import { recordingMaterials } from "../enrichment/materials";
import { documentInstructions } from "./instructions";

/** Immutable revisions; user edits never replace a previous generated or exported revision. */
export class DocumentBuilder extends AgentBuilder<BaseLive> {
  private imageRedactor: ((id: string) => Promise<FrameRedactor>) | undefined;
  constructor() { super("DocumentBuilder"); }
  setImageRedactor(provider: (id: string) => Promise<FrameRedactor>) { this.imageRedactor = provider; }

  private root(id: string, artifactId?: string): string {
    if (artifactId) z.string().uuid().parse(artifactId);
    const root = path.join(sessionDir(id), "artifacts", ...(artifactId ? [artifactId] : []));
    for (const p of [sessionDir(id), path.dirname(root), root, path.join(root, "revisions"), path.join(root, "assets")]) {
      if (existsSync(p) && lstatSync(p).isSymbolicLink()) throw new Error("产物目录不能是符号链接。");
    }
    return root;
  }

  private source(id: string) {
    const analysis = loadPersistedAnalysis(id);
    if (!analysis) throw new Error("请先完成并确认基础分析。");
    const w = workflowStore.read(id);
    const current = inputRevision(id);
    const reviewed = w.approvedAt && w.decision?.kind === "enhance" && w.decision.inputRevision === current;
    const claims = reviewed ? w.result?.claims.filter(c => c.review === "accepted") ?? [] : [];
    const steps = analysis.steps.map(s => ({ ...s, evidenceId: `step:${s.id}` }));
    const sources = claims.map(c => ({ ...c, evidenceId: `claim:${c.id}` }));
    return {
      revision: analysis.revision,
      fingerprint: fingerprint({ current, claims: sources, materials: w.package?.materials ?? [], approvedAt: reviewed ? w.approvedAt : null }),
      evidenceIds: [...steps.map(s => s.evidenceId), ...sources.map(s => s.evidenceId)],
      input: { intent: analysis.intent, steps, supplements: sources, note: "只使用这些审核事实；未审核增强不进入文档。" },
    };
  }

  private load(id: string, artifactId: string): DocumentArtifact {
    const root = this.root(id, artifactId);
    const head = z.number().int().positive().parse(JSON.parse(readFileSync(path.join(root, "head.json"), "utf8")));
    const a = DocumentArtifactSchema.parse(JSON.parse(readFileSync(path.join(root, "revisions", `${head}.json`), "utf8")));
    if (a.id !== artifactId || a.sessionId !== id) throw new Error("产物来源不匹配。");
    validateDocument(a);
    return a;
  }

  private save(a: DocumentArtifact): DocumentView {
    const valid = DocumentArtifactSchema.parse(a);
    validateDocument(valid);
    const root = this.root(a.sessionId, a.id);
    // A crash between writing a revision and moving the head must not prevent retry.
    while (existsSync(path.join(root, "revisions", `${valid.revision}.json`))) valid.revision++;
    const file = path.join(root, "revisions", `${valid.revision}.json`);
    atomicJson(file, valid);
    atomicJson(path.join(root, "head.json"), valid.revision);
    return this.view(valid);
  }

  private view(a: DocumentArtifact): DocumentView {
    const template = OUTPUT_TEMPLATES[a.request.kind];
    return { artifact: a, stale: this.source(a.sessionId).fingerprint !== a.sourceFingerprint || a.templateId !== template.id || a.templateVersion !== template.version, markdown: renderDocument(a) };
  }

  list(id: string): DocumentView[] {
    const root = this.root(id);
    if (!existsSync(root)) return [];
    return readdirSync(root).filter(x => z.string().uuid().safeParse(x).success && existsSync(path.join(this.root(id, x), "head.json"))).flatMap(x => {
      const head = this.load(id, x);
      return readdirSync(path.join(this.root(id, x), "revisions")).filter(file => /^\d+\.json$/.test(file) && Number(file.slice(0, -5)) <= head.revision).map(file => {
        const a = DocumentArtifactSchema.parse(JSON.parse(readFileSync(path.join(this.root(id, x), "revisions", file), "utf8")));
        if (a.id !== x || a.sessionId !== id) throw new Error("产物历史来源不匹配。");
        validateDocument(a);
        return this.view(a);
      });
    }).sort((a, b) => b.artifact.createdAt - a.artifact.createdAt || b.artifact.revision - a.artifact.revision);
  }

  private requireCurrent(id: string, artifactId: string, revision: number) {
    const a = this.load(id, artifactId);
    if (a.revision !== revision) throw new Error("文档已有新版本，请重新打开。");
    if (this.view(a).stale) throw new Error("来源已变化，请重新生成并审核；历史版本已保留。");
    return a;
  }

  async generate(id: string, raw: DocumentRequest, artifactId: string | undefined, signal: AbortSignal): Promise<DocumentView> {
    const request = DocumentRequestSchema.parse(await redactValue(DocumentRequestSchema.parse(raw)));
    const previous = artifactId ? this.load(id, artifactId) : null;
    if (previous && previous.request.kind !== request.kind) throw new Error("不能更改既有产物类型，请新建文档。");
    const source = this.source(id);
    const template = OUTPUT_TEMPLATES[request.kind];
    const a: DocumentArtifact = {
      version: 1, id: previous?.id ?? randomUUID(), sessionId: id, revision: (previous?.revision ?? 0) + 1,
      request, templateId: template.id, templateVersion: template.version, sourceFingerprint: source.fingerprint,
      sourceRevision: source.revision, evidenceIds: source.evidenceIds, assets: [], outline: null, content: null,
      status: "draft", createdAt: Date.now(), reviewedAt: null, exports: previous?.exports ?? [],
    };
    // Never export raw frames when OCR protection is unavailable.
    const materials = await recordingMaterials(id, await this.imageRedactor?.(id));
    signal.throwIfAborted();
    const root = this.root(id, a.id);
    for (const image of materials.images) {
      const name = `${image.hash}.jpg`;
      mkdirSync(path.join(root, "assets"), { recursive: true, mode: 0o700 });
      const file = path.join(root, "assets", name);
      if (existsSync(file) && lstatSync(file).isSymbolicLink()) throw new Error("截图资源不能是符号链接。");
      writeFileSync(file, Buffer.from(image.dataUrl.split(",")[1], "base64"), { mode: 0o600 });
      a.assets.push({ id: `image:${image.hash}`, name, hash: image.hash });
    }
    const input = { request, facts: source.input, assets: a.assets.map(asset => ({ ...asset, capturedAt: materials.images.find(i => i.hash === asset.hash)?.capturedAt })), omitted: materials.omitted };
    if (request.kind === "manual") {
      a.outline = (await this.runModel(id, "submit_outline", z.object({ items: DocumentOutlineSchema }), documentInstructions("manual", true), input, signal)).items;
    } else {
      a.content = await this.runModel(id, "submit_document", DocumentContentSchema, documentInstructions("sop", false), input, signal);
    }
    signal.throwIfAborted();
    if (this.source(id).fingerprint !== source.fingerprint) throw new Error("生成期间来源变化，请重试。");
    return this.save(a);
  }

  async outline(id: string, artifactId: string, revision: number, raw: DocumentOutline, signal: AbortSignal) {
    const a = this.requireCurrent(id, artifactId, revision);
    if (a.request.kind !== "manual") throw new Error("只有使用手册需要目录审核。");
    const outline = DocumentOutlineSchema.parse(await redactValue(DocumentOutlineSchema.parse(raw)));
    if (!outline.some(i => i.coverage !== "planned")) throw new Error("至少需要一个有证据支持的功能章节。");
    const proposed = { ...a, outline, content: null };
    validateDocument(proposed);
    const content = await this.runModel(id, "submit_document", DocumentContentSchema, documentInstructions("manual", false),
      { request: a.request, facts: this.source(id).input, approvedOutline: outline, assets: a.assets }, signal);
    signal.throwIfAborted();
    this.requireCurrent(id, artifactId, revision);
    return this.save({ ...a, outline, content, revision: revision + 1, status: "draft", reviewedAt: null });
  }

  async edit(id: string, artifactId: string, revision: number, raw: DocumentContent, reviewed: boolean) {
    const a = this.requireCurrent(id, artifactId, revision);
    const content = DocumentContentSchema.parse(await redactValue(raw));
    const userRef = `user:revision-${revision + 1}`;
    const evidenceIds = [...a.evidenceIds, userRef];
    for (const section of content.sections) {
      const original = a.content?.sections.find(s => s.id === section.id);
      if (JSON.stringify(section) !== JSON.stringify(original)) section.evidenceRefs = [...new Set([...section.evidenceRefs, userRef])];
      section.steps.forEach((step, index) => {
        const before = original?.steps[index];
        if (JSON.stringify(step) !== JSON.stringify(before)) {
          step.evidenceRefs = [...new Set([...step.evidenceRefs, userRef])];
          if (step.expectedResult !== before?.expectedResult && step.resultStatus !== "unknown") step.resultStatus = "confirmed";
        }
      });
    }
    if (reviewed && content.gaps.length) throw new Error("仍有缺口，只能保存草稿。");
    return this.save({ ...a, evidenceIds, content, revision: revision + 1, status: reviewed ? "reviewed" : "draft", reviewedAt: reviewed ? Date.now() : null });
  }

  exportable(id: string, artifactId: string, revision: number, draft: boolean) {
    const a = this.requireCurrent(id, artifactId, revision);
    if (!a.content) throw new Error("请先生成正文。");
    if (a.status !== "reviewed" && !draft) throw new Error("请审核文档或明确导出草稿。");
    const used = new Set(a.content.sections.flatMap(s => s.steps.flatMap(t => t.assetIds)));
    const assets = a.assets.filter(x => used.has(x.id)).map(asset => {
      const bytes = this.assetBytes(id, artifactId, asset);
      return { name: `assets/${asset.name}`, bytes };
    });
    return { artifact: a, markdown: renderDocument(a), assets };
  }

  private assetBytes(id: string, artifactId: string, asset: DocumentArtifact["assets"][number]): Buffer {
    if (!/^[0-9a-f]{64}\.jpg$/.test(asset.name)) throw new Error("无效资源路径。");
    const root = this.root(id, artifactId);
    const file = realpathSync(path.join(root, "assets", asset.name));
    if (path.dirname(file) !== realpathSync(path.join(root, "assets"))) throw new Error("资源路径越界。");
    const bytes = readFileSync(file);
    if (fingerprint(bytes.toString("base64")) !== asset.hash) throw new Error("截图资源已变化，请重新生成。");
    return bytes;
  }

  asset(id: string, artifactId: string, assetId: string): string {
    const a = this.load(id, artifactId);
    const item = a.assets.find(asset => asset.id === assetId);
    if (!item) throw new Error("未知截图资源。");
    return `data:image/jpeg;base64,${this.assetBytes(id, artifactId, item).toString("base64")}`;
  }

  recordExport(id: string, artifactId: string, revision: number, target: string) {
    const a = this.requireCurrent(id, artifactId, revision);
    return this.save({ ...a, revision: revision + 1, exports: [...a.exports, { revision, path: target, at: Date.now() }] });
  }

  private async runModel<T>(id: string, toolName: string, schema: z.ZodType<T>, instructions: string, input: unknown, signal: AbortSignal): Promise<T> {
    this.active.add(id);
    let value: T | undefined;
    try {
      const client = await this.ensureClient();
      signal.throwIfAborted();
      const agent = await client.createSession({
        systemMessage: { mode: "append", content: instructions },
        tools: [{ name: toolName, parameters: z.toJSONSchema(schema) as Record<string, unknown>, handler: async raw => {
          if (value !== undefined) throw new Error("每次只允许提交一次。");
          value = schema.parse(await redactValue(schema.parse(raw)));
          return "文档已提交。";
        } }], availableTools: [toolName], terminalTools: [toolName],
      });
      this.registerLive({ sessionId: id, agent });
      const abort = () => { void agent.abort(); };
      signal.addEventListener("abort", abort, { once: true });
      try {
        signal.throwIfAborted();
        await agent.sendAndWait(JSON.stringify(await redactValue(input)), 180000);
        signal.throwIfAborted();
      } finally { signal.removeEventListener("abort", abort); }
      if (value === undefined) throw new Error("模型未提交文档，请重试。");
      return value;
    } finally { this.active.delete(id); await this.disposeLive(id); }
  }
}

export const documentBuilder = new DocumentBuilder();
