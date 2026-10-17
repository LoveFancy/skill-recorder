import { test } from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chooseBackend, detectAgent } from "./service";
import { processFailureMessage, runProcess, CLAUDE_OUTPUT_LIMITS } from "./process";
import { claudeExecutionProgress } from "./claude-progress";
import type { AgentAvailability } from "../../common/agents";
const availability: AgentAvailability = {
  agentKind: "claude-code",
  status: "not-installed",
  executable: null,
  agentVersion: null,
  checkedAt: 0,
  lastError: null,
  controlled: false,
};
test("JSON events arrive before process exit and preserve split UTF-8 characters",async()=>{
  let notify!:()=>void;const first=new Promise<void>(r=>notify=r);let settled=false;const events:unknown[]=[];
  const running=runProcess(process.execPath,['-e',`const b=Buffer.from(JSON.stringify({type:'system',text:'中文'})+'\\n');const cut=b.indexOf(Buffer.from('中'))+1;process.stdout.write(b.subarray(0,cut));setTimeout(()=>process.stdout.write(b.subarray(cut)),20);setTimeout(()=>process.exit(0),200);`],{onJsonEvent:e=>{events.push(e);notify();}}).finally(()=>{settled=true;});
  await first;assert.equal(settled,false);assert.deepEqual(events,[{type:'system',text:'中文'}]);await running;
});
test('Claude streams beyond the old 16 MB limit while retaining final results and tool evidence',async t=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'claude-stream-budget-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const diagnosticFile=path.join(root,'execution.jsonl');
  let live=0;
  const raw=await runProcess(process.execPath,['-e',`
const write=s=>new Promise(r=>process.stdout.write(s,r));
(async()=>{
await write(JSON.stringify({type:'system',subtype:'init',session_id:'session'})+'\\n');
const delta=JSON.stringify({type:'stream_event',event:{type:'content_block_delta',delta:{type:'thinking_delta',thinking:'x'.repeat(4096)}}})+'\\n';
for(let i=0;i<4300;i++){await write(delta);await write(JSON.stringify({type:'system',subtype:'thinking_tokens',count:i})+'\\n');}
await write(JSON.stringify({type:'assistant',message:{content:[{type:'thinking',thinking:'private reasoning'},{type:'tool_use',id:'tool1',name:'mcp__mail__search',input:{query:'test'}}]}})+'\\n');
await write(JSON.stringify({type:'user',message:{content:[{type:'tool_result',tool_use_id:'tool1',content:'evidence'}]}})+'\\n');
await write(JSON.stringify({type:'result',structured_output:{ok:true}}));
})();`],{...CLAUDE_OUTPUT_LIMITS,diagnosticFile,timeoutMs:15000,onJsonEvent:()=>live++});
  const events=raw.trim().split('\n').map(line=>JSON.parse(line));assert.equal(live,8604);assert.equal(events.length,4);
  assert.equal(events[0].session_id,'session');assert.equal(events[1].message.content[0].id,'tool1');assert.equal(events[2].message.content[0].content,'evidence');assert.deepEqual(events.at(-1).structured_output,{ok:true});
  assert.ok(Buffer.byteLength(raw)<2048);assert.doesNotMatch(raw,/private reasoning|thinking_tokens|thinking_delta/);
  const log=readFileSync(diagnosticFile,'utf8'),exit=JSON.parse(log.trim().split('\n').at(-1)!);
  assert.ok(Buffer.byteLength(log)<10000);assert.ok(exit.bytes>16*1024*1024);assert.equal(exit.transientEvents,8600);assert.equal(exit.retainedBytes,Buffer.byteLength(raw));
});
test('larger complete Claude output is allowed and independent output limits still terminate runaway processes',async()=>{
  const raw=await runProcess(process.execPath,['-e',`console.log(JSON.stringify({type:'result',structured_output:{content:'x'.repeat(17*1024*1024)}}))`],{...CLAUDE_OUTPUT_LIMITS,timeoutMs:15000});
  assert.equal(JSON.parse(raw).structured_output.content.length,17*1024*1024);
  await assert.rejects(runProcess(process.execPath,['-e',`process.stdout.write('x'.repeat(2048));setInterval(()=>{},1000)`],{maxOutputBytes:1024}),/累计输出超过限制/);
  await assert.rejects(runProcess(process.execPath,['-e',`console.log(JSON.stringify({type:'result',content:'x'.repeat(2048)}))`],{...CLAUDE_OUTPUT_LIMITS,maxRetainedBytes:1024,maxLineBytes:4096}),/有效消息与最终结果超过保留上限/);
  await assert.rejects(runProcess(process.execPath,['-e',`process.stdout.write('x'.repeat(2048));setInterval(()=>{},1000)`],{...CLAUDE_OUTPUT_LIMITS,maxLineBytes:1024}),/单条消息超过限制/);
  await assert.rejects(runProcess(process.execPath,['-e',`console.log(JSON.stringify({type:'result',is_error:true,errors:['authentication_error private-token']}))`],CLAUDE_OUTPUT_LIMITS),error=>{assert.match((error as Error).message,/认证不可用/);assert.doesNotMatch((error as Error).message,/private-token/);return true;});
});
test("execution projection shows real actions without reasoning, inputs or output secrets",()=>{
  const actions:unknown[]=[];let calls=0;const emit=claudeExecutionProgress((title,detail)=>actions.push({title,detail}),()=>calls++);
  const use={type:'assistant',message:{content:[{type:'thinking',thinking:'private reasoning'},{type:'tool_use',id:'t1',name:'Read',input:{file_path:'secret-token'}}]}};
  emit(use);emit(use);emit({type:'user',message:{content:[{type:'tool_result',tool_use_id:'t1',content:'secret-result'}]}});
  assert.equal(calls,1);assert.equal(actions.length,2);assert.match(JSON.stringify(actions),/读取材料|工具执行完成/);assert.doesNotMatch(JSON.stringify(actions),/secret|private reasoning/);
});
test("execution model follows session and message metadata without accepting arbitrary text",()=>{
  const models:(string|undefined)[]=[];
  const emit=claudeExecutionProgress((_title,_detail,model)=>models.push(model));
  emit({type:'system',subtype:'init',model:'claude-sonnet-4-6'});
  assert.equal(models.at(-1),'claude-sonnet-4-6');
  emit({type:'stream_event',event:{type:'message_start',message:{model:'claude-opus-4-6'}}});
  assert.equal(models.at(-1),'claude-opus-4-6');
  emit({type:'assistant',message:{model:'provider/model-v2[1m]',content:[]}});
  assert.equal(models.at(-1),'provider/model-v2[1m]');
  emit({type:'system',subtype:'init',model:'Bearer secret token'});
  assert.equal(models.at(-1),'provider/model-v2[1m]');
  emit({type:'result'});assert.equal(models.at(-1),'provider/model-v2[1m]');
  const fresh:(string|undefined)[]=[];
  claudeExecutionProgress((_title,_detail,model)=>fresh.push(model))({type:'system',subtype:'init'});
  assert.deepEqual(fresh,[undefined]);
});
test('stream progress exposes ongoing work and tool names without exposing thinking or partial arguments',t=>{
  let now=10000;t.mock.method(Date,'now',()=>now);
  const actions:unknown[]=[];let calls=0;
  const emit=claudeExecutionProgress((title,detail)=>actions.push({title,detail}),()=>calls++);
  emit({type:'stream_event',event:{type:'content_block_delta',delta:{type:'thinking_delta',thinking:'private-reasoning'}}});
  for(let i=0;i<10;i++)emit({type:'stream_event',event:{type:'content_block_delta',delta:{type:'thinking_delta',thinking:'private-reasoning'}}});
  assert.equal(actions.length,1,'stream updates are throttled');now+=2000;
  emit({type:'stream_event',event:{type:'content_block_start',content_block:{type:'tool_use',name:'mcp__mail__search'}}});
  emit({type:'stream_event',event:{type:'content_block_delta',delta:{type:'input_json_delta',partial_json:'secret-token'}}});
  assert.equal(calls,0,'partial tool arguments are not a completed tool call');
  assert.match(JSON.stringify(actions),/模型持续处理中|输出片段/);assert.match(JSON.stringify(actions),/mail \/ search/);assert.match(JSON.stringify(actions),/生成工具参数/);
  assert.doesNotMatch(JSON.stringify(actions),/private-reasoning|secret-token/);
});
test('process diagnostics retain waiting and exit metadata without raw content or credentials',async()=>{
  const root=mkdtempSync(path.join(os.tmpdir(),'claude-diagnostics-'));
  try{
    const file=path.join(root,'execution.jsonl');let waiting=0;
    await runProcess(process.execPath,['-e',`console.log(JSON.stringify({type:'system',subtype:'init',secret:'secret-output'}));console.error('secret-stderr');setTimeout(()=>console.log(JSON.stringify({type:'result'})),90);`],{input:'secret-prompt',diagnosticFile:file,waitingIntervalMs:20,onWaiting:()=>waiting++});
    const text=readFileSync(file,'utf8'),events=text.trim().split('\n').map(line=>JSON.parse(line));
    assert.ok(waiting>0);for(const event of ['spawn','stdout_event','waiting','first_response','exit'])assert.ok(events.some(e=>e.event===event),event);
    assert.equal(events.at(-1).code,0);assert.doesNotMatch(text,/secret-output|secret-stderr|secret-prompt/);
    const timeout=path.join(root,'timeout.jsonl');
    await assert.rejects(runProcess(process.execPath,['-e','setTimeout(()=>{},5000)'],{diagnosticFile:timeout,timeoutMs:50}),/超时/);
    const records=readFileSync(timeout,'utf8');assert.match(records,/"reason":"timeout"/);assert.match(records,/"receivedResponse":false/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("known CLI failures are actionable without exposing diagnostic secrets",async()=>{
  assert.match(processFailureMessage(1,"Not logged in · Please run /login sk-private-token"),/模型认证不可用/);
  assert.match(processFailureMessage(1,'--json-schema is not valid: no schema with key or ref'),/JSON Schema/);
  assert.match(processFailureMessage(1,'unknown option --secret=private'),/启动参数/);
  assert.doesNotMatch(processFailureMessage(1,"private unrecognized error"),/private/);
  for (const [diagnostic, expected] of [["error_max_structured_output_retries", /结构化结果/], ["429 rate_limit_error", /频率受限/], ["prompt is too long", /上下文容量/]] as const) {
    await assert.rejects(runProcess(process.execPath,["-e",`console.log(JSON.stringify({type:'result',is_error:true,subtype:'error_during_execution',errors:[${JSON.stringify(diagnostic)},'secret-token']}));process.exit(1)`]), error=>{
      assert.match((error as Error).message,expected);assert.doesNotMatch((error as Error).message,/secret-token/);return true;
    });
  }
  await assert.rejects(runProcess(process.execPath,["-e",'console.log(JSON.stringify({type:"result",is_error:true,result:"Not logged in · Please run /login secret-token"}));process.exit(1)']),error=>{
    assert.match((error as Error).message,/模型认证不可用/);
    assert.doesNotMatch((error as Error).message,/secret-token/);return true;
  });
});
test("only genuine missing installation falls back; explicit API is allowed", () => {
  assert.equal(chooseBackend("auto", availability), "api");
  for (const status of [
    "auth-required",
    "incompatible",
    "check-failed",
  ] as const)
    assert.throws(() => chooseBackend("auto", { ...availability, status }));
  assert.equal(
    chooseBackend("api", { ...availability, status: "auth-required" }),
    "api",
  );
  assert.throws(() => chooseBackend("local-agent", availability));
});
test("bad explicitly supplied executable is a check failure, never uninstalled", async () => {
  assert.equal(
    (await detectAgent("/nonexistent/claude-recorder-test")).status,
    "check-failed",
  );
});
test("subprocess cancellation before start and while running; bounded timeout", async () => {
  const before = new AbortController();
  before.abort();
  await assert.rejects(
    runProcess(process.execPath, [], { signal: before.signal }),
  );
  const controller = new AbortController();
  let leaderPid:number|undefined;
  const running = runProcess(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { signal: controller.signal,onSpawn:leader=>{leaderPid=leader.pid;} },
  );
  controller.abort();
  await assert.rejects(running, /取消/);
  if(leaderPid)assert.throws(()=>process.kill(leaderPid!,0),"stopped subprocess must be gone before cancellation resolves");
  await assert.rejects(
    runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      timeoutMs: 20,
    }),
    /超时/,
  );
  assert.equal(
    await runProcess(process.execPath, ["-e", 'process.stdout.write("ok")']),
    "ok",
  );
});
