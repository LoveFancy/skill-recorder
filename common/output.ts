import { z } from "zod";

export const OutputKindSchema = z.enum(["sop", "skill", "manual"]);
export type OutputKind = z.infer<typeof OutputKindSchema>;
export type DocumentKind = Exclude<OutputKind, "skill">;
export const RECORDING_ANALYSIS_RULES = "本阶段只分析录制：还原用户意图、实际系统与入口、操作顺序、必要操作细节、业务规则和结果，评估截图有效性，澄清影响复现的必要歧义。不预设最终产物，不进行工具翻译或技能泛化，不追加文档读者、完整手册或自动化配置要求；产物类型在生成阶段选择。";

export const OUTPUT_TEMPLATES = {
  sop: { id: "sop-standard", version: 1, label: "标准操作说明", sections: ["目的与范围", "前置条件", "操作步骤", "异常与处理", "完成检查"] },
  skill: { id: "skill-standard", version: 1, label: "标准技能", sections: ["输入与配置", "环境依赖", "执行流程", "失败处理", "授权与成功标准"] },
  manual: { id: "manual-feature", version: 1, label: "功能使用手册", sections: ["目标与覆盖范围", "访问与前置条件", "功能说明", "常见问题与限制", "待补充内容"] },
} as const;

export function outputRules(kind: OutputKind | "undecided"): string {
  if (kind === "sop") return "本次产物为 SOP：忠实还原实际系统、入口、操作顺序和结果；不转换为 MCP/API/替代 CLI，不提出技能泛化计划。只澄清影响操作者复现的必要操作歧义，不追加自动化配置问题。";
  if (kind === "manual") return "本次产物为使用手册：按功能整理实际操作，只覆盖录制和确认材料支持的功能；不转换为 MCP/API/替代 CLI。只澄清读者、覆盖范围和必要操作歧义，不补造字段含义、权限或产品功能。";
  if (kind === "skill") return "本次产物为 Skill：先还原事实，生成阶段才将业务流程映射为目标环境可用且语义等价的工具。只澄清必要的业务规则与泛化输入，不把一次成功当成固定规则。";
  return "产物类型暂未确定：只还原事实与必要业务歧义，不预设为 Skill，不进行工具翻译，不添加自动化或完整手册要求。";
}

const Text = z.string().max(30000);
const Refs = z.array(z.string().max(150)).max(100).default([]);
export const OutlineItemSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  title: z.string().min(1).max(300),
  scope: Text,
  coverage: z.enum(["covered", "partial", "planned"]),
  evidenceRefs: Refs,
});
export const DocumentOutlineSchema = z.array(OutlineItemSchema).min(1).max(60);
export type DocumentOutline = z.infer<typeof DocumentOutlineSchema>;
export const DocumentContentSchema = z.object({
  title: z.string().min(1).max(300),
  purpose: Text,
  prerequisites: z.array(Text).max(50),
  sections: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    title: z.string().min(1).max(300),
    description: Text,
    evidenceRefs: Refs,
    steps: z.array(z.object({
      title: z.string().min(1).max(300),
      location: Text,
      action: Text,
      expectedResult: Text,
      resultStatus: z.enum(["observed", "confirmed", "unknown"]),
      evidenceRefs: Refs,
      assetIds: Refs,
    })).max(150),
  })).max(60),
  exceptions: z.array(Text).max(50),
  completion: z.array(Text).max(50),
  gaps: z.array(Text).max(100),
});
export type DocumentContent = z.infer<typeof DocumentContentSchema>;
export const DocumentRequestSchema = z.object({
  kind: z.enum(["sop", "manual"]),
  audience: z.string().max(500).default("业务操作者"),
  scope: z.string().max(3000).default("本次录制及已确认材料覆盖的任务与功能"),
  notes: z.string().max(3000).optional(),
});
export type DocumentRequest = z.infer<typeof DocumentRequestSchema>;
export const DocumentArtifactSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  sessionId: z.string(),
  revision: z.number().int().positive(),
  request: DocumentRequestSchema,
  templateId: z.string(),
  templateVersion: z.number().int(),
  sourceFingerprint: z.string(),
  sourceRevision: z.number().int(),
  evidenceIds: z.array(z.string()),
  assets: z.array(z.object({ id: z.string(), name: z.string(), hash: z.string() })),
  outline: DocumentOutlineSchema.nullable(),
  content: DocumentContentSchema.nullable(),
  status: z.enum(["draft", "reviewed"]),
  createdAt: z.number(),
  reviewedAt: z.number().nullable(),
  exports: z.array(z.object({ revision: z.number(), path: z.string(), at: z.number() })),
});
export type DocumentArtifact = z.infer<typeof DocumentArtifactSchema>;
export interface DocumentView { artifact: DocumentArtifact; stale: boolean; markdown: string }
export type DocumentAction =
  | { kind: "list"; sessionId: string }
  | { kind: "asset"; sessionId: string; artifactId: string; assetId: string }
  | { kind: "generate"; sessionId: string; request: DocumentRequest; artifactId?: string }
  | { kind: "outline"; sessionId: string; artifactId: string; revision: number; outline: DocumentOutline }
  | { kind: "edit"; sessionId: string; artifactId: string; revision: number; content: DocumentContent; reviewed: boolean }
  | { kind: "export"; sessionId: string; artifactId: string; revision: number; draft: boolean }
  | { kind: "cancel"; sessionId: string };
export interface DocumentResponse { ok: boolean; documents?: DocumentView[]; document?: DocumentView; error?: string; canceled?: boolean; path?: string; assetDataUrl?: string }

const Identity = { sessionId: z.string().min(1).max(128), artifactId: z.string().uuid(), revision: z.number().int().positive() };
export const DocumentActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list"), sessionId: Identity.sessionId }),
  z.object({ kind: z.literal("asset"), sessionId: Identity.sessionId, artifactId: Identity.artifactId, assetId: z.string().max(150) }),
  z.object({ kind: z.literal("generate"), sessionId: Identity.sessionId, request: DocumentRequestSchema, artifactId: Identity.artifactId.optional() }),
  z.object({ kind: z.literal("outline"), ...Identity, outline: DocumentOutlineSchema }),
  z.object({ kind: z.literal("edit"), ...Identity, content: DocumentContentSchema, reviewed: z.boolean() }),
  z.object({ kind: z.literal("export"), ...Identity, draft: z.boolean() }),
  z.object({ kind: z.literal("cancel"), sessionId: Identity.sessionId }),
]);

/** Keep unknown evidence and unapproved manual chapters out of the rendered artifact. */
export function validateDocument(artifact: DocumentArtifact): void {
  const refs = new Set(artifact.evidenceIds);
  const check = (ids: string[]) => { if (ids.some(id => !refs.has(id))) throw new Error("文档引用了未知证据。"); };
  const outline = artifact.outline ?? [];
  if (new Set(outline.map(s => s.id)).size !== outline.length) throw new Error("目录 ID 重复。");
  for (const item of outline) {
    check(item.evidenceRefs);
    if (item.coverage !== "planned" && !item.evidenceRefs.length) throw new Error("已覆盖目录必须引用证据。");
  }
  if (!artifact.content) return;
  if (new Set(artifact.content.sections.map(s => s.id)).size !== artifact.content.sections.length) throw new Error("章节 ID 重复。");
  for (const section of artifact.content.sections) {
    check(section.evidenceRefs);
    if (artifact.request.kind === "manual") {
      const approved = outline.find(s => s.id === section.id);
      if (!approved || approved.coverage === "planned") throw new Error("手册正文超出已批准的覆盖目录。");
    }
    if (!section.evidenceRefs.length) throw new Error("操作章节必须引用来源证据。");
    for (const step of section.steps) {
      check(step.evidenceRefs);
      if (!step.evidenceRefs.length) throw new Error("操作步骤必须引用来源证据。");
      if (step.assetIds.some(id => !artifact.assets.some(a => a.id === id))) throw new Error("未知截图资源。");
      if (step.resultStatus !== "unknown" && !step.expectedResult.trim()) throw new Error("确定结果必须填写说明。");
    }
  }
  if (!artifact.content.sections.length) throw new Error("文档至少需要一个有来源的章节。");
}

// Escape user/model text. The preview uses plain text; exports cannot inject HTML/images/links.
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/([\\`*_[\]#!|])/g, "\\$1").replace(/\r?\n/g, "  \n");
export function renderDocument(a: DocumentArtifact): string {
  const c = a.content;
  if (!c) return "";
  const out = [`# ${escape(c.title)}`, "", `类型：${a.request.kind === "sop" ? "SOP 操作说明" : "使用手册"} · 修订 ${a.revision}`, "", `适用读者：${escape(a.request.audience)}`, `覆盖范围：${escape(a.request.scope)}`, "产品版本：未核验", ""];
  if (a.status === "draft") out.push("> 待审核草稿", "");
  out.push("## 目的与范围", escape(c.purpose), "", "## 前置条件", ...c.prerequisites.map(s => `- ${escape(s)}`), "");
  for (const section of c.sections) {
    const scope = a.outline?.find(i => i.id === section.id);
    out.push(`## ${escape(section.title)}${scope?.coverage === "partial" ? "（部分覆盖）" : ""}`, escape(section.description), "");
    section.steps.forEach((step, i) => {
      out.push(`### ${i + 1}. ${escape(step.title)}`, `入口：${escape(step.location)}`, "", escape(step.action), "", `结果（${{observed:"录制可见",confirmed:"人工确认",unknown:"待确认"}[step.resultStatus]}）：${escape(step.expectedResult || "录制未证实")}`, `来源：${step.evidenceRefs.map(escape).join("、")}`, "");
      for (const id of step.assetIds) out.push(`![操作截图](assets/${a.assets.find(x => x.id === id)!.name})`, "");
    });
    out.push(`章节来源：${section.evidenceRefs.map(escape).join("、")}`, "");
  }
  for (const [title, values] of [["异常与处理", c.exceptions], ["完成检查", c.completion], ["待补充与限制", [...c.gaps, ...(a.outline ?? []).filter(i => i.coverage !== "covered").map(i => `${i.title}：${i.coverage === "planned" ? "待补充" : "部分覆盖"}；${i.scope}`)]]] as const) {
    if (values.length) out.push(`## ${title}`, ...values.map(s => `- ${escape(s)}`), "");
  }
  out.push("## 来源与版本", `录制：${escape(a.sessionId)}；分析修订：${a.sourceRevision}；模板：${a.templateId}@${a.templateVersion}`, `生成时间：${new Date(a.createdAt).toISOString()}`, "");
  return out.join("\n");
}
