import assert from "node:assert/strict";
import test from "node:test";
import { DocumentActionSchema, DocumentRequestSchema, OUTPUT_TEMPLATES, OUTPUT_TEMPLATE_OPTIONS, outputTemplate, outputRules } from "./output";
import { documentInstructions } from "../electron/documentbuilder/instructions";

test("template selections are scoped to each output and change document instructions", () => {
  for (const kind of ["sop","skill","manual"] as const) {
    assert.equal(outputTemplate(kind).id,OUTPUT_TEMPLATES[kind].id);
    assert.ok(OUTPUT_TEMPLATE_OPTIONS[kind].length >= 2);
  }
  assert.equal(DocumentRequestSchema.safeParse({kind:"sop",templateId:"manual-quickstart"}).success,false);
  assert.throws(()=>outputTemplate("skill","sop-checklist"),/模板/);
  assert.match(documentInstructions("sop",false,"sop-checklist"),/操作检查清单/);
  assert.match(documentInstructions("manual",true,"manual-quickstart"),/快速入门手册/);
  assert.equal(DocumentRequestSchema.parse({kind:"sop",templateId:"sop-checklist"}).templateId,"sop-checklist");
});

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
