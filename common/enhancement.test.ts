import test from "node:test";
import assert from "node:assert/strict";
import {
  TaskPackageSchema,
  businessClarifications, PreparationOutputSchema,
  generationGate,
  validateCandidate,
} from "./enhancement";
const p = TaskPackageSchema.parse({
  schemaVersion: 1,
  preparationId: "00000000-0000-4000-8000-000000000001",
  revision: 1,
  sessionId: "session",
  inputRevision: "v1",
  backend: "api",
  workspaceId: null,
  capabilitySnapshotId: null,
  status: "draft",
  gaps: [
    {
      id: "g1",
      stepRefs: ["s1"],
      question: "范围？",
      strategy: "user-question",
      critical: true,
    },
  ],
  questions: [
    {
      id: "q1",
      gapRefs: ["g1"],
      text: "范围？",
      reason: "单次演示",
      critical: true,
    },
  ],
  answers: [],
  userNotes: "",
  materials: [],
  scope: null,
  preparedAt: 1,
  confirmedAt: null,
});
test("unanswered and preselected answers cannot become user confirmation", () => {
  assert.equal(
    TaskPackageSchema.safeParse({
      ...p,
      answers: [
        {
          questionId: "q1",
          text: "",
          status: "confirmed",
          appliesTo: "all",
          updatedAt: 1,
          confirmedAt: null,
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    TaskPackageSchema.safeParse({ ...p, status: "frozen" }).success,
    false,
  );
  assert.equal(
    TaskPackageSchema.safeParse({
      ...p,
      questions: [{ ...p.questions[0], gapRefs: ["invented"] }],
    }).success,
    false,
  );
});
test("historical answers require a known question and valid gap references", () => {
  const historical = {
    ...p, questions: [], questionHistory: p.questions,
    answers: [{questionId: "q1", text: "本次订单", status: "confirmed", appliesTo: "", updatedAt: 2, confirmedAt: 2}],
  };
  assert.equal(TaskPackageSchema.safeParse(historical).success, true);
  assert.equal(TaskPackageSchema.safeParse({...historical, questionHistory: []}).success, false);
  assert.equal(TaskPackageSchema.safeParse({...historical, questions: p.questions}).success, false);
  assert.equal(TaskPackageSchema.safeParse({...historical, questionHistory: [{...p.questions[0], gapRefs: ["fake"]}]}).success, false);
});
test("navigation does not approve; skip preserves critical gaps and stale inputs block generation", () => {
  const w = {
    version: 1 as const,
    sessionId: "session",
    package: p,
    run: null,
    evidence: [],
    result: null,
    approvedAt: null,
    decision: null,
  };
  assert.equal(generationGate(w, "v1").allowed, false);
  const skipped = {
    ...w,
    decision: { kind: "skip" as const, inputRevision: "v1", at: 2 },
  };
  assert.equal(generationGate(skipped, "v1").draft, true);
  assert.equal(generationGate(skipped, "v2").allowed, false);
  assert.equal(
    generationGate({ ...skipped, package: { ...p, status: "stale" } }, "v1")
      .allowed,
    false,
  );
});
test("model cannot approve evidence or claim a user rule without a confirmed source", () => {
  const result = {
    schemaVersion: 1 as const,
    runId: "00000000-0000-4000-8000-000000000002",
    inputRevision: "v1",
    taskPackageRevision: 1,
    claims: [
      {
        id: "c1",
        stepRefs: ["s1"],
        text: "规则",
        kind: "user-confirmed" as const,
        evidenceRefs: ["e1"],
        temporalScope: "invariant" as const,
        appliesTo: "指定订单",
        reason: "",
        review: "pending" as const,
      },
    ],
    remainingGapRefs: [],
    summary: "",
  };
  const ev = {
    id: "e1",
    sourceType: "mcp" as const,
    sourceRef: "mail",
    summary: "current mail",
    contentHash: "hash",
    recordedAt: null,
    queriedAt: 1,
    resourceAt: null,
    privacy: "redacted" as const,
  };
  assert.throws(() => validateCandidate(result, p, [ev]), /User rule/);
  assert.throws(
    () =>
      validateCandidate(
        { ...result, claims: [{ ...result.claims[0], review: "accepted" }] },
        p,
        [ev],
      ),
    /cannot approve/,
  );
  assert.throws(
    () =>
      validateCandidate(
        {
          ...result,
          claims: [{ ...result.claims[0], evidenceRefs: ["fake"] }],
        },
        p,
        [ev],
      ),
    /Unknown evidence/,
  );
  validateCandidate(result, p, [{ ...ev, sourceType: "user" }]);
});

test("clarification keeps business decisions, suppresses technical interpretation, and retains unresolved gaps", () => {
  const gaps = ["business", "annotation", "config", "missing"].map(id => ({ id, stepRefs: ["s1"], question: id, reason: "", strategy: "user-question" as const, critical: true, resolved: false }));
  const result = PreparationOutputSchema.parse({gaps, questions: [
    {id:"q1",kind:"business-rule",gapRefs:["business"],text:"退款订单是否排除？",reason:"影响汇总口径",critical:true},
    {id:"q2",kind:"recording-interpretation",gapRefs:["annotation"],text:"标注应被当作什么？",reason:"technical",critical:true},
    {id:"q3",kind:"business-rule",gapRefs:["config"],text:"本地 Agent 和项目目录怎么填？",reason:"misclassified",critical:false},
    {id:"q4",kind:"missing-evidence",gapRefs:["missing"],text:"截图里是什么？",reason:"missing visual",critical:false},
    {id:"q5",kind:"business-rule",gapRefs:["business"],text:"退款订单是否排除？",reason:"duplicate",critical:true},
  ]});
  assert.deepEqual(businessClarifications(result.questions, result.gaps).map(q=>q.id), ["q1"]);
  assert.equal(result.gaps[0].strategy,"user-question");
  assert.ok(result.gaps.slice(1).every(g=>g.strategy==="unresolved"), "technical evidence gaps are not silently resolved");
  assert.equal(PreparationOutputSchema.safeParse({gaps:[],questions:[{id:"missing-kind",gapRefs:[],text:"Question",reason:"",critical:true}]}).success,false);
});
