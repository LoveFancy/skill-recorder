import assert from "node:assert/strict";
import test from "node:test";
import { SavedRecordingHandoff } from "./saved-recording-handoff";

test("save hands off once, ignoring later post-processing notifications", () => {
  const handoff = new SavedRecordingHandoff();
  assert.equal(handoff.consume({ state: "recording", transition: "stopping", lastFinish: null }, false), null);
  const finished = { state: "idle", transition: "none", lastFinish: { sessionId: "new", outcome: "saved" } } as const;
  assert.equal(handoff.consume(finished, false), "new");
  assert.equal(handoff.consume(finished, false), null);
  assert.equal(handoff.consume(finished, false), null);
});

test("discard, failed discard retaining files, shutdown and old saved state do not auto-analyze", () => {
  const saved = { state: "idle", transition: "none", lastFinish: { sessionId: "new", outcome: "saved" } } as const;
  const handoff = new SavedRecordingHandoff();
  assert.equal(handoff.consume(saved, false), null);
  handoff.consume({ state: "recording", transition: "discarding", lastFinish: null }, false);
  assert.equal(handoff.consume(saved, false), null);
  handoff.consume({ state: "recording", transition: "discarding", lastFinish: null }, false);
  assert.equal(handoff.consume({ ...saved, lastFinish: { sessionId: "new", outcome: "discarded" } }, false), null);
  handoff.consume({ state: "recording", transition: "stopping", lastFinish: null }, true);
  assert.equal(handoff.consume(saved, true), null);
});
