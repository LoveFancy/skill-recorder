import { workflowStore, fingerprint } from "./store";
import { inputRevision } from "./coordinator";
import { generationGate } from "../../common/enhancement";
import { capabilitySnapshot } from "../agents/service";
import type { SkillArchitecture } from "../../common/skill";
export function generationContext(id: string, architecture: SkillArchitecture) {
  const w = workflowStore.read(id);
  if (!w.decision) return null; // legacy direct builder clients
  const revision = inputRevision(id),
    gate = generationGate(w, revision);
  if (!gate.allowed) throw new Error(gate.reason!);
  const claims =
    w.decision.kind === "enhance"
      ? (w.result?.claims.filter((c) => c.review === "accepted") ?? [])
      : [];
  const snapshot = w.package?.workspaceId
    ? capabilitySnapshot(w.package.workspaceId, w.package.capabilitySnapshotId ?? undefined)
    : null;
  if (architecture === "claude-code" && !snapshot)
    throw new Error("Claude Skill 需要专用环境的能力快照，请先整理任务包。");
  const project = architecture === "claude-code" ? snapshot : null;
  const portableGaps =
    architecture === "agent-skill" && w.package?.scope?.allowedToolRefs.length
      ? ["此增强使用项目 MCP；通用目标缺少已核验的可移植对应能力"]
      : [];
  const missing =
    architecture === "claude-code" && snapshot?.stale
      ? ["项目能力快照已过期，使用前必须重新核验"]
      : [];
  return {
    inputRevision: revision,
    taskPackageRevision: w.package?.revision ?? null,
    runId: w.result?.runId ?? null,
    status:
      gate.draft || missing.length || portableGaps.length
        ? ("draft" as const)
        : ("reviewed" as const),
    gaps: [...gate.gaps, ...missing, ...portableGaps],
    rules: claims.filter((c) => c.temporalScope === "invariant"),
    runtimeQueries: claims.filter((c) => c.temporalScope === "current"),
    historicalFacts: claims.filter((c) => c.temporalScope === "at-recording"),
    parameters:
      w.package?.answers.filter((a) => a.status === "confirmed") ?? [],
    project,
    contentChecked: true,
    executionVerified: false,
  };
}
export function generationKey(id: string, architecture: SkillArchitecture) {
  return fingerprint(generationContext(id, architecture));
}
