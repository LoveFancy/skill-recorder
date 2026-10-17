import { z } from "zod";

export const AgentKind = z.enum(["claude-code"]);
export const AgentStatus = z.enum([
  "available",
  "not-installed",
  "auth-required",
  "incompatible",
  "check-failed",
]);
export const WorkspaceStatus = z.enum([
  "unchecked",
  "checking",
  "ready",
  "needs-project",
  "inaccessible",
  "error",
]);
export const McpStatus = z.enum([
  "configured",
  "checking",
  "connected",
  "auth-required",
  "connection-failed",
  "unverified",
]);
export const SkillDiscoveryStatus = z.enum([
  "discovered",
  "unreadable",
  "conflict",
  "unverified",
]);
export const ErrorInfo = z.object({ code: z.string(), message: z.string() });
export const AgentAvailabilitySchema = z.object({
  agentKind: AgentKind,
  status: AgentStatus,
  executable: z.string().nullable(),
  agentVersion: z.string().nullable(),
  checkedAt: z.number(),
  lastError: ErrorInfo.nullable(),
  controlled: z.boolean().default(false),
});
export type AgentAvailability = z.infer<typeof AgentAvailabilitySchema>;
export const AgentWorkspaceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  agentKind: AgentKind,
  executable: z.string(),
  projectDirectory: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  agentVersion: z.string().nullable(),
  status: WorkspaceStatus,
  lastInspectedAt: z.number().nullable(),
  lastError: ErrorInfo.nullable(),
  capabilitySnapshotId: z.string().nullable(),
  trustedAt: z.number().nullable(),
  managed: z.boolean().optional(),
  activeConfigRevision: z.string().uuid().nullable().optional(),
  capabilitySelectionHash: z.string().nullable().optional(),
});
export type AgentWorkspace = z.infer<typeof AgentWorkspaceSchema>;
export const ProcessingSettingsSchema = z
  .object({
    version: z.literal(1),
    backendPreference: z.enum(["auto", "local-agent", "api"]),
    defaultProcessingWorkspaceId: z.string().uuid().nullable(),
    workspaces: z.array(AgentWorkspaceSchema),
    managedEnvironmentId: z.string().uuid().nullable().optional(),
  })
  .superRefine((s, c) => {
    if (new Set(s.workspaces.map((w) => w.id)).size !== s.workspaces.length)
      c.addIssue({ code: "custom", message: "Duplicate workspace" });
    if (
      s.defaultProcessingWorkspaceId &&
      !s.workspaces.some((w) => w.id === s.defaultProcessingWorkspaceId)
    )
      c.addIssue({ code: "custom", message: "Unknown default workspace" });
  });
export type ProcessingSettings = z.infer<typeof ProcessingSettingsSchema>;
export const CapabilityManifestSchema = z.object({
  schemaVersion: z.literal(1),
  snapshotId: z.string().uuid(),
  workspaceId: z.string().uuid(),
  agentKind: AgentKind,
  agentVersion: z.string(),
  checkedAt: z.number(),
  managedConfigRevision: z.string().uuid().optional(),
  capabilitySelectionHash: z.string().optional(),
  discoveryMethod: z.string(),
  coveredSources: z.array(z.string()),
  omittedSources: z.array(z.string()),
  stale: z.boolean(),
  servers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      source: z.string(),
      status: McpStatus,
      lastError: ErrorInfo.nullable(),
    }),
  ),
  tools: z.array(
    z.object({
      ref: z.string(),
      providerId: z.string(),
      name: z.string(),
      description: z.string(),
      inputSchema: z.record(z.string(), z.unknown()),
      schemaHash: z.string(),
      accountRefs: z.array(z.string()),
      access: z.enum(["read", "write", "mixed", "unknown"]),
      accessVerifiedBy: z.string().nullable(),
    }),
  ),
  skills: z.array(
    z.object({
      ref: z.string(),
      name: z.string(),
      description: z.string(),
      source: z.string(),
      contentHash: z.string().nullable(),
      status: SkillDiscoveryStatus,
    }),
  ),
});
export type CapabilityManifest = z.infer<typeof CapabilityManifestSchema>;
export const RequestedScopeSchema = z
  .object({
    workspaceId: z.string().uuid(),
    allowedToolRefs: z.array(z.string()),
    accountRefs: z.array(z.string()),
    resourceRefs: z.array(z.string()),
    timeWindow: z
      .object({ from: z.number().finite(), to: z.number().finite() })
      .nullable(),
    businessAccess: z.literal("read-only"),
  })
  .superRefine((s, c) => {
    if (s.timeWindow && s.timeWindow.from > s.timeWindow.to)
      c.addIssue({ code: "custom", message: "Invalid time window" });
  });
export type RequestedScope = z.infer<typeof RequestedScopeSchema>;
export interface ProcessingStatus {
  settings: ProcessingSettings;
  availability: AgentAvailability;
  backend: "local-agent" | "api" | null;
  ready: boolean;
  error: string | null;
  managed?: ManagedEnvironmentView | null;
}

export const CapabilityReviewState = z.enum(["confirmed", "needs-review", "missing", "conflict"]);
export const CapabilitySelectionSchema = z.object({
  ref: z.string(), kind: z.enum(["mcp", "skill"]), name: z.string(),
  description: z.string(), source: z.string(), sourceHash: z.string(),
  enabled: z.boolean(), reviewState: CapabilityReviewState,
  change: z.enum(["added", "changed", "removed", "unchanged"]),
  error: z.string().nullable(),
});
export type CapabilitySelection = z.infer<typeof CapabilitySelectionSchema>;
export const ManagedEnvironmentViewSchema = z.object({
  environmentId: z.string().uuid(), directory: z.string(), createdAt: z.number(),
  activeConfigRevision: z.string().uuid(), sourceSnapshotId: z.string().uuid(),
  resourceHash: z.string().optional(),
  capabilitySelectionHash: z.string(), checkedAt: z.number(),
  isolationStatus: z.enum(["verified", "unverified", "failed"]),
  isolationMethod: z.string(), capabilities: z.array(CapabilitySelectionSchema),
  coveredSources: z.array(z.string()), omittedSources: z.array(z.string()),
  sourceError: z.string().nullable(),
});
export type ManagedEnvironmentView = z.infer<typeof ManagedEnvironmentViewSchema>;
export const ManagedSelectionInputSchema = z.object({
  baseRevision: z.string().uuid(), sourceSnapshotId: z.string().uuid(),
  enabledRefs: z.array(z.string()).max(1000), confirmed: z.literal(true),
});
export type ManagedSelectionInput = z.infer<typeof ManagedSelectionInputSchema>;
export interface ManagedSourcePreview {
  baseRevision: string; sourceSnapshotId: string; checkedAt: number;
  capabilities: CapabilitySelection[]; coveredSources: string[]; omittedSources: string[];
}
