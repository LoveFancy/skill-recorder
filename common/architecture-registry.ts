import { z } from "zod";

export const BUILD_KINDS = ["skill", "automation"] as const;
export const BuildKind = z.enum(BUILD_KINDS);
export type BuildKind = z.infer<typeof BuildKind>;

export const TARGET_PLACEMENTS = ["install", "export"] as const;
export type TargetPlacement = (typeof TARGET_PLACEMENTS)[number];

export interface ArchitectureTargetDefinition {
  kind: BuildKind;
  label: string;
  enabled: boolean;
  note: string;
  /** Ordered delivery capabilities; the first entry is the primary/default placement. */
  placements: readonly TargetPlacement[];
}

export interface ArchitectureDefinition<Id extends string = string> {
  id: Id;
  label: string;
  installTargetLabel: string;
  note: string;
  targets: readonly ArchitectureTargetDefinition[];
}

export function defineArchitectures<
  const T extends readonly ArchitectureDefinition[],
>(definitions: T): T {
  if (definitions.length === 0) {
    throw new Error("Architecture manifest must contain at least one architecture.");
  }

  const ids = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) {
      throw new Error(`Duplicate architecture id "${definition.id}".`);
    }
    ids.add(definition.id);

    if (!definition.installTargetLabel.trim()) {
      throw new Error(
        `Architecture "${definition.id}" must declare an install target label.`,
      );
    }

    if (definition.targets.length === 0) {
      throw new Error(`Architecture "${definition.id}" must declare at least one target.`);
    }

    const kinds = new Set<BuildKind>();
    for (const target of definition.targets) {
      if (kinds.has(target.kind)) {
        throw new Error(
          `Architecture "${definition.id}" declares "${target.kind}" more than once.`,
        );
      }
      kinds.add(target.kind);

      if (target.placements.length === 0) {
        throw new Error(
          `Architecture "${definition.id}" target "${target.kind}" must declare at least one placement.`,
        );
      }

      const placements = new Set<TargetPlacement>();
      for (const placement of target.placements) {
        if (placements.has(placement)) {
          throw new Error(
            `Architecture "${definition.id}" target "${target.kind}" declares placement "${placement}" more than once.`,
          );
        }
        placements.add(placement);
      }
    }
  }

  return definitions;
}

export const ARCHITECTURE_MANIFEST = defineArchitectures([
  {
    id: "scout",
    label: "Scout",
    installTargetLabel: "Scout",
    note: "Microsoft Scout：支持 WorkIQ、浏览器、文件和内置技能。",
    targets: [
      {
        kind: "skill",
        label: "Scout 技能",
        enabled: true,
        note: "Scout 按需执行的技能，根据描述匹配任务。",
        placements: ["install", "export"],
      },
      {
        kind: "automation",
        label: "Scout 自动化",
        enabled: true,
        note: "Scout 按计划或触发条件执行的多步骤自动化。",
        placements: ["install"],
      },
    ],
  },
  {
    id: "cowork",
    label: "Cowork",
    installTargetLabel: "Microsoft 365 Copilot",
    note:
      "Microsoft 365 Copilot（Cowork）：支持 Teams、Outlook、日历、" +
      "SharePoint、文件和内置技能。",
    targets: [
      {
        kind: "skill",
        label: "Cowork 技能",
        enabled: true,
        note: "导出并安装到 Microsoft 365 Copilot（Cowork）的按需技能。",
        placements: ["export"],
      },
    ],
  },
  {
    id: "agent-skill",
    label: "通用智能体技能",
    // Export-only, so this label is never surfaced; kept non-blank for the manifest
    // invariant and as a sensible fallback if the target ever gains an install path.
    installTargetLabel: "你的智能体",
    note: "适用于支持技能的智能体，不依赖特定工具，请确认目标智能体能执行这些任务。",
    targets: [
      {
        kind: "skill",
        label: "通用智能体技能",
        enabled: true,
        note:
          "适用于支持技能的智能体，不依赖特定工具，请确认目标智能体能执行这些任务。",
        placements: ["export"],
      },
    ],
  },
  {
    id: "claude-code", label: "Claude Code 项目技能", installTargetLabel: "Claude Code",
    note: "依赖关联项目的 MCP / Skills 配置；仅导出，不安装、不试运行。",
    targets: [{kind:"skill",label:"Claude Code 项目技能",enabled:true,note:"使用已核验的项目能力快照生成项目专用技能。",placements:["export"]}],
  },
  {
    id: "copilot-studio",
    label: "Copilot Studio",
    installTargetLabel: "Copilot Studio",
    note: "即将推出。",
    targets: [
      {
        kind: "skill",
        label: "Copilot Studio",
        enabled: false,
        note: "即将推出。",
        placements: ["export"],
      },
    ],
  },
] as const);

export type SkillArchitecture = (typeof ARCHITECTURE_MANIFEST)[number]["id"];

// The manifest validator guarantees a non-empty list; map preserves the ID union.
const architectureIds = ARCHITECTURE_MANIFEST.map(({ id }) => id) as [
  SkillArchitecture,
  ...SkillArchitecture[],
];

export const SkillArchitecture = z.enum(architectureIds);

export interface ArchitectureOption {
  id: SkillArchitecture;
  label: string;
  enabled: boolean;
  note: string;
}

export interface BuildTarget {
  kind: BuildKind;
  architecture: SkillArchitecture;
  label: string;
  enabled: boolean;
  note: string;
  placements: readonly TargetPlacement[];
  installTargetLabel: string;
}

export const ARCHITECTURES: readonly ArchitectureOption[] = ARCHITECTURE_MANIFEST.map(
  ({ id, label, note, targets }) => ({
    id,
    label,
    enabled: targets.some((target) => target.enabled),
    note,
  }),
);

/**
 * Build targets shown up front, in order. Automation support is architecture-specific,
 * so the target kind and architecture are chosen together before planning begins.
 */
export const TARGETS: readonly BuildTarget[] = ARCHITECTURE_MANIFEST.flatMap(
  ({ id, installTargetLabel, targets }) =>
    targets.map((target) => ({
      kind: target.kind,
      architecture: id,
      label: target.label,
      enabled: target.enabled,
      note: target.note,
      placements: target.placements,
      installTargetLabel,
    })),
);

export function buildTargetFor(
  architecture: SkillArchitecture,
  kind: BuildKind,
): BuildTarget {
  const target = TARGETS.find(
    (candidate) => candidate.architecture === architecture && candidate.kind === kind,
  );
  if (!target) {
    throw new Error(
      `No "${kind}" target is configured for architecture "${architecture}".`,
    );
  }
  return target;
}

export function requireTargetPlacement(
  architecture: SkillArchitecture,
  kind: BuildKind,
  placement: TargetPlacement,
): BuildTarget {
  const target = buildTargetFor(architecture, kind);
  if (!target.enabled) {
    throw new Error(`Architecture "${architecture}" target "${kind}" is not enabled.`);
  }
  if (!target.placements.includes(placement)) {
    throw new Error(
      `Architecture "${architecture}" target "${kind}" does not support "${placement}" placement.`,
    );
  }
  return target;
}

const defaultTarget = TARGETS.find((target) => target.enabled && target.architecture === "agent-skill");
if (!defaultTarget) {
  throw new Error("Architecture manifest must contain at least one enabled target.");
}
export const DEFAULT_TARGET: BuildTarget = defaultTarget;

export function enabledArchitectureLabels(
  kind: BuildKind,
  definitions: readonly ArchitectureDefinition<SkillArchitecture>[] =
    ARCHITECTURE_MANIFEST,
): string[] {
  return definitions
    .filter((definition) =>
      definition.targets.some((target) => target.kind === kind && target.enabled),
    )
    .map((definition) => definition.label);
}
