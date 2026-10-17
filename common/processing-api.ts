import type {
  ProcessingStatus,
  CapabilityManifest,
  ProcessingSettings,
  ManagedSelectionInput, ManagedSourcePreview,
} from "./agents";
import type { EnhancementWorkflow } from "./enhancement";
import type { BuiltinToolsView, MailAccount } from "./builtin-tools";
export type ProcessingAction =
  | { kind: "status" }
  | { kind: "builtin-status" }
  | { kind: "builtin-mail-save"; account: (MailAccount & {password?:string}) | null }
  | { kind: "managed-sync" }
  | { kind: "managed-save"; input: ManagedSelectionInput }
  | { kind: "save"; settings: ProcessingSettings }
  | {
      kind: "associate";
      directory: string;
      name: string;
      trust: boolean;
      create?: boolean;
      executable?: string;
    }
  | { kind: "pick-directory" }
  | {
      kind: "capabilities";
      workspaceId: string;
      refresh?: "configuration" | "connection";
    };
export interface ProcessingResult {
  ok: boolean;
  status?: ProcessingStatus;
  builtins?: BuiltinToolsView;
  snapshot?: CapabilityManifest | null;
  preview?: ManagedSourcePreview;
  directory?: string;
  error?: string;
  canceled?: boolean;
}
export type EnhancementAction =
  | {
      kind: "get" | "prepare" | "skip" | "cancel" | "export" | "import";
      sessionId: string;
      outputKind?: import("./output").OutputKind | "undecided";
    }
  | {
      kind: "draft";
      sessionId: string;
      input: { answers?: unknown; userNotes?: string; materials?: unknown };
    }
  | { kind: "confirm"; sessionId: string; scope: unknown }
  | { kind: "run"; sessionId: string; runId: string; continueRun?: boolean; resetBudget?: boolean }
  | {
      kind: "review";
      sessionId: string;
      decisions: { id: string; review: "accepted" | "rejected" }[];
    }
  | { kind: "budget"; sessionId: string; activeMs: number };
export interface EnhancementResponse {
  ok: boolean;
  workflow?: EnhancementWorkflow;
  path?: string;
  error?: string;
  canceled?: boolean;
}
