import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentWorkspace } from "../../common/agents";
import type { TaskPackage } from "../../common/enhancement";
import { claudeConnectionSettings, claudeTaskEnvironment, mcpEvidenceFromEvents, nativeSessionArgs, runClaudeTaskSession, taskSessionPaths, validateScreenshotReviews } from "./claude-task-session";

test("screenshot reviews accept only supplied images and reject conflicting duplicate decisions", () => {
  validateScreenshotReviews(undefined, []);
  validateScreenshotReviews([{file:"frames/one.jpg",decision:"discard"}], ["frames/one.jpg"]);
  assert.throws(()=>validateScreenshotReviews([{file:"frames/other.jpg",decision:"discard"}], ["frames/one.jpg"]), /未提供/);
  assert.throws(()=>validateScreenshotReviews([{file:"frames/one.jpg",decision:"keep"},{file:"frames/one.jpg",decision:"discard"}], ["frames/one.jpg"]), /重复/);
  const args = nativeSessionArgs({paths:taskSessionPaths(randomUUID()),sessionId:randomUUID(),resume:false,imageNames:["frames/one.jpg"]});
  const schema = JSON.parse(args[args.indexOf("--json-schema")+1]);
  assert.deepEqual(schema.properties.screenshotReviews.items.properties.file.enum,["frames/one.jpg"]);
});

test("native session arguments enforce the isolated read-only baseline", () => {
  const old = process.env.SKILL_RECORDER_PROCESSING_DIR;
  process.env.SKILL_RECORDER_PROCESSING_DIR = mkdtempSync(path.join(tmpdir(), "task-args-"));
  try {
    const paths = taskSessionPaths(randomUUID());
    const args = nativeSessionArgs({ paths, sessionId: randomUUID(), resume: false,evidenceIds:["ev-real"],stepIds:["s1"],gapIds:["g1"] });
    for (const flag of ["--restricted", "--strict-mcp-config", "--disable-slash-commands", "--no-chrome", "--json-schema"])
      assert.ok(args.includes(flag), flag);
    assert.equal(args[args.indexOf("--tools") + 1], "Read,Glob,Grep");
    assert.equal(args.includes("Write"), false);
    assert.equal(args.includes("Bash"), false);
    assert.equal(args[args.indexOf("--setting-sources") + 1], "");
    assert.equal(args[args.indexOf("--settings") + 1], path.join(paths.config, "settings.json"));
    assert.equal(JSON.parse(args[args.indexOf("--json-schema") + 1]!).$schema,"http://json-schema.org/draft-07/schema#");
    const schema=JSON.parse(args[args.indexOf("--json-schema")+1]!);
    assert.deepEqual(schema.properties.claims.items.properties.evidenceRefs.items.enum,["ev-real"]);
    assert.deepEqual(schema.properties.claims.items.properties.stepRefs.items.enum,["s1"]);
    assert.deepEqual(schema.properties.questions.items.properties.gapRefs.items.enum,["g1"]);
  } finally { if (old === undefined) delete process.env.SKILL_RECORDER_PROCESSING_DIR; else process.env.SKILL_RECORDER_PROCESSING_DIR = old; }
});

test("MCP evidence is registered only for real successful tool results, never fabricated or failed calls",async()=>{
  const result=await mcpEvidenceFromEvents([
    {type:"assistant",message:{content:[{type:"tool_use",id:"call-1",name:"mcp__recorder-mail__mail_search"},{type:"tool_use",id:"call-2",name:"mcp__recorder-mail__mail_read"}]}},
    {type:"user",message:{content:[{type:"tool_result",tool_use_id:"call-1",content:"Invoice found"},{type:"tool_result",tool_use_id:"call-2",is_error:true,content:"failed"},{type:"tool_result",tool_use_id:"invented",content:"invented"}]}},
  ]);
  assert.equal(result.evidence.length,1);
  assert.equal(result.evidence[0]!.sourceType,"mcp");
  assert.equal(result.evidence[0]!.resourceAt,null,"a current query is not historical proof");
  assert.equal(result.aliases.get("mcp:call-1"),result.evidence[0]!.id);
  assert.equal(result.aliases.has("mcp:call-2"),false);
  assert.equal(result.aliases.has("mcp:invented"),false);
});

test("native session arguments carry the selected MCP servers and tool allowlist", () => {
  const old = process.env.SKILL_RECORDER_PROCESSING_DIR;
  process.env.SKILL_RECORDER_PROCESSING_DIR = mkdtempSync(path.join(tmpdir(), "task-mcp-args-"));
  try {
    const args = nativeSessionArgs({
      paths: taskSessionPaths(randomUUID()), sessionId: randomUUID(), resume: false,
      mcpConfig: { mcpServers: { crm: { command: "crm-mcp", args: [] } } },
      mcpToolNames: ["mcp__crm__lookup"],
      mcpDeniedToolNames: ["mcp__crm__update"],
    });
    assert.deepEqual(JSON.parse(args[args.indexOf("--mcp-config") + 1]!), { mcpServers: { crm: { command: "crm-mcp", args: [] } } });
    assert.match(args[args.indexOf("--allowedTools") + 1]!, /mcp__crm__lookup/);
    assert.equal(args[args.indexOf("--disallowedTools") + 1], "mcp__crm__update");
  } finally { if (old === undefined) delete process.env.SKILL_RECORDER_PROCESSING_DIR; else process.env.SKILL_RECORDER_PROCESSING_DIR = old; }
});

test("task environment is an allowlist and excludes unrelated host secrets", () => {
  const env = claudeTaskEnvironment({ PATH: "/bin", HOME: "/user", CLAUDE_CONFIG_DIR: "/auth", CLAUDE_CODE_OAUTH_TOKEN: "oauth", ANTHROPIC_API_KEY: "model-key", UNRELATED_TOKEN: "secret" });
  assert.equal(env.PATH, "/bin");
  assert.equal(env.ANTHROPIC_API_KEY, "model-key");
  assert.equal(env.UNRELATED_TOKEN, undefined);
  assert.equal(env.HOME, "/user");
  assert.equal(env.CLAUDE_CONFIG_DIR, "/auth");
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, "oauth");
});

test("global connection settings reuse provider authentication without importing hooks, permissions or unrelated credentials",()=>{
  const root=mkdtempSync(path.join(tmpdir(),"claude-connection-"));
  writeFileSync(path.join(root,"settings.json"),JSON.stringify({env:{ANTHROPIC_AUTH_TOKEN:"gateway-token",ANTHROPIC_BASE_URL:"https://provider.example",UNRELATED_TOKEN:"private"},model:"provider-model",hooks:{SessionStart:["never-run"]},permissions:{allow:["Bash"]}}));
  const connection=claudeConnectionSettings({CLAUDE_CONFIG_DIR:root});
  assert.equal(connection.model,"provider-model");
  const env=claudeTaskEnvironment({CLAUDE_CONFIG_DIR:root,ANTHROPIC_BASE_URL:"https://override.example"},connection);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN,"gateway-token");
  assert.equal(env.ANTHROPIC_BASE_URL,"https://override.example");
  assert.equal(env.UNRELATED_TOKEN,undefined);
  assert.equal((connection as Record<string,unknown>).hooks,undefined);
});

test("native session seeds indexed materials, commits outputs, and resumes only the bound session", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "task-session-"));
  const sessions = path.join(root, "sessions"), processing = path.join(root, "processing");
  const oldSessions = process.env.SKILL_RECORDER_SESSIONS_DIR, oldProcessing = process.env.SKILL_RECORDER_PROCESSING_DIR;
  process.env.SKILL_RECORDER_SESSIONS_DIR = sessions;
  process.env.SKILL_RECORDER_PROCESSING_DIR = processing;
  const recordingId = "recording-one", recording = path.join(sessions, recordingId);
  mkdirSync(path.join(recording, "frames"), { recursive: true });
  writeFileSync(path.join(recording, "session.json"), JSON.stringify({ startedAt: 1 }));
  writeFileSync(path.join(recording, "analysis.json"), JSON.stringify({ intent: "报价" }));
  writeFileSync(path.join(recording, "frames", "frames.json"), "[]");
  const executable = path.join(root, "fake-claude");
  writeFileSync(executable, `#!/usr/bin/env node
if(process.argv.includes('auth')) { console.log(JSON.stringify({loggedIn:true})); process.exit(0); }
const settings=process.argv[process.argv.indexOf('--settings')+1];
if(!require('node:fs').existsSync(settings))process.exit(1);
const idFlag = process.argv.indexOf('--session-id'); const resumeFlag = process.argv.indexOf('--resume');
const sessionId = process.argv[idFlag >= 0 ? idFlag + 1 : resumeFlag + 1];
console.log(JSON.stringify({type:'system',subtype:'init',session_id:sessionId}));
console.log(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',name:'report_progress',input:{phase:'reading',status:'running',title:'正在核对',detail:'读取材料'}}]}}));
console.log(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',id:'lookup-1',name:'mcp__demo__lookup',input:{account:'redacted'}}]}}));
console.log(JSON.stringify({type:'result',session_id:sessionId,is_error:false,structured_output:{claims:[],remainingGapRefs:[],summary:'完成',questions:[]}}));
`);
  chmodSync(executable, 0o700);
  const workspace: AgentWorkspace = {
    id: randomUUID(), name: "test", agentKind: "claude-code", executable,
    projectDirectory: root, createdAt: 1, updatedAt: 1, agentVersion: "test",
    status: "ready", lastInspectedAt: 1, lastError: null, capabilitySnapshotId: null,
    trustedAt: 1, managed: false,
  };
  const pkg: TaskPackage = {
    schemaVersion: 1, preparationId: randomUUID(), revision: 1, sessionId: recordingId,
    inputRevision: "input", backend: "local-agent", workspaceId: workspace.id,
    capabilitySnapshotId: null, status: "frozen", gaps: [], questions: [], answers: [],
    userNotes: "准备报价", materials: [], scope: null, preparedAt: 1, confirmedAt: 1,
  };
  const runId = randomUUID(), signal = new AbortController().signal;
  const progress: string[] = [], external: string[] = [];
  try {
    const first = await runClaudeTaskSession({ runId, attempt: 1, package: pkg, evidence: [], workspace, signal, timeoutMs: 5000, continueRun: false,
      onProgress: (event) => progress.push(event.title), onExternalCall: (name) => external.push(name) });
    assert.equal(first.summary, "完成");
    assert.ok(progress.includes("正在核对"));
    assert.deepEqual(external, ["mcp__demo__lookup"]);
    const paths = taskSessionPaths(runId);
    assert.ok(readFileSync(path.join(paths.inputs, "materials-index.md"), "utf8").includes("recording/analysis.json"));
    if (process.platform !== "win32") assert.equal(statSync(path.join(paths.inputs, "materials-index.md")).mode & 0o777, 0o400);
    assert.ok(existsSync(path.join(paths.outputs, "result.json")));
    const binding = JSON.parse(readFileSync(path.join(paths.session, "session-id.json"), "utf8"));
    assert.notEqual(binding.configDir, paths.config, "global authentication is separate from task policy");
    const settings=JSON.parse(readFileSync(path.join(paths.config,"settings.json"),"utf8"));
    assert.ok(Object.keys(settings).every(key=>key==="model"));
    unlinkSync(path.join(paths.config,"settings.json"));
    await runClaudeTaskSession({ runId, attempt: 2, package: pkg, evidence: [], workspace, signal, timeoutMs: 5000, continueRun: true });
    assert.ok(existsSync(path.join(paths.config,"settings.json")),"retry upgrades legacy task configuration");
    assert.equal(JSON.parse(readFileSync(path.join(paths.session, "session-id.json"), "utf8")).sessionId, binding.sessionId);
    writeFileSync(executable, "#!/usr/bin/env node\nconsole.log(JSON.stringify({loggedIn:false}));process.exit(1);\n");
    await assert.rejects(runClaudeTaskSession({runId:randomUUID(),attempt:1,package:pkg,evidence:[],workspace,signal,timeoutMs:5000,continueRun:false}),/认证不可用/);
  } finally {
    if (oldSessions === undefined) delete process.env.SKILL_RECORDER_SESSIONS_DIR; else process.env.SKILL_RECORDER_SESSIONS_DIR = oldSessions;
    if (oldProcessing === undefined) delete process.env.SKILL_RECORDER_PROCESSING_DIR; else process.env.SKILL_RECORDER_PROCESSING_DIR = oldProcessing;
  }
});
