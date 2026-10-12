import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  ARCHITECTURE_MANIFEST,
  defineArchitectures,
} from "../../common/architecture-registry";
import {
  createCatalogueRegistry,
  defineCatalogueProvider,
  providersFromModules,
} from "./catalogue-provider";
import agent技能CatalogueProvider from "./catalogues/agent-skill-catalogue";
import coworkCatalogueProvider from "./catalogues/cowork-catalogue";
import scoutCatalogueProvider from "./catalogues/scout-catalogue";

const scoutProvider = defineCatalogueProvider({
  architecture: "scout",
  skill: { version: "scout-skill-v1", content: "Scout 技能 catalogue" },
  automation: {
    version: "scout-automation-v1",
    content: "Scout 自动化 catalogue",
  },
});

const coworkProvider = defineCatalogueProvider({
  architecture: "cowork",
  skill: { version: "cowork-skill-v1", content: "Cowork 技能 catalogue" },
});

const agent技能Provider = defineCatalogueProvider({
  architecture: "agent-skill",
  skill: { version: "agent-skill-v1", content: "Agent 技能 catalogue" },
});

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function providersWithScout技能(skill: unknown): readonly unknown[] {
  return [
    {
      architecture: "scout",
      skill,
      automation: scoutProvider.automation,
    },
    coworkProvider,
  ];
}

test("the registry resolves enabled catalogues and derives unavailable errors", () => {
  const registry = createCatalogueRegistry([
    scoutProvider,
    coworkProvider,
    agent技能Provider,
  ]);

  assert.deepEqual(registry.catalogueFor("scout", "skill"), scoutProvider.skill);
  assert.deepEqual(
    registry.catalogueFor("scout", "automation"),
    scoutProvider.automation,
  );
  assert.deepEqual(registry.catalogueFor("cowork", "skill"), coworkProvider.skill);
  assert.equal(registry.catalogueFor("cowork", "automation"), null);
  assert.throws(
    () => registry.requireCatalogue("cowork", "automation"),
    /That target architecture isn't available yet\. Choose Scout\./,
  );
});

test("disabled targets stay unavailable even when catalogue content is staged", () => {
  const stagedCopilotStudioProvider = defineCatalogueProvider({
    architecture: "copilot-studio",
    skill: {
      version: "copilot-studio-v1",
      content: "Copilot Studio skill catalogue",
    },
  });
  const registry = createCatalogueRegistry([
    scoutProvider,
    coworkProvider,
    agent技能Provider,
    stagedCopilotStudioProvider,
  ]);

  assert.equal(registry.catalogueFor("copilot-studio", "skill"), null);
  assert.throws(
    () => registry.requireCatalogue("copilot-studio", "skill"),
    /That target architecture isn't available yet\. Choose Scout, Cowork, or 通用智能体技能\./,
  );
});

test("the registry rejects missing, duplicate, unknown, and undeclared providers", () => {
  assert.throws(
    () => createCatalogueRegistry([scoutProvider]),
    /Enabled target "Cowork 技能" \(cowork:skill\) is missing a catalogue payload/,
  );
  assert.throws(
    () => createCatalogueRegistry([scoutProvider, scoutProvider, coworkProvider]),
    /Duplicate catalogue provider for architecture "scout"/,
  );

  const scout执行日期lyManifest = defineArchitectures([ARCHITECTURE_MANIFEST[0]]);
  assert.throws(
    () => createCatalogueRegistry([coworkProvider], scout执行日期lyManifest),
    /Unknown architecture "cowork" in catalogue provider/,
  );

  assert.throws(
    () =>
      createCatalogueRegistry([
        scoutProvider,
        {
          ...coworkProvider,
          automation: {
            version: "cowork-automation-v1",
            content: "Cowork automation catalogue",
          },
        },
      ]),
    /Architecture "cowork" does not declare target kind "automation"/,
  );
});

test("provider payloads and discovered module shapes are validated strictly", () => {
  for (const [skill, error] of [
    [
      { version: "", content: "Scout 技能 catalogue" },
      /skill\.version: must not be empty/,
    ],
    [
      { version: "scout-skill-v1", content: "   " },
      /skill\.content: must not be empty/,
    ],
  ] as const) {
    assert.throws(
      () => createCatalogueRegistry(providersWithScout技能(skill)),
      error,
    );
  }

  assert.throws(
    () => createCatalogueRegistry([{ architecture: "copilot-studio" }]),
    /must provide at least one catalogue payload/,
  );
  assert.throws(
    () =>
      createCatalogueRegistry([
        scoutProvider,
        {
          architecture: "cowork",
          skills: coworkProvider.skill,
        },
      ]),
    /Unrecognized key: "skills"/,
  );
  assert.throws(
    () => providersFromModules({ "./missing-default.catalogue.ts": {} }),
    /Invalid catalogue provider module ".\/missing-default\.catalogue\.ts"/,
  );
  assert.throws(
    () =>
      providersFromModules({
        "./unknown.catalogue.ts": {
          default: {
            architecture: "generic",
            skill: { version: "generic-v1", content: "Generic catalogue" },
          },
        },
      }),
    /Invalid catalogue provider module ".\/unknown\.catalogue\.ts"/,
  );
});

test("real providers preserve versions, content, and the support matrix", () => {
  const registry = createCatalogueRegistry([
    scoutCatalogueProvider,
    coworkCatalogueProvider,
    agent技能CatalogueProvider,
  ]);

  // These hashes prove catalogue moves are byte-for-byte. Intentional catalogue
  // changes must bump the corresponding version and update its hash here.
  const scout技能 = registry.requireCatalogue("scout", "skill");
  assert.equal(scout技能.version, "2026-08-08");
  assert.equal(
    sha256(scout技能.content),
    "36d61c25c960b12528f86c32ef3a99d0b7283a27538a334cc2c5191c269eed06",
  );
  const scout自动化 = registry.requireCatalogue("scout", "automation");
  assert.equal(scout自动化.version, "2026-08-08");
  assert.equal(
    sha256(scout自动化.content),
    "27b8e3153085cac9b8d3e255eac256d0b215819784519026837797d6a02872a0",
  );

  const cowork技能 = registry.requireCatalogue("cowork", "skill");
  assert.equal(cowork技能.version, "2026-07-28");
  assert.equal(
    sha256(cowork技能.content),
    "39ffbdf3225ce47eecd735252558cffe860eb6a207782a2f604a8a57fb9a0f68",
  );

  const agent技能技能 = registry.requireCatalogue("agent-skill", "skill");
  assert.equal(agent技能技能.version, "2026-08-06");
  assert.equal(
    sha256(agent技能技能.content),
    "27cb863efb3fe973d3b7d4e24359cf5297c1b30fdbc29c073878b57a6d5d8810",
  );
});
