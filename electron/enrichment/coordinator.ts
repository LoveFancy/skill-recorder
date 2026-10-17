import { RECORDING_ANALYSIS_RULES, type OutputKind } from "../../common/output";
import { CLARIFICATION_INSTRUCTIONS, RECORDING_SEMANTICS } from "../../common/clarification";
import { recordingMaterials } from "./materials";
import type { FrameRedactor } from "../sensitive/frame-redact";
import { randomUUID } from "node:crypto";
import { existsSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { AgentClient, type AgentSession } from "../ai/client";
import { loadPersistedAnalysis } from "../describer/describer";
import { sessionDir } from "../recorder/session-store";
import { processingStatus, capabilitySnapshot } from "../agents/service";
import { readProcessingSettings } from "../agents/settings";
import { RequestedScopeSchema } from "../../common/agents";
import {
  AnswerSchema,
  businessClarifications,
  MaterialSchema,
  TaskPackageSchema,
  PreparationOutputSchema,
  EnhancementOutputSchema,
  DeepAnalysisOutputSchema,
  EnhancementResultSchema,
  validateCandidate,
  generationGate,
  type EnhancementWorkflow,
  type EnhancementResult,
  type Evidence,
  type TaskPackage,
} from "../../common/enhancement";
import { workflowStore, sessionLocks, fingerprint } from "./store";
import { redactIncremental, redactValue } from "./privacy";
import { cleanupRecordedClaudeTask, runClaudeTaskSession } from "./claude-task-session";

export function inputRevision(id: string): string {
  const analysis = loadPersistedAnalysis(id);
  if (!analysis) throw new Error("请先完成基础分析。");
  const sources = [
    "events.jsonl",
    "audio.json",
    "video.json",
    "frames/frames.json",
    "browser.jsonl",
  ].map((name) => {
    const file = path.join(sessionDir(id), name);
    return existsSync(file)
      ? [name, statSync(file).size, statSync(file).mtimeMs]
      : [name, null];
  });
  return fingerprint({ analysis, sources });
}
export type WorkflowEvent = {
  sessionId: string;
  workflow: EnhancementWorkflow;
};
export class EnrichmentCoordinator {
  private imageRedactor: ((id: string) => Promise<FrameRedactor>) | null = null;
  setImageRedactor(provider: (id: string) => Promise<FrameRedactor>) {
    this.imageRedactor = provider;
  }
  private agents = new Map<string, AgentSession>();
  private projects = new Set<string>();
  constructor(private emit: (event: WorkflowEvent) => void = () => {}) {}
  busy(id?: string) {
    return id
      ? sessionLocks.purpose(id) === "enhancement"
      : sessionLocks.anyBusy("enhancement");
  }
  private save(w: EnhancementWorkflow) {
    workflowStore.save(w);
    this.emit({ sessionId: w.sessionId, workflow: w });
    return w;
  }
  get(id: string) {
    const w = sessionLocks.busy(id)
      ? workflowStore.read(id)
      : workflowStore.recover(id);
    if (
      w.package &&
      w.package.inputRevision !== inputRevision(id) &&
      w.package.status !== "stale" &&
      !sessionLocks.busy(id)
    ) {
      w.package.status = "stale";
      w.approvedAt = null;
      return this.save(w);
    }
    return w;
  }
  async prepare(id: string, _outputKind?: OutputKind | "undecided"): Promise<EnhancementWorkflow> {
    return sessionLocks.withLock(id, "enhancement", async (signal) => {
      const status = await processingStatus();
      if (!status.ready || !status.backend)
        throw new Error(status.error ?? "智能处理未就绪。");
      const old = this.get(id),
        now = Date.now(),
        workspace =
          status.backend === "local-agent"
            ? status.settings.defaultProcessingWorkspaceId
            : null;
      const snapshot = workspace ? capabilitySnapshot(workspace) : null;
      const p: TaskPackage = {
        schemaVersion: 1,
        preparationId: randomUUID(),
        revision: 1,
        sessionId: id,
        inputRevision: inputRevision(id),
        backend: status.backend,
        workspaceId: workspace,
        capabilitySnapshotId: snapshot?.snapshotId ?? null,
        clarificationPolicyVersion: 2,
        outputKind: "undecided",
        managedConfigRevision: snapshot?.managedConfigRevision ?? null,
        capabilitySelectionHash: snapshot?.capabilitySelectionHash ?? null,
        status: "identifying",
        gaps: [],
        questions: [],
        answers: [],
        userNotes: old.package?.userNotes ?? "",
        materials: old.package?.materials ?? [],
        scope: null,
        preparedAt: now,
        confirmedAt: null,
      };
      const w: EnhancementWorkflow = {
        ...old,
        package: p,
        run: null,
        result: null,
        priorApprovedResult: old.approvedAt
          ? old.result
          : (old.priorApprovedResult ?? null),
        approvedAt: null,
        decision: null,
        evidence: [],
        progress: [],
      };
      this.save(w);
      try {
        if(status.backend==='local-agent') {
          const checking=this.executionProgress(w,'checking');
          checking('正在自检 Claude 与模型','验证当前 Claude 配置到模型的完整调用链，最长等待 30 秒。');
          try {
            await this.model(id,signal,'submit_connection_check',z.object({ok:z.literal(true)}),
              'This is a connectivity check. Call submit_connection_check with {"ok":true}. Do not analyze anything.',
              {check:'connection'},30000,checking);
            signal.throwIfAborted();
          } catch(error) {
            if(signal.aborted)throw error;
            throw new Error(`Claude / 模型连接自检失败：${error instanceof Error?error.message:'模型未返回有效响应。'} 分析尚未开始，请检查模型服务后重试。`);
          }
          checking('连接自检通过','Claude 已成功调用当前模型并返回有效结果。');
          this.executionProgress(w,'capabilities')('开始规划分析','连接正常，正在识别信息缺口并匹配工具。');
        }
        const loadedAnalysis=loadPersistedAnalysis(id);
        const analysis = await redactIncremental(JSON.stringify(loadedAnalysis));
        this.executionProgress(w,'capabilities')('已载入规划材料',`已载入 ${loadedAnalysis?.steps.length??0} 个录制步骤、${p.materials.length} 份补充材料；提供 ${snapshot?.tools.length??0} 个候选工具、${snapshot?.skills.length??0} 项 Skill 供规划参考。本阶段仅规划，尚未查询外部业务数据。`);
        const result = await this.model(
          id,
          signal,
          "submit_preparation",
          PreparationOutputSchema,
          CLARIFICATION_INSTRUCTIONS + "\n" + RECORDING_ANALYSIS_RULES +
            "\n本阶段只识别缺口和建议能力，不生成给用户看的最终问题。对 agent-query 缺口，用 suggestedToolRefs 填入能力清单中真实存在的 tool ref；不确定时留空，不得编造 ref。questions 返回空数组。",
          {
            analysis,
            capabilities: snapshot,
            previousConfirmedAnswers:
              old.package?.answers.filter((a) => a.status === "confirmed") ??
              [],
            userNotes: p.userNotes,
            materials: p.materials,
          },
          180000,
          this.executionProgress(w,"capabilities"),
        );
        signal.throwIfAborted();
        for (const g of result.gaps) {
          g.question = await redactIncremental(g.question);
          g.reason = await redactIncremental(g.reason);
          g.resolved = false;
        }
        for (const q of result.questions) {
          q.text = await redactIncremental(q.text);
          q.reason = await redactIncremental(q.reason);
          q.options = await Promise.all(
            q.options.map((option) => redactIncremental(option)),
          );
        }
        p.gaps = result.gaps;
        // This pass only identifies gaps and suggests capabilities. The native
        // session owns the one final user-facing question list.
        p.questions = [];
        const suggested = [...new Set(p.gaps.flatMap((g) => g.suggestedToolRefs ?? []))];
        if (workspace && suggested.length) {
          const usable = suggested.every((ref) => snapshot?.tools.some((t) => t.ref === ref && t.access === "read"));
          if (usable) p.scope = { workspaceId: workspace, allowedToolRefs: suggested, accountRefs: [], resourceRefs: [], timeWindow: null, businessAccess: "read-only" };
        }
        p.status = "ready";
        TaskPackageSchema.parse(p);
        this.validateSteps(
          p.gaps.flatMap((g) => g.stepRefs),
          id,
        );
        w.progress=[...(w.progress??[]),{sequence:(w.progress?.at(-1)?.sequence??100)+1,at:Date.now(),phase:'capabilities' as const,status:'completed' as const,title:'规划结果校验通过',detail:`识别 ${p.gaps.length} 处信息缺口，建议 ${suggested.length} 个工具引用；接下来整理录制材料。`}].slice(-100);
        return this.save(w);
      } catch (error) {
        p.status = "draft";
        w.progress=[...(w.progress??[]),{sequence:(w.progress?.at(-1)?.sequence??100)+1,at:Date.now(),phase:'capabilities' as const,status:'failed' as const,title:signal.aborted?'规划已停止':'规划请求未完成',detail:signal.aborted?'当前模型任务已取消。':'请检查模型服务连接及运行诊断日志。'}].slice(-100);
        this.save(w);
        throw error;
      }
    });
  }
  async draft(
    id: string,
    input: { answers?: unknown; userNotes?: string; materials?: unknown },
  ): Promise<EnhancementWorkflow> {
    if (sessionLocks.busy(id))
      throw new Error("当前输入已冻结。请先取消运行，再修改下一版本。");
    const w = this.get(id),
      p = w.package;
    if (!p) throw new Error("请先整理缺口。");
    if (p.status === "identifying") throw new Error("正在整理，请稍候。");
    if (p.status === "frozen" || w.result) {
      p.revision++;
      p.confirmedAt = null;
      p.status = "stale";
      w.approvedAt = null;
    }
    if (input.answers !== undefined) {
      const answers = z.array(AnswerSchema).max(100).parse(input.answers);
      p.answers = p.answers.filter(a=>a.status === "confirmed" && !answers.some(next=>next.questionId===a.questionId));
      for (const a of answers)
        p.answers.push({
          ...a,
          text: await redactIncremental(a.text),
          appliesTo: await redactIncremental(a.appliesTo),
          status: a.status === "confirmed" ? "draft" : a.status,
          confirmedAt: null,
        });
    }
    if (input.userNotes !== undefined)
      p.userNotes = await redactIncremental(
        z.string().max(24000).parse(input.userNotes),
      );
    if (input.materials !== undefined) {
      const materials = z.array(MaterialSchema).max(20).parse(input.materials);
      p.materials = [];
      for (const m of materials) {
        const text = await redactIncremental(m.text);
        p.materials.push({
          ...m,
          name: await redactIncremental(m.name),
          text,
          hash: fingerprint(text),
        });
      }
    }
    TaskPackageSchema.parse(p);
    return this.save(w);
  }
  confirm(id: string, scope: unknown): EnhancementWorkflow {
    if (sessionLocks.busy(id)) throw new Error("请先完成或取消当前任务。");
    const w = this.get(id),
      p = w.package;
    if (!p || p.status === "draft" || p.status === "identifying")
      throw new Error("请先完成缺口整理。");
    if (p.inputRevision !== inputRevision(id))
      throw new Error("分析已修改，请重新整理。");
    if (p.status === "frozen") return w;
    p.scope = scope === null ? null : RequestedScopeSchema.parse(scope);
    if (p.scope) {
      const m = p.workspaceId ? capabilitySnapshot(p.workspaceId) : null;
      if (!m || m.snapshotId !== p.capabilitySnapshotId || m.stale)
        throw new Error("能力快照已过期，请重新检查并整理任务包。");
      if (
        p.scope.allowedToolRefs.some(
          (ref) => !m.tools.some((t) => t.ref === ref),
        )
      )
        throw new Error("读取范围包含未知工具。");
    }
    const now = Date.now();
    for (const a of p.answers) {
      if (a.status === "draft" && a.text.trim()) {
        a.status = "confirmed";
        a.confirmedAt = now;
      }
    }
    const allQuestions = [...(p.questionHistory ?? []), ...p.questions];
    for (const g of p.gaps)
      g.resolved =
        allQuestions.filter((q) => q.gapRefs.includes(g.id)).length > 0 &&
        allQuestions
          .filter((q) => q.gapRefs.includes(g.id))
          .every((q) =>
            p.answers.some(
              (a) => a.questionId === q.id && a.status === "confirmed",
            ),
          );
    p.status = "frozen";
    p.confirmedAt = now;
    w.decision = { inputRevision: p.inputRevision, kind: "enhance", at: now };
    w.approvedAt = null;
    TaskPackageSchema.parse(p);
    return this.save(w);
  }
  async run(
    id: string,
    runId: string,
    continueRun = false,
    resetBudget = false,
  ): Promise<EnhancementWorkflow> {
    z.string().uuid().parse(runId);
    return sessionLocks.withLock(id, "enhancement", async (signal) => {
      const w = this.get(id),
        p = w.package;
      if (!p || p.status !== "frozen" || p.inputRevision !== inputRevision(id))
        throw new Error("请先确认当前任务包。");
      if (this.projects.has(p.workspaceId ?? "api"))
        throw new Error("此项目已有处理任务，请稍后重试。");
      if (this.agents.size >= 3)
        throw new Error("已达到并行处理上限，请稍后重试。");
      const project = p.workspaceId ?? "api";
      const now = Date.now();
      const prior = continueRun ? w.run : null;
      if (continueRun && (!prior || prior.runId !== runId))
        throw new Error("恢复任务不匹配。");
      if (resetBudget && (!prior || !["failed", "paused", "canceled", "interrupted"].includes(prior.status)))
        throw new Error("只有已停止的失败或暂停任务可以重算重试额度。");
      this.projects.add(project);
      w.progress = [];
      w.run = {
        runId,
        sessionId: id,
        inputRevision: p.inputRevision,
        taskPackageRevision: p.revision,
        status: "queued",
        attempt: (prior?.attempt ?? 0) + 1,
        externalCalls: resetBudget ? 0 : prior?.externalCalls ?? 0,
        activeMs: resetBudget ? 0 : prior?.activeMs ?? 0,
        budget: prior?.budget ?? { maxExternalCalls: 20, activeMs: 300000 },
        createdAt: resetBudget ? now : prior?.createdAt ?? now,
        attemptStartedAt: now,
        updatedAt: now,
        error: null,
        eventSequence: (prior?.eventSequence ?? 0) + 1,
        phase: "queued",
      };
      // Manifest/checkpoint exists before a process can start or emit an event.
      const started = Date.now();
      const packageBefore=structuredClone(p);
      const resultBefore=w.result;
      try {
        this.save(w);
        const status = await processingStatus();
        if (
          !status.ready ||
          status.backend !== p.backend ||
          (p.backend === "local-agent" &&
            (status.settings.defaultProcessingWorkspaceId !== p.workspaceId ||
             (p.managedConfigRevision && status.managed?.activeConfigRevision !== p.managedConfigRevision)))
        )
          throw new Error("当前后端与已确认任务包不一致，请重新确认。");
        if (w.run.activeMs >= w.run.budget.activeMs) {
          w.run.status = "paused";
          w.run.error = "本次分析额度已用完，点击重试可重新计时；已保存的分析和回答会保留。";
          return this.save(w);
        }
        const previousResult = w.result;
        const finalizeAfterAnswers = !!(
          continueRun && previousResult &&
          (prior?.status === "awaiting-input" ||
            ((prior?.phase === "finalizing" || p.questions.length > 0) && prior && ["failed", "paused", "canceled", "interrupted"].includes(prior.status)))
        );
        w.run.status = "running";
        w.run.phase = finalizeAfterAnswers ? "finalizing" : "materials";
        if (finalizeAfterAnswers) w.progress = [{sequence:0,at:now,phase:p.backend === "local-agent" ? "reading" : "finalizing",status:"running",title:p.backend === "local-agent" ? "正在恢复 Claude 会话" : "正在合并回答并整理结果",detail:"保留已有分析上下文，基于用户反馈继续分析。"}];
        if (!finalizeAfterAnswers) w.result = null;
        w.approvedAt = null;
        const foundation = await this.foundation(id, p);
        w.evidence = [
          ...w.evidence.filter((e) => e.sourceType === "mcp"),
          ...foundation,
        ];
        this.save(w);
        let output: z.infer<typeof DeepAnalysisOutputSchema>;
        let followupQuestions: z.infer<typeof DeepAnalysisOutputSchema>["questions"] = [];
        if (finalizeAfterAnswers && p.backend !== "local-agent") {
          const finalized = await this.model(
            id, signal, "submit_enhancement", EnhancementOutputSchema,
            RECORDING_SEMANTICS + CLARIFICATION_INSTRUCTIONS + "\n" + RECORDING_ANALYSIS_RULES +
              "\n这是用户一次性回答后的终局整理。只把已确认回答并入已有 claims；不得读取工作区或调用 MCP。review 必须 pending。只有回答与证据发生真实冲突时才返回 followupQuestions。使用中文。",
            { package: p, evidence: w.evidence, priorResult: previousResult },
            Math.max(1000, w.run.budget.activeMs - w.run.activeMs),
            this.executionProgress(w,"finalizing"),
          );
          output = { claims: finalized.claims, remainingGapRefs: finalized.remainingGapRefs, summary: finalized.summary, questions: [], screenshotReviews: previousResult?.screenshotReviews };
          followupQuestions = finalized.followupQuestions;
        } else if (p.backend === "local-agent") {
          if (prior?.status === "interrupted") await cleanupRecordedClaudeTask(runId);
          const workspace = readProcessingSettings().workspaces.find((item) => item.id === p.workspaceId);
          if (!workspace) throw new Error("任务绑定的 Claude 专用环境不存在。");
          output = await runClaudeTaskSession({
            runId, attempt: w.run.attempt, package: p, evidence: w.evidence,
            workspace, signal, continueRun, priorResult: previousResult ?? undefined,
            timeoutMs: Math.max(1000, w.run.budget.activeMs - w.run.activeMs),
            redactor: this.imageRedactor ? await this.imageRedactor(id) : undefined,
            onEvidence: (evidence) => { if(!w.evidence.some(item=>item.id===evidence.id))w.evidence.push(evidence); },
            onProgress: (event) => {
              w.progress = [...(w.progress ?? []).filter((item) => item.sequence !== event.sequence), event].slice(-100);
              w.run!.phase = event.phase==='checking'?'capabilities':event.phase;
              w.run!.eventSequence++;
              this.save(w);
            },
            onExternalCall: (name) => {
              if (!w.run) throw new Error("运行状态丢失，无法记录外部调用。");
              w.run.externalCalls++;
              w.run.updatedAt = Date.now();
              w.run.eventSequence++;
              if (w.run.externalCalls > w.run.budget.maxExternalCalls) {
                w.run.status = "paused";
                w.run.error = `外部调用预算已耗尽（${w.run.budget.maxExternalCalls}）。`;
                this.save(w);
                throw new Error(w.run.error);
              }
              this.save(w);
            },
          });
          followupQuestions = output.questions;
        } else {
          output = await this.model(
            id, signal, "submit_enhancement", DeepAnalysisOutputSchema,
            RECORDING_SEMANTICS + CLARIFICATION_INSTRUCTIONS + "\n" + RECORDING_ANALYSIS_RULES +
              "\n本机没有可用 Claude Code，使用现有轻量模型回退。基于任务包和证据完成只读分析；不能实际查询的缺口保留，并汇总成一次性 questions。review 必须 pending。使用中文。",
            { package: p, evidence: w.evidence },
            Math.max(1000, w.run.budget.activeMs - w.run.activeMs),
          );
          followupQuestions = output.questions;
        }
        signal.throwIfAborted();
        // The API fallback receives no images, so it cannot judge their usefulness.
        if (!finalizeAfterAnswers && p.backend !== "local-agent") output.screenshotReviews = undefined;
        followupQuestions = businessClarifications(followupQuestions, p.gaps);
        if (followupQuestions.some((q) => q.gapRefs.some((ref) => !p.gaps.some((g) => g.id === ref))))
          throw new Error("最终问题引用了未知缺口。");
        if (followupQuestions.length) {
          p.revision++;
          p.questionHistory = [...(p.questionHistory ?? []), ...p.questions]
            .filter(q => !followupQuestions.some(next => next.id === q.id));
          p.questions = followupQuestions;
          p.status = "awaiting-answers";
          p.confirmedAt = null;
        }
        const result: EnhancementResult = {
          schemaVersion: 1,
          runId,
          inputRevision: p.inputRevision,
          taskPackageRevision: p.revision,
          claims: output.claims,
          remainingGapRefs: output.remainingGapRefs,
          screenshotReviews: output.screenshotReviews ?? (finalizeAfterAnswers ? previousResult?.screenshotReviews : undefined),
          summary: await redactIncremental(output.summary),
        };
        // A normal clarification answer describes this task unless the user
        // explicitly supplied a wider scope. Never elevate it to a global rule.
        for (const claim of result.claims) {
          if (claim.kind !== "user-confirmed" || claim.temporalScope !== "invariant") continue;
          const confirmed = claim.evidenceRefs.flatMap(ref=>{
            const evidence=w.evidence.find(e=>e.id===ref && e.sourceType==="user");
            return evidence ? p.answers.filter(a=>a.questionId===evidence.sourceRef && a.status==="confirmed") : [];
          });
          if (confirmed.length && confirmed.every(a=>!a.appliesTo.trim())) {
            claim.temporalScope="at-recording";
            claim.appliesTo="本次录制任务";
          }
        }
        await this.acceptCandidate(w, result);
        if (followupQuestions.length) {
          for (const q of followupQuestions) {
            q.text = await redactIncremental(q.text);
            q.reason = await redactIncremental(q.reason);
            q.options = await Promise.all(
              q.options.map((option) => redactIncremental(option)),
            );
          }
          p.questions = followupQuestions;
          TaskPackageSchema.parse(p);
          w.run.status = "awaiting-input";
        } else w.run.status = "completed";
        w.progress=[...(w.progress??[]).filter(event=>event.sequence!==4),{sequence:4,at:Date.now(),phase:"finalizing",status:"completed",title:"深度分析完成",detail:w.run.status==="awaiting-input"?`还需确认 ${p.questions.length} 项`:"结果已保存，等待审核"}];
      } catch (error) {
        for (const key of Object.keys(p))
          if (!(key in packageBefore)) Reflect.deleteProperty(p, key);
        Object.assign(p,packageBefore);
        w.result=resultBefore;
        const budgetPaused = w.run.status === "paused";
        w.run.status = budgetPaused
          ? "paused"
          : signal.aborted
            ? "canceled"
            : w.run.activeMs + Date.now() - started >= w.run.budget.activeMs
              ? "paused"
              : "failed";
        w.run.error = w.run.status === "paused" && w.run.activeMs + Date.now() - started >= w.run.budget.activeMs
          ? "本次分析额度已用完，点击重试可重新计时；已保存的分析和回答会保留。"
          : error instanceof Error ? error.message : "增强失败。";
      } finally {
        w.run.activeMs += Date.now() - started;
        w.run.updatedAt = Date.now();
        w.run.eventSequence++;
        this.projects.delete(project);
        this.save(w);
      }
      return w;
    });
  }
  private async foundation(id: string, p: TaskPackage): Promise<Evidence[]> {
    const evidence: Evidence[] = [];
    const add = async (
      sourceType: Evidence["sourceType"],
      sourceRef: string,
      summary: string,
    ) => {
      const text = await redactIncremental(summary);
      evidence.push({
        id: "ev-" + fingerprint({ sourceType, sourceRef, text }).slice(0, 24),
        sourceType,
        sourceRef,
        summary: text,
        contentHash: fingerprint(text),
        recordedAt: null,
        queriedAt: null,
        resourceAt: null,
        privacy: "redacted",
      });
    };
    const analysis = loadPersistedAnalysis(id)!;
    let startedAt: number | null = null;
    const metaFile = path.join(sessionDir(id), "session.json");
    if (existsSync(metaFile)) {
      const meta = JSON.parse(readFileSync(metaFile, "utf8"));
      startedAt = typeof meta.startedAt === "number" ? meta.startedAt : null;
    }
    for (const step of analysis.steps) {
      await add("recording", step.id, JSON.stringify(step));
      evidence[evidence.length - 1]!.recordedAt =
        startedAt !== null && step.startMs != null
          ? startedAt + step.startMs
          : startedAt;
    }
    for (const a of p.answers.filter((a) => a.status === "confirmed"))
      await add(
        "user",
        a.questionId,
        JSON.stringify({ answer: a.text, appliesTo: a.appliesTo }),
      );
    if (p.userNotes) await add("material", "user-notes", p.userNotes);
    for (const material of p.materials)
      await add("material", material.id, material.text);
    return evidence;
  }
  private validateSteps(refs: string[], id: string) {
    const ids = new Set(loadPersistedAnalysis(id)?.steps.map((s) => s.id));
    if (refs.some((ref) => !ids.has(ref)))
      throw new Error("结果引用了未知步骤。");
  }
  private async acceptCandidate(
    w: EnhancementWorkflow,
    result: EnhancementResult,
  ) {
    validateCandidate(result, w.package!, w.evidence);
    this.validateSteps(
      result.claims.flatMap((c) => c.stepRefs),
      w.sessionId,
    );
    for (const c of result.claims) {
      if (
        c.kind === "queried" &&
        !c.evidenceRefs.some(
          (ref) => w.evidence.find((e) => e.id === ref)?.sourceType === "mcp",
        )
      )
        throw new Error("查询结论缺少实际 MCP 证据。");
      if (
        c.kind === "user-confirmed" &&
        !c.evidenceRefs.some((ref) => {
          const ev = w.evidence.find((e) => e.id === ref);
          return (
            ev?.sourceType === "user" &&
            w.package!.answers.some(
              (a) =>
                a.questionId === ev.sourceRef &&
                a.status === "confirmed" &&
                (c.temporalScope !== "invariant" || a.appliesTo.trim()),
            )
          );
        })
      )
        throw new Error("用户规则缺少已确认且范围明确的回答。");
      if (
        c.kind === "queried" &&
        c.temporalScope === "at-recording" &&
        !c.evidenceRefs.some(
          (ref) => w.evidence.find((e) => e.id === ref)?.resourceAt != null,
        )
      )
        throw new Error("历史查询结论缺少资源适用时点。");
      if (c.temporalScope === "invariant" && c.kind !== "user-confirmed")
        throw new Error("固定规则需要用户明确确认适用范围。");
      c.text = await redactIncremental(c.text);
      c.appliesTo = await redactIncremental(c.appliesTo);
      c.reason = await redactIncremental(c.reason);
    }
    result.summary = await redactIncremental(result.summary);
    w.result = result;
    w.approvedAt = null;
    return this.save(w);
  }
  async exportPackage(id: string): Promise<unknown> {
    if (sessionLocks.busy(id)) throw new Error("当前任务仍在运行。");
    const w = this.get(id),
      p = w.package;
    if (!p || p.status !== "frozen") throw new Error("请先确认任务包。");
    if (
      !w.run ||
      w.run.taskPackageRevision !== p.revision ||
      w.run.inputRevision !== p.inputRevision
    ) {
      const runId = randomUUID();
      const now = Date.now();
      w.run = {
        runId,
        sessionId: id,
        inputRevision: p.inputRevision,
        taskPackageRevision: p.revision,
        status: "paused",
        attempt: 0,
        externalCalls: 0,
        activeMs: 0,
        budget: { maxExternalCalls: 20, activeMs: 300000 },
        createdAt: now,
        updatedAt: now,
        error: null,
        eventSequence: 0,
        phase: "queued",
      };
    }
    w.evidence = await this.foundation(id, p);
    this.save(w);
    const recording = await recordingMaterials(
      id,
      this.imageRedactor ? await this.imageRedactor(id) : undefined,
    );
    return {
      recording,
      schemaVersion: 1,
      mode: "manual",
      instructions:
        "仅只读补证。不得把当前查询值当作历史事实或固定规则。返回 result 和新证据 evidence；所有 claim.review=pending。结果须经用户审核。应用不会验证外部 Agent 的权限或实际动作。",
      taskPackage: p,
      analysis: await redactValue(loadPersistedAnalysis(id)),
      evidence: w.evidence,
      runId: w.run.runId,
      resultSchema: z.toJSONSchema(EnhancementResultSchema),
    };
  }
  async importCandidate(
    id: string,
    value: unknown,
  ): Promise<EnhancementWorkflow> {
    return sessionLocks.withLock(id, "enhancement", async () => {
      const w = this.get(id),
        p = w.package;
      if (!p || p.status !== "frozen" || p.inputRevision !== inputRevision(id))
        throw new Error("任务包过期或未确认。");
      const imported = z
        .object({
          result: EnhancementResultSchema,
          evidence: z
            .array(
              z.object({
                id: z.string(),
                sourceRef: z.string(),
                summary: z.string().max(24000),
                recordedAt: z.number().nullable(),
                queriedAt: z.number().nullable(),
                resourceAt: z.number().nullable(),
              }),
            )
            .max(100)
            .default([]),
        })
        .parse(value);
      if (!w.run || imported.result.runId !== w.run.runId)
        throw new Error("结果不属于本次导出的任务。");
      for (const e of imported.evidence) {
        if (w.evidence.some((prior) => prior.id === e.id))
          throw new Error("证据 ID 重复。");
        if (!p.scope?.allowedToolRefs.includes(e.sourceRef))
          throw new Error("导入证据超出工具范围。");
        const summary = await redactIncremental(e.summary);
        w.evidence.push({
          ...e,
          summary,
          sourceType: "mcp",
          contentHash: fingerprint(summary),
          privacy: "redacted",
        });
      }
      await this.acceptCandidate(w, imported.result);
      w.run.status = "completed";
      w.run.updatedAt = Date.now();
      return this.save(w);
    });
  }
  review(
    id: string,
    decisions: { id: string; review: "accepted" | "rejected" }[],
  ): EnhancementWorkflow {
    if (sessionLocks.busy(id))
      throw new Error("增强尚未结束，不能审核最终候选。");
    const w = this.get(id);
    if (
      w.run?.status !== "completed" ||
      !w.result ||
      w.package?.inputRevision !== inputRevision(id) ||
      w.package.status !== "frozen"
    )
      throw new Error("当前候选尚未完成或已过期。");
    for (const claim of w.result.claims) {
      const decision = decisions.find((d) => d.id === claim.id);
      if (!decision) throw new Error("请逐条接受或拒绝所有候选。");
      claim.review = decision.review;
    }
    const rejected = w.result.claims.filter((c) => c.review === "rejected");
    if (rejected.length)
      w.result.remainingGapRefs = [
        ...new Set([
          ...w.result.remainingGapRefs,
          ...w.package.gaps
            .filter(
              (g) =>
                g.critical &&
                rejected.some((c) =>
                  c.stepRefs.some((s) => g.stepRefs.includes(s)),
                ),
            )
            .map((g) => g.id),
        ]),
      ];
    w.approvedAt = Date.now();
    w.decision = {
      inputRevision: inputRevision(id),
      kind: "enhance",
      at: Date.now(),
    };
    return this.save(w);
  }
  skip(id: string): EnhancementWorkflow {
    if (sessionLocks.busy(id)) throw new Error("请先取消任务并等待停止。");
    const w = this.get(id);
    const revision = inputRevision(id);
    if (w.package?.inputRevision !== revision) w.package = null;
    if (!w.package) {
      const analysis = loadPersistedAnalysis(id)!;
      const now = Date.now();
      w.package = {
        schemaVersion: 1,
        preparationId: randomUUID(),
        revision: 1,
        sessionId: id,
        inputRevision: revision,
        backend: "api",
        workspaceId: null,
        capabilitySnapshotId: null,
        status: "ready",
        gaps: analysis.steps
          .filter((s) => s.confidence === "low" || !s.detail.trim())
          .map((s) => ({
            id: "baseline-" + s.id,
            stepRefs: [s.id],
            question: s.title + "：尚缺可靠说明",
            reason: "基础分析存在低置信度或缺失说明",
            strategy: "unresolved",
            critical: true,
            resolved: false,
          })),
        questions: [],
        answers: [],
        userNotes: "",
        materials: [],
        scope: null,
        preparedAt: now,
        confirmedAt: null,
      };
      if (analysis.intentConfidence === "low" || analysis.steps.length === 0)
        w.package.gaps.push({
          id: "baseline-intent",
          stepRefs: [],
          question: "任务目标或关键步骤尚未明确",
          reason: "基础分析不足",
          strategy: "unresolved",
          critical: true,
          resolved: false,
        });
    }
    w.run = null;
    w.result = null;
    w.approvedAt = null;
    w.decision = { kind: "skip", inputRevision: revision, at: Date.now() };
    return this.save(w);
  }
  increaseBudget(id: string, activeMs: number) {
    if (sessionLocks.busy(id)) throw new Error("请先等待当前任务停止。");
    const w = this.get(id);
    if (
      !w.run ||
      !Number.isFinite(activeMs) ||
      activeMs <= w.run.budget.activeMs ||
      activeMs > 3600000
    )
      throw new Error("新预算必须高于累计上限，且不超过一小时。");
    w.run.budget.activeMs = activeMs;
    return this.save(w);
  }
  gate(id: string) {
    return generationGate(this.get(id), inputRevision(id));
  }
  async cancel(id: string) {
    const stopped=sessionLocks.waitForIdle(id);
    sessionLocks.cancel(id);
    await this.agents.get(id)?.abort();
    await stopped;
    return this.get(id);
  }
  async dispose() {
    sessionLocks.cancelAll();
    await Promise.all([...this.agents.values()].map((a) => a.abort()));
    for (let i = 0; i < 100 && sessionLocks.anyBusy("enhancement"); i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
  }
  private executionProgress(w:EnhancementWorkflow,phase:"checking"|"capabilities"|"finalizing") {
    let sequence=Math.max(99,...(w.progress??[]).map(event=>event.sequence))+1;
    return (title:string,detail:string,model?:string)=>{
      w.progress=[...(w.progress??[]),{sequence:sequence++,at:Date.now(),phase,status:"running" as const,title,detail,model}].slice(-100);
      this.save(w);
    };
  }
  private async model<T>(
    id: string,
    signal: AbortSignal,
    toolName: string,
    schema: z.ZodType<T>,
    instructions: string,
    payload: unknown,
    timeout = 180000,
    onExecution?: (title:string,detail:string,model?:string)=>void,
  ): Promise<T> {
    const client = new AgentClient();
    let agent: AgentSession | undefined;
    let output: T | undefined;
    try {
      signal.throwIfAborted();
      await client.start();
      signal.throwIfAborted();
      agent = await client.createSession({
        onExecution,
        connectionCheck:toolName==='submit_connection_check',
        systemMessage: {
          mode: "append",
          content:
            instructions +
            "\nUse the submission tool exactly once; no other tools are available.",
        },
        terminalTools: [toolName],
        tools: [
          {
            name: toolName,
            parameters: z.toJSONSchema(schema) as Record<string, unknown>,
            handler: (args) => {
              output = schema.parse(args);
              return {
                resultType: "success",
                textResultForLlm: "候选已提交，仍需用户审核。",
              };
            },
          },
        ],
      });
      this.agents.set(id, agent);
      const abort = () => void agent?.abort();
      signal.addEventListener("abort", abort, { once: true });
      try {
        signal.throwIfAborted();
        await agent.sendAndWait(JSON.stringify(payload), timeout);
        signal.throwIfAborted();
      } finally {
        signal.removeEventListener("abort", abort);
      }
      if (output === undefined) throw new Error("模型未提交有效的结构化结果。");
      return output;
    } finally {
      this.agents.delete(id);
      await client.stop();
    }
  }
}
