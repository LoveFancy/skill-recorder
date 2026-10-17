import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  associateWorkspace,
  inspectCapabilities,
  capabilitySnapshot,
} from "./service";
import { refreshCapabilities } from "./mcp";
import { readProcessingSettings, processingDirectory } from "./settings";
import { localRequest } from "./local-request";

function setup(t: { after: (fn: () => void) => void }) {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "capability-test-")),
  );
  const old = process.env.SKILL_RECORDER_PROCESSING_DIR;
  process.env.SKILL_RECORDER_PROCESSING_DIR = path.join(root, "settings");
  t.after(() => {
    if (old === undefined) delete process.env.SKILL_RECORDER_PROCESSING_DIR;
    else process.env.SKILL_RECORDER_PROCESSING_DIR = old;
    rmSync(root, { recursive: true, force: true });
  });
  const exe = path.join(root, "fake-claude");
  writeFileSync(
    exe,
    `#!/usr/bin/env node
const args=process.argv.slice(2);
if(args.includes('--version'))console.log('2.1.251 test');
else if(args.includes('--help'))console.log('--json-schema --tools --strict-mcp-config --input-format --safe-mode');
else if(args.includes('auth'))console.log('{"loggedIn":true}');
else{let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{require('node:fs').writeFileSync(${JSON.stringify(path.join(root, "request.json"))},JSON.stringify({args,input}));console.log(JSON.stringify({type:'result',structured_output:{content:'ok',toolCalls:[]}}));});}
`,
    { mode: 0o700 },
  );
  return { root, exe };
}
test("trust is explicit; config-only discovery never launches MCP, active refresh reports real tools and stale source edits", async (t) => {
  const { root, exe } = setup(t),
    project = path.join(root, "project"),
    sentinel = path.join(root, "mcp-started");
  mkdirSync(project);
  mkdirSync(path.join(project, ".claude", "skills", "summarize"), {
    recursive: true,
  });
  writeFileSync(
    path.join(project, ".claude", "skills", "summarize", "SKILL.md"),
    "---\nname: summarize\ndescription: Summarize files\n---\nRead a file.",
  );
  const server = path.join(root, "server.cjs");
  writeFileSync(
    server,
    `require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'started');let buffer='';process.stdin.on('data',c=>{buffer+=c;let i;while((i=buffer.indexOf('\\n'))>=0){const r=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);if(r.id===1)console.log(JSON.stringify({jsonrpc:'2.0',id:1,result:{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'test',version:'1'}}}));if(r.id===2)console.log(JSON.stringify({jsonrpc:'2.0',id:2,result:{tools:[{name:'search_mail',description:'Read mail',inputSchema:{type:'object'}}]}}));}});`,
  );
  const config = path.join(project, ".mcp.json");
  writeFileSync(
    config,
    JSON.stringify({
      mcpServers: {
        test: {
          command: process.execPath,
          args: [server],
          env: { SECRET_TOKEN: "never-export-this" },
        },
      },
    }),
  );
  await assert.rejects(
    associateWorkspace({
      directory: project,
      name: "Test",
      trust: false,
      executable: exe,
    }),
    /信任/,
  );
  assert.equal(readProcessingSettings().workspaces.length, 0);
  const w = await associateWorkspace({
    directory: project,
    name: "Test",
    trust: true,
    executable: exe,
  });
  assert.equal(readProcessingSettings().defaultProcessingWorkspaceId, w.id);
  const inspected = await inspectCapabilities(w.id);
  assert.equal(existsSync(sentinel), false);
  assert.equal(
    inspected.servers.find((s) => s.name === "test")?.status,
    "configured",
  );
  assert.equal(
    inspected.skills.find((s) => s.name === "summarize")?.status,
    "discovered",
  );
  assert.equal(JSON.stringify(inspected).includes("never-export-this"), false);
  // Test only our fixture server, never the developer's actual configured servers.
  inspected.servers = inspected.servers.filter((s) => s.source === config);
  inspected.tools = [];
  writeFileSync(
    path.join(
      processingDirectory(),
      "snapshots",
      inspected.snapshotId + ".json",
    ),
    JSON.stringify(inspected),
  );
  const active = await refreshCapabilities(w.id);
  assert.equal(existsSync(sentinel), true);
  assert.equal(active.servers[0]?.status, "connected");
  assert.equal(active.tools[0]?.access, "unknown");
  assert.equal(active.tools[0]?.accessVerifiedBy, null);
  assert.notEqual(active.snapshotId, inspected.snapshotId);
  assert.equal(capabilitySnapshot(w.id)?.stale, false);
  writeFileSync(config, JSON.stringify({ mcpServers: {} }));
  assert.equal(capabilitySnapshot(w.id)?.stale, true);
});
test("local adapter disables native tools and MCP and preserves attached images through the actual subprocess protocol", async (t) => {
  const { root, exe } = setup(t);
  const request = localRequest({
    executable: exe,
    projectDirectory: root,
  } as Parameters<typeof localRequest>[0]);
  const r = await request("http://local", {
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,aGVsbG8=" },
            },
          ],
        },
      ],
      tools: [],
    }),
  });
  assert.equal(r.ok, true);
  const recorded = JSON.parse(
    readFileSync(path.join(root, "request.json"), "utf8"),
  );
  assert.ok(recorded.args.includes("--safe-mode"));
  assert.equal(recorded.args[recorded.args.indexOf("--tools") + 1], "");
  assert.ok(recorded.args.includes("--strict-mcp-config"));
  assert.deepEqual(
    JSON.parse(recorded.args[recorded.args.indexOf("--mcp-config") + 1])
      .mcpServers,
    {},
  );
  assert.match(recorded.input, /aGVsbG8=/);
  await assert.rejects(
    request("http://local", {
      body: JSON.stringify({
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "https://unapproved/image" },
              },
            ],
          },
        ],
      }),
    }),
    /图片格式/,
  );
});
