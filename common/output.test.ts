import assert from "node:assert/strict";
import test from "node:test";
import { DocumentActionSchema, DocumentRequestSchema, OUTPUT_TEMPLATES, outputRules } from "./output";

test("each output has its own versioned template and generation boundary", () => {
  assert.equal(new Set(Object.values(OUTPUT_TEMPLATES).map(t => t.id)).size, 3);
  assert.match(outputRules("sop"), /不转换为 MCP/);
  assert.match(outputRules("manual"), /不补造.*产品功能/);
  assert.match(outputRules("skill"), /语义等价/);
  assert.match(outputRules("undecided"), /不预设为 Skill/);
});
test("document requests cannot route through skill planning or arbitrary artifact paths", () => {
  assert.equal(DocumentRequestSchema.safeParse({ kind: "skill" }).success, false);
  assert.equal(DocumentActionSchema.safeParse({ kind: "edit", sessionId: "recording", artifactId: "../../private", revision: 1 }).success, false);
  assert.equal(DocumentActionSchema.safeParse({ kind: "export", sessionId: "recording", artifactId: "00000000-0000-4000-8000-000000000001", revision: 0, draft: false }).success, false);
});
