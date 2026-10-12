import {
  buildTargetFor,
  type BuildTarget,
  type SkillArchitecture,
} from "../common/architecture-registry";
import type { SkillPlacement } from "../common/ipc";

export interface SkillPlacementAction {
  placement: SkillPlacement;
  primary: boolean;
  label: string;
  title: string;
}

export interface SkillPlacementModel {
  defaultPlacement: SkillPlacement;
  actions: readonly SkillPlacementAction[];
  installDoneTitle: string;
  installDoneMessage: string;
}

export function skillTargetFor(architecture: SkillArchitecture): BuildTarget {
  return buildTargetFor(architecture, "skill");
}

export function skillPlacementModel(target: BuildTarget): SkillPlacementModel {
  if (target.placements.length === 0) {
    throw new Error(`Skill target "${target.label}" must declare at least one placement.`);
  }

  const defaultPlacement = target.placements[0];
  const placements = [...target.placements.slice(1), defaultPlacement];
  const actions = placements.map((placement) => {
    const primary = placement === defaultPlacement;
    const label =
      placement === "install"
        ? `添加到 ${target.installTargetLabel}`
        : primary
          ? "导出技能"
          : "导出…";
    const title =
      placement === "install"
        ? `将技能添加到 ${target.installTargetLabel} 以自动加载`
        : "将技能导出到所选文件夹";
    return { placement, primary, label, title };
  });

  return {
    defaultPlacement,
    actions,
    installDoneTitle: `已添加到 ${target.installTargetLabel}`,
    installDoneMessage: `已添加到 ${target.installTargetLabel}，将自动加载。`,
  };
}
