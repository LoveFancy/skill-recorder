import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { AnalysisSchema } from "../../common/analysis";
import { renderDocument, validateDocument, type DocumentArtifact, type DocumentContent } from "../../common/output";
import { AgentClient, AgentSession, type SessionConfig } from "../ai/client";
import { DocumentBuilder } from "./builder";

const id = "document-test";
const content: DocumentContent = {
  title: "网页回复邮件", purpose: "通过网页回复邮件", prerequisites: ["已登录邮箱"],
  sections: [{ id: "reply", title: "回复邮件", description: "在原邮件线程内回复", evidenceRefs: ["step:s1"], steps: [{
    title: "点击回复", location: "邮件详情页", action: "点击回复并填写正文", expectedResult: "未录到发送结果", resultStatus: "unknown", evidenceRefs: ["step:s1"], assetIds: [],
  }] }], exceptions: [], completion: [], gaps: [],
};
function fixture(t: TestContext, beforeTurn?: () => Promise<void>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "document-builder-"));
  const prior = process.env.SKILL_RECORDER_SESSIONS_DIR;
  process.env.SKILL_RECORDER_SESSIONS_DIR = root;
  const dir = path.join(root, id);
  mkdirSync(dir);
  const analysis = AnalysisSchema.parse({ version: 1, sessionId: id, revision: 1, createdAt: 1, title: "回复邮件", intent: "回复邮件", intentConfidence: "high", intentRationale: "录制可见", steps: [{ id: "s1", title: "回复", detail: "点击网页回复", confidence: "high" }] });
  writeFileSync(path.join(dir, "analysis.json"), JSON.stringify(analysis));
  writeFileSync(path.join(dir, "session.json"), JSON.stringify({ id, startedAt: 1, requestedOutput: "sop" }));
  const calls: { config: SessionConfig; input: unknown }[] = [];
  let payload: unknown = structuredClone(content);
  const client = new AgentClient();
  t.mock.method(client, "createSession", async (config: SessionConfig) => {
    const session = new AgentSession();
    t.mock.method(session, "disconnect", async () => {});
    t.mock.method(session, "sendAndWait", async (text: string) => {
      calls.push({ config, input: JSON.parse(text) });
      await beforeTurn?.();
      const tool = config.tools![0];
      const raw = tool.name === "submit_outline" ? { items: [{ id: "reply", title: "回复邮件", scope: "已录制的网页回复", coverage: "covered", evidenceRefs: ["step:s1"] }, { id: "admin", title: "管理员功能", scope: "无材料", coverage: "planned", evidenceRefs: [] }] } : payload;
      await tool.handler(raw, { sessionId: id, toolCallId: "test", toolName: tool.name, arguments: raw });
    });
    return session;
  });
  class Builder extends DocumentBuilder { protected override async ensureClient() { return client; } }
  const builder = new Builder();
  t.after(async () => {
    await builder.dispose();
    if (prior === undefined) delete process.env.SKILL_RECORDER_SESSIONS_DIR; else process.env.SKILL_RECORDER_SESSIONS_DIR = prior;
    rmSync(root, { recursive: true, force: true });
  });
  return { builder, dir, calls, analysis, payload: (p: unknown) => { payload = p; }, generate: (kind: "sop" | "manual" = "sop") => builder.generate(id, { kind, audience: "业务人员", scope: "本次录制" }, undefined, new AbortController().signal) };
}

test("SOP works without a capability snapshot and only exposes a document submission tool", async t => {
  const f = fixture(t);
  const view = await f.generate();
  assert.equal(view.artifact.status, "draft");
  assert.match(view.markdown, /点击回复并填写正文/);
  assert.match(view.markdown, /结果（待确认）/);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0].config.availableTools, ["submit_document"]);
  assert.deepEqual(f.calls[0].config.terminalTools, ["submit_document"]);
  assert.match(f.calls[0].config.systemMessage!.content, /不转换为 MCP/);
  assert.equal((f.calls[0].config.tools![0].parameters as { type: string }).type, "object");
  assert.throws(() => f.builder.exportable(id, view.artifact.id, 1, false), /审核/);
  assert.match(f.builder.exportable(id, view.artifact.id, 1, true).markdown, /待审核草稿/);
});

test("selected document templates persist across revisions and guide both manual stages", async t => {
  const f=fixture(t), signal=new AbortController().signal;
  const sop=await f.builder.generate(id,{kind:"sop",audience:"操作人员",scope:"录制范围",templateId:"sop-checklist"},undefined,signal);
  assert.equal(sop.artifact.templateId,"sop-checklist");
  assert.match(f.calls[0].config.systemMessage!.content,/操作检查清单/);
  assert.equal(f.builder.list(id)[0].stale,false);
  const manual=await f.builder.generate(id,{kind:"manual",audience:"新同事",scope:"录制范围",templateId:"manual-quickstart"},undefined,signal);
  await f.builder.outline(id,manual.artifact.id,1,manual.artifact.outline!,signal);
  assert.ok(f.calls.slice(1).every(c=>c.config.systemMessage!.content.includes("快速入门手册")));
  assert.ok(f.builder.list(id).filter(d=>d.artifact.id===manual.artifact.id).every(d=>d.artifact.templateId==="manual-quickstart"&&!d.stale));
});

test("manual generates a complete document in one action and validates its internal outline", async t => {
  const f = fixture(t);
  const outline = await f.generate("manual");
  assert.ok(outline.artifact.content);
  assert.match(outline.markdown,/# 网页回复邮件/);
  assert.equal(f.calls.length, 2);
  assert.equal((f.calls[0].config.tools![0].parameters as { type: string }).type, "object");
  const a = outline.artifact;
  const view = await f.builder.outline(id, a.id, 1, a.outline!, new AbortController().signal);
  assert.equal(f.calls.length, 3);
  assert.match(view.markdown, /管理员功能：待补充/);
  assert.equal(view.artifact.revision, 2);
  const bad = structuredClone(content); bad.sections[0].id = "admin";
  f.payload(bad);
  await assert.rejects(f.builder.outline(id, a.id, 2, a.outline!, new AbortController().signal), /超出/);
  assert.equal(f.builder.list(id).length, 2);
});

test("editing creates immutable revisions, records user provenance and guards against stale revision writes", async t => {
  const f = fixture(t);
  const a = (await f.generate()).artifact;
  const edited = structuredClone(content);
  edited.sections[0].steps[0].expectedResult = "页面显示已发送";
  edited.sections[0].steps[0].resultStatus = "observed";
  const next = await f.builder.edit(id, a.id, 1, edited, true);
  assert.equal(next.artifact.status, "reviewed");
  assert.equal(next.artifact.content!.sections[0].steps[0].resultStatus, "confirmed");
  assert.ok(next.artifact.content!.sections[0].steps[0].evidenceRefs.includes("user:revision-2"));
  await assert.rejects(f.builder.edit(id, a.id, 1, edited, false), /新版本/);
  const history = f.builder.list(id);
  assert.equal(history.length, 2);
  assert.equal(history.find(d => d.artifact.revision === 1)!.artifact.content!.sections[0].steps[0].resultStatus, "unknown");
  assert.equal(f.builder.exportable(id, a.id, 2, false).artifact.revision, 2);
});

test("source changes block editing/export and regeneration preserves prior versions", async t => {
  const f = fixture(t);
  const a = (await f.generate()).artifact;
  writeFileSync(path.join(f.dir, "analysis.json"), JSON.stringify({ ...f.analysis, revision: 2, intent: "新版目标" }));
  assert.equal(f.builder.list(id)[0].stale, true);
  assert.throws(() => f.builder.exportable(id, a.id, 1, true), /来源已变化/);
  await assert.rejects(f.builder.edit(id, a.id, 1, content, false), /来源已变化/);
  const regenerated = await f.builder.generate(id, a.request, a.id, new AbortController().signal);
  assert.equal(regenerated.artifact.revision, 2);
  assert.equal(regenerated.stale, false);
  assert.equal(f.builder.list(id).length, 2);
});

test("MCP configuration changes do not invalidate document sources", async t => {
  const f = fixture(t);
  await f.generate();
  writeFileSync(path.join(f.dir, ".mcp.json"), JSON.stringify({ changed: true }));
  assert.equal(f.builder.list(id)[0].stale, false);
});

test("unknown evidence or assets never persist as valid documents", async t => {
  const f = fixture(t);
  const bad = structuredClone(content); bad.sections[0].steps[0].evidenceRefs = ["invented"];
  f.payload(bad);
  await assert.rejects(f.generate(), /未知证据/);
  assert.equal(f.builder.list(id).length, 0);
});

test("cancel after model response does not commit a document", async t => {
  const controller = new AbortController();
  const f = fixture(t, async () => { controller.abort(); });
  await assert.rejects(f.builder.generate(id, { kind: "sop", audience: "业务人员", scope: "本次录制" }, undefined, controller.signal), /abort/i);
  assert.equal(f.builder.list(id).length, 0);
});

test("gaps prevent reviewed status but allow explicit draft exports", async t => {
  const f = fixture(t);
  const a = (await f.generate()).artifact;
  const draft = { ...content, gaps: ["缺少发送结果证据"] };
  await assert.rejects(f.builder.edit(id, a.id, 1, draft, true), /草稿/);
  const view = await f.builder.edit(id, a.id, 1, draft, false);
  assert.match(f.builder.exportable(id, a.id, view.artifact.revision, true).markdown, /缺少发送结果证据/);
});

test("Markdown escapes injected HTML and links while preserving real asset references", async t => {
  const f = fixture(t);
  const a = (await f.generate()).artifact;
  a.content!.title = '<script>alert(1)</script> [click](https://example.invalid)';
  const md = renderDocument(a);
  assert.doesNotMatch(md, /<script>/);
  assert.match(md, /&lt;script&gt;/);
  assert.match(md, /\\\[click/);
  assert.equal(existsSync(path.join(f.dir, "skill.json")), false);
  assert.equal(JSON.parse(readFileSync(path.join(f.dir, "artifacts", a.id, "revisions", "1.json"), "utf8")).content.title, "网页回复邮件");
});

test("manual coverage checks reject fake covered chapters and empty evidence", async t => {
  const f = fixture(t);
  const a: DocumentArtifact = (await f.generate("manual")).artifact;
  a.outline![1].coverage = "covered";
  assert.throws(() => validateDocument(a), /必须引用证据/);
});

test("failed manual body generation does not publish an outline-only result and can retry", async t=>{
  const f=fixture(t),bad=structuredClone(content);
  bad.sections[0].id="admin";
  f.payload(bad);
  await assert.rejects(f.generate("manual"),/超出/);
  assert.deepEqual(f.builder.list(id),[]);
  f.payload(structuredClone(content));
  const result=await f.generate("manual");
  assert.ok(result.artifact.content);
  assert.equal(result.artifact.revision,1);
  assert.equal(f.builder.list(id).length,1);
});

test("only protected screenshot bytes enter artifacts and changed assets block export", async t => {
  const f = fixture(t);
  mkdirSync(path.join(f.dir, "frames"));
  writeFileSync(path.join(f.dir, "frames", "frames.json"), JSON.stringify([{ file: "one.jpg", tMs: 1 }]));
  writeFileSync(path.join(f.dir, "frames", "one.jpg"), "private source pixels");
  const protectedBytes = Buffer.from("protected JPEG pixels");
  f.builder.setImageRedactor(async () => ({ active: true, ready: true, stats: { framesBlurred: 1, regionsBlurred: 1 }, redactFrame: async () => protectedBytes }));
  const a = (await f.generate()).artifact;
  assert.equal(a.assets.length, 1);
  assert.equal(f.builder.asset(id, a.id, a.assets[0].id), `data:image/jpeg;base64,${protectedBytes.toString("base64")}`);
  const edited = structuredClone(content); edited.sections[0].steps[0].assetIds = [a.assets[0].id];
  const next = (await f.builder.edit(id, a.id, 1, edited, true)).artifact;
  const exported = f.builder.exportable(id, a.id, next.revision, false);
  assert.deepEqual(exported.assets[0].bytes, protectedBytes);
  assert.match(exported.markdown, /!\[操作截图\]\(assets\//);
  writeFileSync(path.join(f.dir, "artifacts", a.id, "assets", a.assets[0].name), "tampered");
  assert.throws(() => f.builder.exportable(id, a.id, next.revision, false), /截图资源已变化/);
});

test("missing OCR withholds raw screenshots and canceled image generation can retry", async t => {
  const controller = new AbortController();
  const f = fixture(t);
  mkdirSync(path.join(f.dir, "frames"));
  writeFileSync(path.join(f.dir, "frames", "frames.json"), JSON.stringify([{ file: "one.jpg" }]));
  writeFileSync(path.join(f.dir, "frames", "one.jpg"), "private source pixels");
  const first = await f.generate();
  assert.equal(first.artifact.assets.length, 0);
  f.builder.setImageRedactor(async () => ({ active: true, ready: true, stats: { framesBlurred: 1, regionsBlurred: 1 }, redactFrame: async () => { controller.abort(); return Buffer.from("safe"); } }));
  await assert.rejects(f.builder.generate(id, first.artifact.request, undefined, controller.signal), /abort/i);
  assert.equal(f.builder.list(id).length, 1);
});
