import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_TARGET, TARGETS } from "../common/skill";
import { skillPlacementModel, skillTargetFor } from "./skill-placement";

test("placement model preserves Scout and Cowork action ordering", () => {
  assert.equal(DEFAULT_TARGET.architecture, "agent-skill");
  assert.equal(skillPlacementModel(skillTargetFor(DEFAULT_TARGET.architecture)).defaultPlacement, "export");
  const defaultSkill = skillPlacementModel(skillTargetFor("scout"));
  assert.equal(defaultSkill.defaultPlacement, "install");
  assert.deepEqual(
    defaultSkill.actions.map(({ placement, primary, label }) => [placement, primary, label]),
    [
      ["export", false, "导出…"],
      ["install", true, "添加到 Scout"],
    ],
  );
  assert.equal(defaultSkill.installDoneTitle, "已添加到 Scout");
  assert.equal(defaultSkill.installDoneMessage, "已添加到 Scout，将自动加载。");

  const exportOnlyTarget = TARGETS.find(
    (target) =>
      target.kind === "skill" &&
      target.enabled &&
      target.placements.length === 1 &&
      target.placements[0] === "export" &&
      target.architecture !== DEFAULT_TARGET.architecture,
  );
  assert.ok(exportOnlyTarget);

  const exportOnly = skillPlacementModel(skillTargetFor(exportOnlyTarget.architecture));
  assert.equal(exportOnly.defaultPlacement, "export");
  assert.deepEqual(
    exportOnly.actions.map(({ placement, primary, label }) => [placement, primary, label]),
    [["export", true, "导出技能"]],
  );
});
