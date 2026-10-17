import { z } from "zod";
import { RequestedScopeSchema } from "./agents";

const Id = z.string().min(1).max(160);
const Text = z.string().max(24000);
export const RunStatus = z.enum([
  "queued",
  "running",
  "awaiting-input",
  "paused",
  "completed",
  "failed",
  "canceled",
  "interrupted",
]);
export const PreparationStatus = z.enum([
  "draft",
  "identifying",
  "awaiting-answers",
  "ready",
  "frozen",
  "stale",
]);
export const AnswerStatus = z.enum([
  "draft",
  "confirmed",
  "skipped",
  "unknown",
]);
export const TemporalScope = z.enum(["at-recording", "current", "invariant"]);
export const FactKind = z.enum([
  "observed",
  "queried",
  "user-confirmed",
  "inferred",
  "unknown",
]);
export const GapSchema = z.object({
  id: Id,
  stepRefs: z.array(Id),
  question: Text,
  reason: Text.default(""),
  strategy: z.enum(["agent-query", "user-question", "unresolved"]),
  critical: z.boolean(),
  resolved: z.boolean().default(false),
  /** Capability refs suggested during the lightweight scope pass. */
  suggestedToolRefs: z.array(z.string()).optional(),
});
export const QuestionKind = z.enum(["business-goal", "business-rule", "business-exception", "business-output", "recording-interpretation", "agent-configuration", "missing-evidence"]);
export const QuestionSchema = z.object({
  kind: QuestionKind.optional(),
  id: Id,
  gapRefs: z.array(Id),
  text: Text,
  reason: Text,
  critical: z.boolean(),
  options: z.array(Text).default([]),
});
export const AnswerSchema = z.object({
  questionId: Id,
  text: Text,
  status: AnswerStatus,
  appliesTo: Text.default(""),
  updatedAt: z.number(),
  confirmedAt: z.number().nullable(),
});
export const MaterialSchema = z.object({
  id: Id,
  name: z.string(),
  hash: z.string(),
  text: Text,
  createdAt: z.number(),
});
export const TaskPackageSchema = z
  .object({
    schemaVersion: z.literal(1),
    preparationId: z.string().uuid(),
    revision: z.number().int().positive(),
    sessionId: Id,
    inputRevision: z.string(),
    backend: z.enum(["local-agent", "api"]),
    workspaceId: z.string().uuid().nullable(),
    capabilitySnapshotId: z.string().uuid().nullable(),
    clarificationPolicyVersion: z.literal(2).optional(),
    outputKind: z.enum(["sop", "skill", "manual", "undecided"]).optional(),
    managedConfigRevision: z.string().uuid().nullable().optional(),
    capabilitySelectionHash: z.string().nullable().optional(),
    status: PreparationStatus,
    gaps: z.array(GapSchema).max(100),
    questions: z.array(QuestionSchema).max(100),
    answers: z.array(AnswerSchema).max(100),
    userNotes: Text,
    materials: z.array(MaterialSchema).max(20),
    scope: RequestedScopeSchema.nullable(),
    preparedAt: z.number(),
    confirmedAt: z.number().nullable(),
  })
  .superRefine((p, c) => {
    const gaps = new Set(p.gaps.map((g) => g.id)),
      questions = new Set(p.questions.map((q) => q.id));
    if (
      gaps.size !== p.gaps.length ||
      questions.size !== p.questions.length ||
      new Set(p.answers.map((a) => a.questionId)).size !== p.answers.length
    )
      c.addIssue({
        code: "custom",
        message: "Duplicate gap, question or answer",
      });
    for (const q of p.questions)
      if (q.gapRefs.some((r) => !gaps.has(r)))
        c.addIssue({ code: "custom", message: "Unknown gap reference" });
    for (const a of p.answers) {
      if (!questions.has(a.questionId))
        c.addIssue({ code: "custom", message: "Unknown question reference" });
      if (
        a.status === "confirmed" &&
        (!a.text.trim() || a.confirmedAt === null)
      )
        c.addIssue({
          code: "custom",
          message: "Answer requires explicit confirmation",
        });
    }
    if (p.scope && p.scope.workspaceId !== p.workspaceId)
      c.addIssue({ code: "custom", message: "Scope workspace mismatch" });
    if (p.backend === "api" && (p.workspaceId || p.scope))
      c.addIssue({
        code: "custom",
        message: "API cannot inherit project scope",
      });
    if (p.status === "frozen" && p.confirmedAt === null)
      c.addIssue({
        code: "custom",
        message: "Package requires user confirmation",
      });
  });
export type TaskPackage = z.infer<typeof TaskPackageSchema>;
export type Gap = z.infer<typeof GapSchema>;
export type Answer = z.infer<typeof AnswerSchema>;
export const EvidenceSchema = z.object({
  id: Id,
  sourceType: z.enum(["recording", "user", "mcp", "material"]),
  sourceRef: Id,
  summary: Text,
  contentHash: z.string(),
  recordedAt: z.number().nullable(),
  queriedAt: z.number().nullable(),
  resourceAt: z.number().nullable(),
  privacy: z.literal("redacted"),
});
export type Evidence = z.infer<typeof EvidenceSchema>;
export const ClaimSchema = z.object({
  id: Id,
  stepRefs: z.array(Id),
  text: Text,
  kind: FactKind,
  evidenceRefs: z.array(Id),
  temporalScope: TemporalScope,
  appliesTo: Text,
  reason: Text.default(""),
  review: z.enum(["pending", "accepted", "rejected"]).default("pending"),
});
export type Claim = z.infer<typeof ClaimSchema>;
export const ScreenshotReviewSchema = z.object({
  file: z.string().regex(/^frames\/[A-Za-z0-9_.-]+\.(jpg|jpeg|png)$/),
  decision: z.enum(["keep", "discard"]),
});
export const EnhancementResultSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.string().uuid(),
  inputRevision: z.string(),
  taskPackageRevision: z.number().int().positive(),
  claims: z.array(ClaimSchema).max(200),
  remainingGapRefs: z.array(Id).max(100),
  summary: Text,
  screenshotReviews: z.array(ScreenshotReviewSchema).max(100).optional(),
});
export type EnhancementResult = z.infer<typeof EnhancementResultSchema>;
export const BudgetSchema = z.object({
  maxExternalCalls: z.number().int().min(0).max(200),
  activeMs: z.number().finite().min(1000).max(3600000),
});
export const RunSchema = z.object({
  runId: z.string().uuid(),
  sessionId: Id,
  inputRevision: z.string(),
  taskPackageRevision: z.number().int().positive(),
  status: RunStatus,
  attempt: z.number().int().nonnegative(),
  externalCalls: z.number().int().nonnegative(),
  activeMs: z.number().nonnegative(),
  budget: BudgetSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  error: z.string().nullable(),
  eventSequence: z.number().int().nonnegative(),
  attemptStartedAt: z.number().optional(),
  phase: z.enum(["queued", "materials", "capabilities", "reading", "finalizing"]).optional(),
});
export type EnhancementRun = z.infer<typeof RunSchema>;
export const EnhancementProgressEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  at: z.number(),
  phase: z.enum(["checking", "materials", "capabilities", "reading", "finalizing"]),
  status: z.enum(["running", "completed", "failed", "skipped"]),
  title: z.string().max(160),
  detail: z.string().max(1000).default(""),
  model: z.string().max(160).optional(),
});
export type EnhancementProgressEvent = z.infer<typeof EnhancementProgressEventSchema>;
export const WorkflowSchema = z.object({
  version: z.literal(1),
  sessionId: Id,
  package: TaskPackageSchema.nullable(),
  run: RunSchema.nullable(),
  evidence: z.array(EvidenceSchema),
  result: EnhancementResultSchema.nullable(),
  priorApprovedResult: EnhancementResultSchema.nullable().optional(),
  approvedAt: z.number().nullable(),
  progress: z.array(EnhancementProgressEventSchema).max(100).optional(),
  decision: z
    .object({
      inputRevision: z.string(),
      kind: z.enum(["enhance", "skip"]),
      at: z.number(),
    })
    .nullable(),
});
export type EnhancementWorkflow = z.infer<typeof WorkflowSchema>;
export const ModelQuestionSchema = QuestionSchema.extend({ kind: QuestionKind });
export const PreparationOutputSchema = z.object({
  gaps: z.array(GapSchema).max(100),
  // Legacy model fixtures may still return questions. They are deliberately
  // ignored until the deep-analysis pass finalizes the one user-facing list.
  questions: z.array(ModelQuestionSchema).max(100).default([]),
});
export const DeepAnalysisOutputSchema = z.object({
  claims: z.array(ClaimSchema).max(200),
  remainingGapRefs: z.array(Id).max(100),
  summary: Text,
  questions: z.array(ModelQuestionSchema).max(20).default([]),
  screenshotReviews: z.array(ScreenshotReviewSchema).max(100).optional(),
});
export type DeepAnalysisOutput = z.infer<typeof DeepAnalysisOutputSchema>;
export const EnhancementOutputSchema = z.object({
  claims: z.array(ClaimSchema).max(200),
  remainingGapRefs: z.array(Id).max(100),
  summary: Text,
  followupQuestions: z.array(ModelQuestionSchema).max(20).default([]),
});

/** Model output cannot confer approvals or elevate current facts to fixed rules. */
export function validateCandidate(
  result: EnhancementResult,
  p: TaskPackage,
  evidence: Evidence[],
): void {
  const ev = new Map(evidence.map((e) => [e.id, e]));
  if (
    result.inputRevision !== p.inputRevision ||
    result.taskPackageRevision !== p.revision
  )
    throw new Error("Result input revision mismatch");
  if (new Set(result.claims.map((c) => c.id)).size !== result.claims.length)
    throw new Error("Duplicate claim");
  if (result.remainingGapRefs.some((id) => !p.gaps.some((g) => g.id === id)))
    throw new Error("Unknown remaining gap");
  for (const gap of p.gaps.filter((g) => g.critical && !g.resolved)) {
    if (
      !result.remainingGapRefs.includes(gap.id) &&
      !result.claims.some(
        (c) =>
          ["observed", "queried", "user-confirmed"].includes(c.kind) &&
          c.evidenceRefs.length > 0 &&
          (gap.stepRefs.length === 0 ||
            c.stepRefs.some((ref) => gap.stepRefs.includes(ref))),
      )
    )
      throw new Error("Critical gap cannot disappear without evidence");
  }
  for (const claim of result.claims) {
    if (claim.review !== "pending")
      throw new Error("Agent cannot approve claims");
    if (claim.evidenceRefs.some((id) => !ev.has(id)))
      throw new Error("Unknown evidence reference");
    if (
      ["observed", "queried", "user-confirmed"].includes(claim.kind) &&
      !claim.evidenceRefs.length
    )
      throw new Error("Factual claim requires evidence");
    if (
      claim.temporalScope === "invariant" &&
      (!claim.appliesTo.trim() || ["inferred", "unknown"].includes(claim.kind))
    )
      throw new Error("Fixed rule requires verified source and scope");
    if (
      claim.kind === "user-confirmed" &&
      !claim.evidenceRefs.some((id) => ev.get(id)?.sourceType === "user")
    )
      throw new Error("User rule requires user evidence");
  }
}
export function generationGate(
  w: EnhancementWorkflow | null,
  inputRevision: string,
): { allowed: boolean; draft: boolean; reason: string | null; gaps: string[] } {
  if (!w?.decision || w.decision.inputRevision !== inputRevision)
    return {
      allowed: false,
      draft: true,
      reason: "请审核增强结果或明确跳过增强。",
      gaps: [],
    };
  if (w.run && ["queued", "running", "awaiting-input"].includes(w.run.status))
    return {
      allowed: false,
      draft: true,
      reason: "请先完成或取消增强任务。",
      gaps: [],
    };
  if (w.package && w.package.inputRevision !== inputRevision)
    return {
      allowed: false,
      draft: true,
      reason: "分析或回答已修改，请更新增强结果。",
      gaps: [],
    };
  if (w.package?.status === "stale")
    return {
      allowed: false,
      draft: true,
      reason: "回答已修改，请确认新版任务包并重新增强。",
      gaps: [],
    };
  if (w.decision.kind === "enhance" && !w.approvedAt)
    return {
      allowed: false,
      draft: true,
      reason: "增强候选尚未审核。",
      gaps: [],
    };
  const remaining = new Set(
    w.result?.remainingGapRefs ??
      w.package?.gaps
        .filter((g) => g.critical && !g.resolved)
        .map((g) => g.id) ??
      [],
  );
  const gaps =
    w.package?.gaps
      .filter((g) => g.critical && remaining.has(g.id))
      .map((g) => g.question) ?? [];
  return { allowed: true, draft: gaps.length > 0, reason: null, gaps };
}

export function businessClarifications<T extends z.infer<typeof QuestionSchema>>(questions: T[], gaps: Gap[]): T[] {
  const seen = new Set<string>();
  const kept = questions.filter(q => {
    const business = q.kind?.startsWith("business-");
    const technical = /红框.*(?:含义|意思)|标注.*(?:当作什么|真实点击|转译方式)|(?:本地\s*Agent|项目目录|目录关联|MCP.*开关|Skills?.*开关)/i.test(q.text);
    const key = q.text.replace(/[\s，。？?!！]/g, "");
    if (!business || technical || seen.has(key) || seen.size >= 8) return false;
    seen.add(key); return true;
  });
  for (const g of gaps) if (g.strategy === "user-question" && questions.some(q => q.gapRefs.includes(g.id)) && !kept.some(q => q.gapRefs.includes(g.id))) g.strategy = "unresolved";
  return kept;
}
