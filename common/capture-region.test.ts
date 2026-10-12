import test from "node:test";
import assert from "node:assert/strict";
import { isCaptureRegion } from "./capture-region";

test("capture rectangles reject invalid and out-of-display coordinates", () => {
  assert.equal(isCaptureRegion({ x:0,y:0,width:1,height:1 }), true);
  for (const r of [null, {}, { x:-1,y:0,width:1,height:1 }, { x:0,y:0,width:0,height:1 }, { x:0.8,y:0,width:0.3,height:1 }, { x:NaN,y:0,width:1,height:1 }]) assert.equal(isCaptureRegion(r), false);
});
