import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { WorkflowStore, SessionLocks, emptyWorkflow } from "./store";
test("checkpoint recovery ignores uncommitted and broken mutable views", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "skill-checkpoint-"));
  try {
    const store = new WorkflowStore((id) => path.join(root, id)),
      w = emptyWorkflow("one");
    store.save(w);
    writeFileSync(path.join(store.root("one"), "workflow.json"), "broken");
    assert.deepEqual(store.read("one"), w);
    assert.throws(() => store.read("../escape"), /Unknown/);
    w.run = {
      runId: "00000000-0000-4000-8000-000000000001",
      sessionId: "one",
      inputRevision: "hash",
      taskPackageRevision: 1,
      status: "running",
      attempt: 0,
      externalCalls: 4,
      activeMs: 1200,
      budget: { maxExternalCalls: 20, activeMs: 300000 },
      createdAt: 1,
      updatedAt: 1,
      error: null,
      eventSequence: 2,
    };
    store.save(w);
    const recovered = store.recover("one");
    assert.equal(recovered.run?.status, "interrupted");
    assert.equal(recovered.run?.externalCalls, 4);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("session exclusion covers pre-start cancellation without blocking other sessions", async () => {
  const locks = new SessionLocks();
  let release!: () => void;
  const wait = new Promise<void>((r) => (release = r));
  const pending = locks.withLock("one", "enhance", async (signal) => {
    await wait;
    signal.throwIfAborted();
  });
  await assert.rejects(
    locks.withLock("one", "generate", async () => {}),
    /还有处理/,
  );
  await locks.withLock("two", "enhance", async () => {});
  locks.cancel("one");
  let idle=false;const stopped=locks.waitForIdle("one").then(()=>{idle=true;});
  await Promise.resolve();assert.equal(idle,false);
  assert.equal(locks.busy("one"), true);
  release();
  await assert.rejects(pending, /取消/);
  await stopped;assert.equal(idle,true);
  assert.equal(locks.busy("one"), false);
});

test("frozen revisions cannot be overwritten and failed saves retain the previous committed pointer", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "immutable-package-"));
  try {
    const store = new WorkflowStore((id) => path.join(root, id)),
      w = emptyWorkflow("session");
    w.package = {
      schemaVersion: 1,
      preparationId: "00000000-0000-4000-8000-000000000002",
      revision: 1,
      sessionId: "session",
      inputRevision: "hash",
      backend: "api",
      workspaceId: null,
      capabilitySnapshotId: null,
      status: "frozen",
      gaps: [],
      questions: [],
      answers: [],
      userNotes: "original",
      materials: [],
      scope: null,
      preparedAt: 1,
      confirmedAt: 2,
    };
    store.save(w);
    w.package.userNotes = "silent mutation";
    assert.throws(() => store.save(w), /immutable/);
    assert.equal(store.read("session").package?.userNotes, "original");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
