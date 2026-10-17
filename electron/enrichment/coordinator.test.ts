import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EnrichmentCoordinator, inputRevision } from "./coordinator";
import { workflowStore, sessionLocks } from "./store";
import { SkillBuilder } from "../skillbuilder/builder";
import { toAnalysis } from "../../common/analysis";

test('Claude connectivity check gates planning, repeats on retry and supports cancellation',async t=>{
  const {id,root}=fixture(t),config=path.join(root,'claude-config'),bin=path.join(root,'bin');mkdirSync(config);mkdirSync(bin);
  const state=path.join(root,'mode'),calls=path.join(root,'calls.jsonl');writeFileSync(state,'fail');
  writeFileSync(path.join(config,'settings.json'),JSON.stringify({model:'test-model[1m]'}));
  for(const [key,value] of Object.entries({SKILL_RECORDER_PROCESSING_BACKEND:'local-agent',SKILL_RECORDER_PROCESSING_DIR:path.join(root,'processing'),CLAUDE_CONFIG_DIR:config,PATH:bin+path.delimiter+process.env.PATH})){
    const old=process.env[key];process.env[key]=value;t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});
  }
  writeFileSync(path.join(bin,'claude'),`#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2);
if(args.includes('--version')){console.log('2.1.251');process.exit(0)}
if(args.includes('--help')){console.log('--json-schema --tools --strict-mcp-config --input-format --safe-mode');process.exit(0)}
if(args[0]==='auth'){console.log(JSON.stringify({loggedIn:true}));process.exit(0)}
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
 const envelope=JSON.parse(input),text=envelope.message.content[0].text,check=text.includes('submit_connection_check');
 fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({check,hasRecording:text.includes('Prepare report')})+'\\n');
 console.log(JSON.stringify({type:'system',subtype:'init',model:'test-model[1m]'}));
 const mode=fs.readFileSync(${JSON.stringify(state)},'utf8');
 if(check&&mode==='fail'){console.error('ECONNREFUSED private-token');process.exitCode=1;return}
 if(check&&mode==='hang'){setTimeout(()=>{},60000);return}
 console.log(JSON.stringify({type:'result',structured_output:{content:'',toolCalls:[{name:check?'submit_connection_check':'submit_preparation',arguments:JSON.stringify(check?{ok:true}:{gaps:[],questions:[]})}]}}));
});`,{mode:0o700});
  let checkingStarted!:()=>void;let ready=new Promise<void>(r=>checkingStarted=r);
  const c=new EnrichmentCoordinator(e=>{if(e.workflow.progress?.at(-1)?.phase==='checking' && e.workflow.progress.at(-1)?.title==='Claude 进程已就绪')checkingStarted();});
  await assert.rejects(c.prepare(id),error=>{assert.match((error as Error).message,/连接自检失败/);assert.doesNotMatch((error as Error).message,/private-token/);return true;});
  assert.deepEqual(readFileSync(calls,'utf8').trim().split('\n').map(x=>JSON.parse(x).check),[true]);
  assert.equal(c.get(id).package?.status,'draft');
  writeFileSync(state,'pass');const w=await c.prepare(id,'sop');
  assert.equal(w.package?.outputKind,'undecided','recording analysis must not inherit a generation format');
  assert.equal(w.package?.status,'ready');assert.ok(w.progress?.some(e=>e.title==='连接自检通过'));
  const recorded=readFileSync(calls,'utf8').trim().split('\n').map(x=>JSON.parse(x));
  assert.deepEqual(recorded.map(x=>x.check),[true,true,false]);assert.ok(recorded.filter(x=>x.check).every(x=>!x.hasRecording));
  writeFileSync(state,'hang');ready=new Promise<void>(r=>checkingStarted=r);
  const pending=c.prepare(id);const rejection=assert.rejects(pending,/取消/);await ready;await c.cancel(id);await rejection;
  assert.equal(c.busy(id),false);assert.equal(c.get(id).package?.status,'draft');
});

test("Claude clarification resumes the bound session with latest answers and preserves earlier answers",async t=>{
  const {id,root}=fixture(t),bin=path.join(root,"resume-bin"),config=path.join(root,"resume-config");
  mkdirSync(bin);mkdirSync(config);
  const calls=path.join(root,"resume-calls.jsonl");
  writeFileSync(path.join(config,"settings.json"),JSON.stringify({model:"test-model"}));
  for(const [key,value] of Object.entries({SKILL_RECORDER_PROCESSING_BACKEND:"local-agent",SKILL_RECORDER_PROCESSING_DIR:path.join(root,"processing"),CLAUDE_CONFIG_DIR:config,PATH:bin+path.delimiter+process.env.PATH})){
    const previous=process.env[key];process.env[key]=value;t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous;});
  }
  writeFileSync(path.join(bin,"claude"),`#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2);
if(args.includes('--version')){console.log('2.1.251');process.exit(0)}
if(args.includes('--help')){console.log('--json-schema --tools --strict-mcp-config --input-format --safe-mode');process.exit(0)}
if(args[0]==='auth'){console.log(JSON.stringify({loggedIn:true}));process.exit(0)}
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
 const text=JSON.parse(input).message.content[0].text,check=text.includes('submit_connection_check'),prep=text.includes('submit_preparation');
 if(check||prep){console.log(JSON.stringify({type:'result',structured_output:{content:'',toolCalls:[{name:check?'submit_connection_check':'submit_preparation',arguments:JSON.stringify(check?{ok:true}:{gaps:[{id:'g1',stepRefs:['s1'],question:'Which orders?',reason:'Need rule',strategy:'user-question',critical:true,resolved:false}],questions:[]})}]}}));return;}
 const resume=args.includes('--resume'),sid=args[args.indexOf(resume?'--resume':'--session-id')+1];
 const latest=resume?JSON.parse(text.split('\\n').at(-1)):null;
 fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify({resume,sid,answers:latest?.taskPackage.answers.length??0})+'\\n');
 const n=latest?.taskPackage.answers.length??0,user=latest?.evidence.find(e=>e.sourceType==='user'&&e.sourceRef==='q1');
 const output={claims:user?[{id:'c1',stepRefs:['s1'],text:'Use paid orders',kind:'user-confirmed',evidenceRefs:[user.id],temporalScope:'invariant',appliesTo:'All orders',review:'pending'}]:[],remainingGapRefs:n<2?['g1']:[],summary:'Continued',questions:n<2?[{id:n===0?'q1':'q2',kind:'business-rule',gapRefs:['g1'],text:n===0?'Which orders?':'Which exception?',reason:'Need rule',critical:true,options:[]}]:[]};
 console.log(JSON.stringify({type:'system',subtype:'init',session_id:sid}));
 console.log(JSON.stringify({type:'result',session_id:sid,is_error:false,structured_output:output}));
});`,{mode:0o700});
  const c=new EnrichmentCoordinator();await c.prepare(id);c.confirm(id,null);const runId=randomUUID();
  let w=await c.run(id,runId);assert.equal(w.run?.status,"awaiting-input");
  const answer=(questionId:string,text:string)=>({questionId,text,status:"draft" as const,appliesTo:"",updatedAt:Date.now(),confirmedAt:null});
  await c.draft(id,{answers:[answer("q1","Paid orders")]});c.confirm(id,null);
  w=await c.run(id,runId,true);assert.equal(w.run?.status,"awaiting-input",w.run?.error??"");
  assert.equal(w.package?.answers[0].status,"confirmed");
  assert.equal(w.result?.claims[0].temporalScope,"at-recording");
  await c.draft(id,{answers:[answer("q2","Skip canceled")]});c.confirm(id,null);
  w=await c.run(id,runId,true);assert.equal(w.run?.status,"completed",w.run?.error??"");
  assert.equal(w.package?.answers.length,2);
  assert.equal(w.package?.questionHistory?.[0].id,"q1");
  assert.equal(w.package?.gaps[0].resolved,true);
  const records=readFileSync(calls,"utf8").trim().split("\n").map(line=>JSON.parse(line));
  assert.deepEqual(records.map(r=>r.resume),[false,true,true]);
  assert.deepEqual(records.map(r=>r.answers),[0,1,2]);
  assert.equal(new Set(records.map(r=>r.sid)).size,1);
});

function fixture(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(path.join(tmpdir(), "enhancement-integration-"));
  for (const [key, value] of Object.entries({
    SKILL_RECORDER_SESSIONS_DIR: root,
    SKILL_RECORDER_PROCESSING_BACKEND: "api",
    SKILL_RECORDER_MODEL: "test",
    SKILL_RECORDER_BASE_URL: "http://localhost:11434/v1",
  })) {
    const old = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (old === undefined) delete process.env[key];
      else process.env[key] = old;
    });
  }
  const id = "enhance-test",
    dir = path.join(root, id);
  mkdirSync(dir);
  const analysis = toAnalysis(
    id,
    1,
    {
      title: "Report",
      intent: "Prepare report",
      intentConfidence: "high",
      intentRationale: "recording",
      steps: [
        {
          id: "s1",
          title: "Summarize",
          detail: "Summarize paid orders",
          apps: [],
          evidence: ["recording"],
          confidence: "high",
        },
      ],
    },
    [],
    null,
  );
  writeFileSync(path.join(dir, "analysis.json"), JSON.stringify(analysis));
  t.after(() => {
    // Native task inputs are frozen with read-only directories.
    const unlock = (dir: string) => {
      chmodSync(dir, 0o700);
      for (const entry of readdirSync(dir, {withFileTypes: true}))
        if (entry.isDirectory()) unlock(path.join(dir, entry.name));
    };
    unlock(root);
    rmSync(root, { recursive: true, force: true });
  });
  return { id, dir, root, analysis };
}
const response = (name: string, args: unknown) =>
  new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: randomUUID(),
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
              },
            ],
          },
        },
      ],
    }),
  );

test("invalid candidate evidence does not leave questions or revisions from a rejected result",async t=>{
  const {id}=fixture(t);const coordinator=new EnrichmentCoordinator();
  let preparation=true;
  t.mock.method(globalThis,"fetch",async()=>{
    if(preparation){preparation=false;return response("submit_preparation",{gaps:[{id:"g1",stepRefs:["s1"],question:"Which orders?",reason:"Need rule",strategy:"user-question",critical:true,resolved:false}],questions:[]});}
    return response("submit_enhancement",{claims:[{id:"c1",stepRefs:["s1"],text:"Recorded fact",kind:"observed",evidenceRefs:["invented-evidence"],temporalScope:"at-recording",appliesTo:"",review:"pending"}],remainingGapRefs:["g1"],summary:"Candidate",questions:[{id:"q1",kind:"business-rule",gapRefs:["g1"],text:"Which orders?",reason:"Need rule",critical:true,options:["Paid"]}]});
  });
  await coordinator.prepare(id);const frozen=await coordinator.confirm(id,null);
  const failed=await coordinator.run(id,randomUUID());
  assert.equal(failed.run?.status,"failed");
  assert.deepEqual(failed.package,frozen.package,"failed result cannot mutate confirmed package");
  assert.equal(failed.result,null);
  assert.equal(failed.package?.status,"frozen");
});

test("preparation → confirmed batch → evidence review → exact draft export; changed input expires preview", async (t) => {
  const { id, root, dir, analysis } = fixture(t);
  let stage = 0;
  const coordinator = new EnrichmentCoordinator();
  const builder = new SkillBuilder(() => {});
  t.after(() => void builder.dispose());
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      const payload = JSON.parse(String(init.body));
      const tools = payload.tools.map(
        (tool: { function: { name: string } }) => tool.function.name,
      );
      if (stage === 0) {
        assert.deepEqual(tools, ["submit_preparation"]);
        assert.match(payload.messages[0].content, /红框\/区域框选/);
        assert.match(payload.messages[0].content, /只向用户询问/);
        stage++;
        return response("submit_preparation", {
          gaps: [
            {
              id: "g1",
              stepRefs: ["s1"],
              question: "Which orders?",
              reason: "Business rule",
              strategy: "user-question",
              critical: true,
              resolved: false,
            },
          ],
          questions: [
            {
              id: "q1",
              kind: "business-rule",
              gapRefs: ["g1"],
              text: "Which orders?",
              reason: "Need rule",
              critical: true,
              options: ["paid"],
            },
          ],
        });
      }
      if (stage === 1) {
        assert.deepEqual(tools, ["submit_enhancement"]);
        stage++;
        return response("submit_enhancement", {
          claims: [],
          remainingGapRefs: ["g1"],
          summary: "Need one decision",
          questions: [
            { id: "q1", kind: "business-rule", gapRefs: ["g1"], text: "Which orders?", reason: "Need rule", critical: true, options: ["paid"] },
          ],
        });
      }
      if (stage === 2) {
        assert.deepEqual(tools, ["submit_enhancement"]);
        const evidence = JSON.parse(payload.messages.at(-1).content).evidence;
        const user = evidence.find(
          (e: { sourceType: string }) => e.sourceType === "user",
        );
        stage++;
        return response("submit_enhancement", {
          claims: [
            {
              id: "c1",
              stepRefs: ["s1"],
              text: "Exclude refunds",
              kind: "user-confirmed",
              evidenceRefs: [user.id],
              temporalScope: "invariant",
              appliesTo: "All paid orders",
              reason: "Confirmed by user",
              review: "pending",
            },
          ],
          remainingGapRefs: [],
          summary: "Rule clarified",
          followupQuestions: [],
        });
      }
      if (stage === 3) {
        stage++;
        return response("propose_plan", {
          name: "report",
          title: "Report",
          description: "Create report",
          summary: "",
          generalization: "For new inputs",
          values: [],
          steps: [
            {
              kind: "calculation",
              title: "Read",
              text: "Read input orders and exclude refunds",
              tools: ["Read"],
            },
          ],
          allowedTools: ["Read"],
        });
      }
      stage++;
      return response("submit_skill", {
        name: "report",
        description: "Create report",
        allowedTools: ["Read"],
        body: "Read orders and exclude refunds.",
      });
    },
  );
  let w = await coordinator.prepare(id);
  assert.equal(w.package?.status, "ready");
  assert.equal(coordinator.gate(id).allowed, false);
  await assert.rejects(coordinator.run(id, randomUUID()), /确认/);
  w = coordinator.confirm(id, null);
  const runId = randomUUID();
  w = await coordinator.run(id, runId);
  assert.equal(w.run?.status, "awaiting-input");
  w = await coordinator.draft(id, {
    answers: [
      {
        questionId: "q1",
        text: "Exclude refunds",
        status: "draft",
        appliesTo: "All paid orders",
        updatedAt: 1,
        confirmedAt: null,
      },
    ],
  });
  assert.equal(w.package?.answers[0].status, "draft");
  w = coordinator.confirm(id, null);
  assert.equal(w.package?.answers[0].status, "confirmed");
  w = await coordinator.run(id, runId, true);
  assert.equal(w.run?.status, "completed");
  assert.equal(coordinator.gate(id).allowed, false);
  assert.throws(() => coordinator.review(id, []), /逐条/);
  w = coordinator.review(id, [{ id: "c1", review: "accepted" }]);
  assert.equal(coordinator.gate(id).allowed, true);
  assert.equal(coordinator.gate(id).draft, false);
  const plan = await builder.build({
    sessionId: id,
    architecture: "agent-skill",
  });
  assert.equal(plan.generation?.status, "reviewed");
  const preview = await builder.prepare(id, plan);
  assert.match(preview.markdown, /Exclude refunds/);
  assert.match(preview.markdown, /未.*试运行/);
  const placed = await builder.create(
    id,
    plan,
    { kind: "export", dir: path.join(root, "exports") },
    preview.id,
  );
  assert.ok(placed);
  assert.equal(readFileSync(placed.path, "utf8"), preview.markdown);
  const priorSnapshot = workflowStore.read(id).result;
  await coordinator.draft(id, { userNotes: "Changed rule" });
  assert.equal(coordinator.gate(id).allowed, false);
  assert.deepEqual(workflowStore.read(id).result, priorSnapshot);
  await assert.rejects(builder.prepare(id, plan), /修改|确认|过期/);
  writeFileSync(
    path.join(dir, "analysis.json"),
    JSON.stringify({ ...analysis, revision: 2 }),
  );
  assert.notEqual(inputRevision(id), plan.generation?.inputRevision);
  assert.equal(coordinator.get(id).package?.status, "stale");
});

test("manual import cannot fabricate approvals, references or query source; skipped low-confidence analysis stays draft", async (t) => {
  const { id, dir, analysis } = fixture(t);
  const c = new EnrichmentCoordinator();
  writeFileSync(
    path.join(dir, "analysis.json"),
    JSON.stringify({
      ...analysis,
      steps: analysis.steps.map((s) => ({ ...s, confidence: "low" })),
    }),
  );
  c.skip(id);
  assert.equal(c.gate(id).draft, true);
  assert.equal(c.gate(id).gaps.length, 1);
  assert.throws(() => c.review(id, []), /候选/);
  await sessionLocks.withLock(id, "analysis", async () => {
    assert.throws(() => c.skip(id), /取消/);
  });
});

test("manual result import uses the same review gates and rejects self-approval, unknown evidence and mismatched run", async (t) => {
  const { id } = fixture(t),
    c = new EnrichmentCoordinator();
  t.mock.method(globalThis, "fetch", async () =>
    response("submit_preparation", {
      gaps: [
        {
          id: "g1",
          stepRefs: ["s1"],
          question: "Confirm source",
          reason: "Missing",
          strategy: "user-question",
          critical: true,
          resolved: false,
        },
      ],
      questions: [],
    }),
  );
  await c.prepare(id);
  c.confirm(id, null);
  const packet = (await c.exportPackage(id)) as {
    runId: string;
    taskPackage: { inputRevision: string; revision: number };
    evidence: { id: string }[];
  };
  const result = {
    schemaVersion: 1,
    runId: packet.runId,
    inputRevision: packet.taskPackage.inputRevision,
    taskPackageRevision: packet.taskPackage.revision,
    claims: [
      {
        id: "c1",
        stepRefs: ["s1"],
        text: "Summarize orders",
        kind: "observed",
        evidenceRefs: [packet.evidence[0]!.id],
        temporalScope: "at-recording",
        appliesTo: "Recorded task",
        reason: "Recording",
        review: "pending",
      },
    ],
    remainingGapRefs: ["g1"],
    summary: "Historical facts only",
  };
  await assert.rejects(
    c.importCandidate(id, { result: { ...result, runId: randomUUID() } }),
    /不属于/,
  );
  await assert.rejects(
    c.importCandidate(id, {
      result: {
        ...result,
        claims: result.claims.map((claim) => ({
          ...claim,
          review: "accepted",
        })),
      },
    }),
    /approve/,
  );
  await assert.rejects(
    c.importCandidate(id, {
      result: {
        ...result,
        claims: result.claims.map((claim) => ({
          ...claim,
          evidenceRefs: ["invented"],
        })),
      },
    }),
    /evidence/,
  );
  await assert.rejects(
    c.importCandidate(id, {
      result,
      evidence: [
        {
          id: "external-1",
          sourceRef: "unapproved-server",
          summary: "private",
          recordedAt: null,
          queriedAt: 1,
          resourceAt: null,
        },
      ],
    }),
    /超出/,
  );
  assert.equal(c.gate(id).allowed, false);
  const w = await c.importCandidate(id, { result });
  assert.equal(w.run?.status, "completed");
  assert.equal(c.gate(id).allowed, false);
  c.review(id, [{ id: "c1", review: "accepted" }]);
  assert.equal(c.gate(id).draft, true);
  await c.importCandidate(id, { result });
  assert.equal(c.gate(id).allowed, false);
  assert.equal(workflowStore.read(id).approvedAt, null);
});

test("canceled turn preserves package and application evidence checkpoint; restart does not approve or release locks early", async (t) => {
  const { id } = fixture(t),
    c = new EnrichmentCoordinator();
  let phase = "prepare";
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      if (phase === "prepare")
        return response("submit_preparation", { gaps: [], questions: [] });
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(new Error("canceled")),
          { once: true },
        );
      });
    },
  );
  await c.prepare(id);
  c.confirm(id, null);
  phase = "run";
  const runId = randomUUID();
  const promise = c.run(id, runId);
  // Wait for the persisted evidence checkpoint rather than assuming model startup timing.
  for (
    let i = 0;
    i < 200 && workflowStore.read(id).run?.status !== "running";
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(sessionLocks.busy(id), true);
  assert.throws(() => c.skip(id), /取消/);
  await c.cancel(id);
  assert.equal(sessionLocks.busy(id),false,"stop acknowledgement waits for model shutdown and checkpoint commit");
  const w = await promise;
  assert.equal(w.run?.status, "canceled");
  assert.equal(w.package?.status, "frozen");
  assert.ok(w.evidence.length > 0);
  assert.equal(w.approvedAt, null);
  assert.equal(sessionLocks.busy(id), false);
  assert.equal(workflowStore.read(id).run?.runId, runId);
  assert.equal(c.gate(id).allowed, false);
});

test("explicit skip carries unresolved gaps through plan, preview, skill.json and export", async (t) => {
  const { id, root, dir, analysis } = fixture(t),
    c = new EnrichmentCoordinator(),
    builder = new SkillBuilder(() => {});
  t.after(() => void builder.dispose());
  writeFileSync(
    path.join(dir, "analysis.json"),
    JSON.stringify({ ...analysis, intentConfidence: "low" }),
  );
  c.skip(id);
  let turn = 0;
  t.mock.method(globalThis, "fetch", async () =>
    turn++ === 0
      ? response("propose_plan", {
          name: "draft-report",
          title: "Draft report",
          description: "Report",
          values: [],
          steps: [
            {
              kind: "calculation",
              title: "Read",
              text: "Read input",
              tools: ["Read"],
            },
          ],
          allowedTools: ["Read"],
        })
      : response("submit_skill", {
          name: "draft-report",
          description: "Report",
          allowedTools: ["Read"],
          body: "Read input.",
        }),
  );
  const plan = await builder.build({
    sessionId: id,
    architecture: "agent-skill",
  });
  assert.equal(plan.generation?.status, "draft");
  assert.ok(plan.generation?.gaps.length);
  const preview = await builder.prepare(id, plan);
  assert.match(preview.markdown, /待确认草稿/);
  const placed = await builder.create(
    id,
    plan,
    { kind: "export", dir: path.join(root, "exports") },
    preview.id,
  );
  assert.ok(placed);
  assert.match(readFileSync(placed.path, "utf8"), /任务目标/);
  assert.equal(
    JSON.parse(readFileSync(path.join(dir, "skill.json"), "utf8")).generation
      .status,
    "draft",
  );
  assert.equal(
    JSON.parse(
      readFileSync(
        path.join(path.dirname(placed.path), "review-report.json"),
        "utf8",
      ),
    ).status,
    "draft",
  );
});

test("follow-up batches require new immutable confirmation and keep cumulative budget", async (t) => {
  const { id } = fixture(t),
    c = new EnrichmentCoordinator();
  let turn = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      if (turn++ === 0)
        return response("submit_preparation", {
          gaps: [
            {
              id: "g1",
              stepRefs: ["s1"],
              question: "Which source?",
              reason: "Missing",
              strategy: "user-question",
              critical: true,
              resolved: false,
            },
          ],
          questions: [],
        });
      const payload = JSON.parse(String(init.body));
      assert.deepEqual(
        payload.tools.map(
          (tool: { function: { name: string } }) => tool.function.name,
        ),
        ["submit_enhancement"],
      );
      return response("submit_enhancement", {
        claims: [],
        remainingGapRefs: ["g1"],
        summary: "Needs confirmation",
        ...(turn === 2 ? { questions:
          turn === 2
            ? [
                {
                  id: "followup-1",
                  kind: "business-rule",
                  gapRefs: ["g1"],
                  text: "Which of the conflicting sources?",
                  reason: "Material conflict",
                  critical: true,
                  options: [],
                },
              ]
            : [] } : { followupQuestions: [] }),
      });
    },
  );
  await c.prepare(id);
  c.confirm(id, null);
  const runId = randomUUID();
  let w = await c.run(id, runId);
  assert.equal(w.run?.status, "awaiting-input");
  assert.equal(w.package?.revision, 2);
  assert.equal(w.package?.confirmedAt, null);
  const previousMs = w.run!.activeMs;
  await assert.rejects(c.run(id, runId, true), /确认/);
  c.confirm(id, null);
  w = await c.run(id, runId, true);
  assert.equal(w.run?.attempt, 2);
  assert.ok(w.run!.activeMs >= previousMs);
  assert.equal(w.run?.budget.activeMs, 300000);
  assert.equal(w.run?.status, "completed");
  assert.equal(c.gate(id).allowed, false);
  w.run!.activeMs = 300001;
  w.run!.status = "paused";
  workflowStore.save(w);
  w = await c.run(id, runId, true);
  assert.equal(w.run?.status, "paused");
  assert.equal(w.run?.budget.activeMs, 300000);
  c.increaseBudget(id, 600000);
  assert.equal(workflowStore.read(id).run?.budget.activeMs, 600000);
});

test("failed finalization retries saved answers and result without restarting deep analysis", async t=>{
  const {id}=fixture(t),c=new EnrichmentCoordinator();let turn=0;
  t.mock.method(globalThis,"fetch",async (_url:unknown,init:RequestInit)=>{
    turn++;
    if(turn===1)return response("submit_preparation",{gaps:[{id:"g1",stepRefs:["s1"],question:"Which source?",reason:"Missing",strategy:"user-question",critical:true,resolved:false}],questions:[]});
    if(turn===2)return response("submit_enhancement",{claims:[],remainingGapRefs:["g1"],summary:"Saved analysis",questions:[{id:"q1",kind:"business-rule",gapRefs:["g1"],text:"Which source?",reason:"Missing",critical:true,options:[]}]});
    const payload=JSON.parse(String(init.body));
    assert.match(payload.messages[0].content,/终局整理/);
    const input=JSON.parse(payload.messages[1].content);
    assert.equal(input.priorResult.summary,"Saved analysis");
    assert.equal(input.package.answers[0].text,"Use source A");
    if(turn===3)throw new Error("Temporary provider failure");
    return response("submit_enhancement",{claims:[],remainingGapRefs:[],summary:"Finalized",followupQuestions:[]});
  });
  await c.prepare(id);c.confirm(id,null);const runId=randomUUID();
  await c.run(id,runId);
  await c.draft(id,{answers:[{questionId:"q1",text:"Use source A",status:"draft",appliesTo:"",updatedAt:Date.now(),confirmedAt:null}]});
  c.confirm(id,null);
  let w=await c.run(id,runId,true);assert.equal(w.run?.status,"failed");assert.equal(w.result?.summary,"Saved analysis");
  w.run!.activeMs=w.run!.budget.activeMs+1;
  w.run!.externalCalls=w.run!.budget.maxExternalCalls;
  // Older exhausted retries saved "queued" instead of the stage being retried.
  w.run!.phase="queued";
  workflowStore.save(w);
  w=await c.run(id,runId,true,true);assert.equal(w.run?.status,"completed");assert.equal(w.result?.summary,"Finalized");
  assert.ok(w.run!.activeMs<w.run!.budget.activeMs);assert.equal(w.run!.externalCalls,0);assert.equal(w.run!.attempt,3);
  await assert.rejects(c.run(id,runId,true,true),/已停止/);
});

test("replanning from the recording creates a fresh task with fresh model progress and budgets",async t=>{
  const {id}=fixture(t),c=new EnrichmentCoordinator();
  t.mock.method(globalThis,"fetch",async (_url:unknown,init:RequestInit)=>{
    const request=JSON.parse(String(init.body));
    if(request.tools[0].function.name==='submit_preparation'){
      assert.ok(JSON.parse(request.messages[1].content).analysis);
      return response('submit_preparation',{gaps:[],questions:[]});
    }
    return response('submit_enhancement',{claims:[],remainingGapRefs:[],summary:'Fresh analysis',questions:[]});
  });
  await c.prepare(id);c.confirm(id,null);const oldId=randomUUID();let w=await c.run(id,oldId);
  const oldPreparation=w.package!.preparationId;
  w.run!.activeMs=300001;w.run!.externalCalls=20;w.run!.status='failed';workflowStore.save(w);
  w=await c.prepare(id);assert.notEqual(w.package!.preparationId,oldPreparation);assert.equal(w.run,null);assert.equal(w.result,null);
  assert.equal(w.progress?.length,3);assert.equal(w.progress?.[0].title,'已载入规划材料');assert.equal(w.progress?.[1].model,'test');assert.ok(w.progress?.every(e=>e.phase==='capabilities' && e.at>=w.package!.preparedAt!));assert.equal(w.progress?.at(-1)?.title,'规划结果校验通过');
  c.confirm(id,null);const newId=randomUUID();w=await c.run(id,newId);
  assert.equal(w.run!.runId,newId);assert.equal(w.run!.attempt,1);assert.equal(w.run!.externalCalls,0);assert.ok(w.run!.activeMs<300000);assert.equal(w.run!.status,'completed');
});

test("failed API turn preserves app checkpoint and continuation uses saved material after context rollback", async (t) => {
  const { id } = fixture(t),
    c = new EnrichmentCoordinator();
  let mode = "prepare";
  t.mock.method(globalThis, "fetch", async () =>
    mode === "prepare"
      ? response("submit_preparation", { gaps: [], questions: [] })
      : new Response(
          JSON.stringify({
            choices: [
              {
                message: { role: "assistant", content: "partial response" },
                finish_reason: "length",
              },
            ],
          }),
        ),
  );
  await c.prepare(id);
  c.confirm(id, null);
  mode = "fail";
  const runId = randomUUID();
  let w = await c.run(id, runId);
  assert.equal(w.run?.status, "failed");
  assert.match(w.run?.error ?? "", /truncated/);
  assert.ok(w.evidence.length);
  const saved = w.evidence.map((e) => e.id);
  const elapsed = w.run!.activeMs;
  t.mock.method(globalThis, "fetch", async () =>
    response("submit_enhancement", {
      claims: [],
      remainingGapRefs: [],
      summary: "Ready",
      questions: [],
    }),
  );
  w = await c.run(id, runId, true);
  assert.equal(w.run?.status, "completed");
  assert.deepEqual(
    w.evidence.map((e) => e.id),
    saved,
  );
  assert.ok(w.run!.activeMs >= elapsed);
  assert.equal(w.approvedAt, null);
});
