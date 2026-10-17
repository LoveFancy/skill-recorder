import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Describer, loadPersistedAnalysis } from "../describer/describer";
import { processSession } from "../pipeline";
import { SkillBuilder } from "../skillbuilder/builder";
import { AgentSession } from "./client";

test("API execution reports configured model then server model",async()=>{
  const models:(string|undefined)[]=[];
  const session=new AgentSession({onExecution:(_title,_detail,model)=>models.push(model)},
    {baseUrl:'http://api.test/v1',model:'configured-model',apiKey:''},
    (async()=>new Response(JSON.stringify({model:'actual-model-v2',choices:[{message:{role:'assistant',content:'ok'}}]}))) as typeof fetch);
  try{await session.sendAndWait('test');assert.deepEqual(models,['configured-model','actual-model-v2']);}
  finally{await session.disconnect();}
});

test("real pipeline, describer and builder export the exact preview using only the model HTTP API", async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "model-workflow-"));
  const env = { SKILL_RECORDER_SESSIONS_DIR: root, SKILL_RECORDER_BASE_URL: "http://localhost:11434/v1",
    SKILL_RECORDER_PROCESSING_BACKEND: "api", SKILL_RECORDER_MODEL: "test-vision-model", SKILL_RECORDER_API_KEY: "" };
  for (const [key, value] of Object.entries(env)) {
    const prior = process.env[key]; process.env[key] = value;
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
  const id = "workflow-test"; const dir = path.join(root, id); mkdirSync(dir);
  writeFileSync(path.join(dir, "session.json"), JSON.stringify({ id, startedAt: 1000, stoppedAt: 2000, platform: "darwin", appVersion: "test" }));
  writeFileSync(path.join(dir, "events.jsonl"), JSON.stringify({ seq: 0, t: 100, epoch: 1100, type: "app.activate", source: "test", payload: { app: "Editor", title: "Task notes" } }) + "\n");
  await processSession(dir);
  writeFileSync(path.join(dir, "audio.json"), "{}");
  utimesSync(path.join(dir, "audio.json"), 100, 100);
  writeFileSync(path.join(dir, "narration.json"), JSON.stringify({ model: "test", language: "zh", segments: [{ atMs: 0, endMs: 1000, text: "请总结笔记" }] }));
  const planPayload = { name: "summarize-notes", title: "Summarize Notes", description: "Summarize a notes file",
    values: [], allowedTools: ["Read"], steps: [{ kind: "calculation", title: "Read notes", text: "Read the user-provided notes file and summarize it.", tools: ["view"] }] };
  const calls = [
    ["get_timeline", {}],
    ["get_narration", {}],
    ["submit_analysis", { title: "Read Task Notes", intent: "Read and summarize task notes", steps: [{ id: "s1", title: "Opened notes", detail: "Opened the notes file in Editor." }] }],
    ["get_analysis", {}], ["propose_plan", planPayload],
    ["submit_skill", { name: "summarize-notes", description: "Summarize a notes file", allowedTools: ["Read"], body: "# Summarize notes\n\nRead the user-provided notes file and summarize it." }],
  ] as const;
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.equal(url, "http://localhost:11434/v1/chat/completions");
    const request = JSON.parse(String(init.body));
    const call = calls[requests++]; assert.ok(call, "unexpected extra API call");
    assert.ok(request.tools.some((tool: { function: { name: string } }) => tool.function.name === call[0]));
    if (requests === 3) assert.match(request.messages.at(-1).content, /请总结笔记/);
    if (requests === 3 || requests === 5) assert.equal(request.messages.at(-1).role, "tool");
    return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: null,
      tool_calls: [{ id: `call-${requests}`, type: "function", function: { name: call[0], arguments: JSON.stringify(call[1]) } }],
    } }] }));
  });
  const describer = new Describer(() => undefined);
  const builder = new SkillBuilder(() => undefined);
  t.after(async () => { await describer.dispose(); await builder.dispose(); rmSync(root, { recursive: true, force: true }); });
  const analysis = await describer.analyze(id);
  assert.equal(analysis.narrationSourceUpdatedAt, statSync(path.join(dir, "narration.json")).mtimeMs);
  assert.notEqual(analysis.narrationSourceUpdatedAt, statSync(path.join(dir, "audio.json")).mtimeMs);
  assert.equal(loadPersistedAnalysis(id)?.intent, analysis.intent);
  const plan = await builder.build({ sessionId: id, architecture: "agent-skill" });
  const preview = await builder.prepare(id, plan);
  const exported = await builder.create(id, plan, { kind: "export", dir: path.join(root, "exports") }, preview.id);
  assert.ok(exported);
  assert.equal(readFileSync(exported.path, "utf8"), preview.markdown);
  assert.equal(exported.skill.architecture, "agent-skill");
  assert.equal(requests, 6, "placing a preview must not generate again");
});

test("annotation tool sends exact saved images and coordinates, and withholds protected images when OCR is unavailable", async () => {
  const { createDescriberTools } = await import("../describer/tools");
  const dir = mkdtempSync(path.join(os.tmpdir(),"annotation-model-"));
  try {
    mkdirSync(path.join(dir,"frames"));
    const screenshot = "frames/annotation_test.png";
    const bytes = Buffer.from("saved-annotated-image");
    writeFileSync(path.join(dir,screenshot),bytes);
    writeFileSync(path.join(dir,"events.jsonl"),JSON.stringify({type:"marker",epoch:1500,payload:{note:"主动标记点击",click:{x:0.25,y:0.75},screenshot,capturedAt:1200}}));
    const redaction: import("../describer/tools").ToolContext["redaction"] = {current:null};
    const tool = createDescriberTools({sessionDir:dir,startedAt:1000,extractor:null,redaction,onSubmit:()=>undefined}).find(t=>t.name==="get_annotations")!;
    const result = await tool.handler({}, {sessionId:"test",toolCallId:"test",toolName:tool.name,arguments:{}}) as {textResultForLlm:string;binaryResultsForLlm:{data:string}[]};
    assert.equal(result.binaryResultsForLlm[0].data,bytes.toString("base64"));
    const metadata = JSON.parse(result.textResultForLlm);
    assert.deepEqual(metadata.annotations[0].click,{x:0.25,y:0.75});
    assert.equal(metadata.annotations[0].atMs,500);
    assert.equal(metadata.annotations[0].capturedAtMs,200);
    redaction.current={redactText:s=>s,frameRedactor:{active:true,ready:false,stats:{framesBlurred:0,regionsBlurred:0},redactFrame:async()=>{throw new Error("should not read protected images");}}};
    const protectedResult = await tool.handler({}, {sessionId:"test",toolCallId:"test",toolName:tool.name,arguments:{}}) as {binaryResultsForLlm:unknown[]};
    assert.equal(protectedResult.binaryResultsForLlm.length,0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test("analysis must inspect every annotation page, including crops, before submitting", async () => {
  const {createDescriberTools} = await import("../describer/tools");
  const dir = mkdtempSync(path.join(os.tmpdir(),"annotation-priority-"));
  try {
    mkdirSync(path.join(dir,"frames"));
    const events = Array.from({length:7},(_,i)=>({type:"marker",epoch:1100+i*100,payload:{note:"用户重点",screenshot:`frames/annotation_${i}.png`,capturedAt:1100+i*100,...(i%3 === 0 ? {cropRegion:{x:.1,y:.2,width:.3,height:.4}} : i%3 === 1 ? {click:{x:.5,y:.5}} : {region:{x:.2,y:.2,width:.5,height:.5}})}}));
    for (const event of events) writeFileSync(path.join(dir,event.payload.screenshot),Buffer.from("annotation-image"));
    writeFileSync(path.join(dir,"events.jsonl"),events.map(e=>JSON.stringify(e)).join("\n"));
    writeFileSync(path.join(dir,"bundle.json"),JSON.stringify({session:{durationMs:2000,platform:"darwin"},stats:{},steps:[]}));
    writeFileSync(path.join(dir,"narration.json"),JSON.stringify({model:"SenseVoiceSmall-INT8",language:"zh",segments:[{atMs:100,endMs:1000,text:"这里点击保存按钮"},{atMs:30000,endMs:31000,text:"不相关的语音"}]}));
    let submitted = false;
    const tools = createDescriberTools({sessionDir:dir,startedAt:1000,extractor:null,redaction:{current:null},onSubmit:()=>{submitted=true;}});
    const invoke = (name:string,args:unknown={}) => tools.find(tool=>tool.name===name)!.handler(args,{sessionId:"test",toolCallId:"test",toolName:name,arguments:args});
    const timeline = JSON.parse(String(await invoke("get_timeline")));
    assert.equal(timeline.annotationCoverage.total,7);
    assert.deepEqual(timeline.annotationCoverage.counts,{region:2,click:2,crop:3});
    const submission = {title:"保存设置",intent:"保存设置",steps:[{id:"s1",title:"保存",detail:"点击保存按钮"}]};
    const reject = await invoke("submit_analysis",submission) as {resultType:string;textResultForLlm:string};
    assert.equal(reject.resultType,"failure");assert.match(reject.textResultForLlm,/offset=0/);
    assert.equal(submitted,false);
    const first = await invoke("get_annotations",{offset:0}) as {textResultForLlm:string};
    const page = JSON.parse(first.textResultForLlm);
    assert.equal(page.nextOffset,6);
    assert.deepEqual(page.annotations[0].nearbyNarration.map((s:{text:string})=>s.text),["这里点击保存按钮"]);
    assert.equal(page.annotations[0].kind,"crop");
    assert.equal(page.annotations[0].imageAvailable,true);
    const rejectRemaining = await invoke("submit_analysis",submission) as {textResultForLlm:string};
    assert.match(rejectRemaining.textResultForLlm,/offset=6/);
    await invoke("get_annotations",{offset:6});
    const missingNarration = await invoke("submit_analysis",submission) as {textResultForLlm:string};
    assert.match(missingNarration.textResultForLlm,/full current voice narration/);
    await invoke("get_narration",{query:"保存"});
    const partialNarration = await invoke("submit_analysis",submission) as {resultType:string};
    assert.equal(partialNarration.resultType,"failure");
    await invoke("get_narration");
    await invoke("submit_analysis",submission);
    assert.equal(submitted,true);
    utimesSync(path.join(dir,"narration.json"), 100, 100);
    const changedNarration = await invoke("submit_analysis",submission) as {resultType:string};
    assert.equal(changedNarration.resultType,"failure");
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
