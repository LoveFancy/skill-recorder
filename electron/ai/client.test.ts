import assert from "node:assert/strict";
import test from "node:test";
import { AgentSession, type Tool } from "./client";

const settings = { baseUrl: "http://localhost:11434/v1", model: "vision-model", apiKey: "test-secret" };
const reply = (message: unknown, status = 200) => new Response(JSON.stringify({ choices: [{ message }] }), { status });
const call = (name: string, args = "{}", id = "call-1") => ({ role: "assistant", content: null,
  tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
});

test("tools, redacted images, feedback and terminal submission run without Copilot", async () => {
  const requests: { messages: any[]; tools: any[] }[] = [];
  let submits = 0;
  const tools: Tool[] = [
    { name: "get_frames", handler: () => ({ textResultForLlm: "redacted frame", resultType: "success",
      binaryResultsForLlm: [{ type: "image", mimeType: "image/jpeg", data: "REDACTED", description: "00:01" }] }) },
    { name: "submit_analysis", handler: () => { submits++; return "Analysis recorded."; } },
    { name: "forbidden", handler: () => assert.fail("must not execute") },
  ];
  const request = (async (url, init) => {
    assert.equal(url, "http://localhost:11434/v1/chat/completions");
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-secret");
    const body = JSON.parse(String(init?.body)); requests.push(body);
    return reply(requests.length === 1 ? call("get_frames") : call("submit_analysis"));
  }) as typeof fetch;
  const session = new AgentSession({ tools, availableTools: ["get_frames", "submit_analysis"], systemMessage: { mode: "append", content: "instructions" } }, settings, request);
  await session.sendAndWait("Analyze");
  assert.equal(submits, 1);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].tools.map((tool) => tool.function.name), ["get_frames", "submit_analysis"]);
  assert.equal(requests[1].messages[3].content, "redacted frame");
  assert.equal(requests[1].messages[4].content[2].image_url.url, "data:image/jpeg;base64,REDACTED");
  await session.sendAndWait("Correct the intent");
  assert.equal(submits, 2);
  assert.ok(requests[2].messages.some((message) => message.content === "Analyze"));
  await session.disconnect();
  await assert.rejects(session.sendAndWait("again"), /closed/);
});

test("malformed and unknown tool calls return errors to the model without executing arbitrary tools", async () => {
  let turn = 0; let calls = 0;
  const request = (async (_url, init) => {
    const messages = JSON.parse(String(init?.body)).messages;
    turn++;
    if (turn === 1) return reply(call("read", "bad json"));
    if (turn === 2) { assert.equal(messages.at(-1).role, "tool"); return reply(call("bash")); }
    assert.match(messages.at(-1).content, /not available/);
    return reply({ role: "assistant", content: "Done" });
  }) as typeof fetch;
  const session = new AgentSession({ tools: [{ name: "read", handler: () => calls++ }] }, settings, request);
  await session.sendAndWait("Analyze"); assert.equal(calls, 0);
});

test("failed structured submission is corrected before the turn completes", async () => {
  let count = 0;
  const session = new AgentSession({ tools: [{ name: "submit_skill", handler: () => ++count === 1
    ? { resultType: "failure", textResultForLlm: "Invalid skill" } : "Recorded" }] }, settings,
    (async () => reply(call("submit_skill"))) as typeof fetch);
  await session.sendAndWait("Build"); assert.equal(count, 2);
});

test("HTTP errors do not expose provider responses or keys, and failed turns are rolled back", async () => {
  let turn = 0;
  const session = new AgentSession({}, settings, (async (_url, init) => {
    if (++turn === 1) return new Response("test-secret private recording", { status: 401 });
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.messages, [{ role: "user", content: "Retry" }]);
    return reply({ role: "assistant", content: "Done" });
  }) as typeof fetch);
  await assert.rejects(session.sendAndWait("Failed"), (error: Error) => /HTTP 401/.test(error.message) && !error.message.includes("test-secret"));
  await session.sendAndWait("Retry");
});

test("local endpoints omit authorization and cancellation aborts a pending request", async () => {
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  const session = new AgentSession({}, { ...settings, apiKey: "" }, (async (_url, init) => {
    assert.equal((init?.headers as Record<string, string>).Authorization, undefined);
    started();
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
  }) as typeof fetch);
  const pending = session.sendAndWait("Analyze");
  await ready; await session.abort(); await assert.rejects(pending, /canceled/);
});

test("timeout aborts the request", async () => {
  const session = new AgentSession({}, settings, (async (_url, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  })) as typeof fetch);
  await assert.rejects(session.sendAndWait("Analyze", 10), /timed out/);
});
