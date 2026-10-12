import assert from "node:assert/strict";
import test from "node:test";
import { AnalysisRecovery } from "./analysis-recovery";

test("duplicate starts are blocked until the current invocation finishes", () => {
  const guard = new AnalysisRecovery();
  const run = guard.beginRun(); assert.ok(run);
  assert.equal(guard.beginRun(), null);
  guard.finishRun(run); assert.ok(guard.beginRun());
});

test("cancel ignores results without releasing an active invocation prematurely", () => {
  const guard = new AnalysisRecovery();
  const run = guard.beginRun(); assert.ok(run);
  guard.cancelRun(); assert.equal(guard.accepts(run), false);
  assert.equal(guard.isCurrent(run), true); assert.equal(guard.beginRun(), null);
  guard.finishRun(run); assert.ok(guard.beginRun());
});

test("unmount and session switches invalidate stale completions", () => {
  const guard = new AnalysisRecovery();
  const previous = guard.beginRun(); assert.ok(previous);
  guard.invalidate();
  const current = guard.beginRun(); assert.ok(current);
  guard.finishRun(previous);
  assert.equal(guard.accepts(previous), false); assert.equal(guard.accepts(current), true);
});
