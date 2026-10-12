import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile, truncate, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isNarrationModelCachedAt,
  LEGACY_NARRATION_MODEL_ID,
  MODEL_ARTIFACTS,
  downloadSenseVoiceModel,
  senseVoiceSpeechSpans,
  NARRATION_MODEL_ID,
  removeLegacyNarrationModelCache,
} from "./sensevoice";

async function seedModel(cacheDir: string, modelId: string): Promise<string> {
  const modelDir = path.join(cacheDir, ...modelId.split("/"));
  for (const artifact of MODEL_ARTIFACTS) {
    const file = path.join(modelDir, artifact.file);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "");
    await truncate(file, artifact.size);
  }
  return modelDir;
}

test("cache detection selects the SenseVoice INT8 model rather than the legacy English model", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-recorder-models-"));
  try {
    assert.equal(NARRATION_MODEL_ID, "SenseVoiceSmall-INT8");
    await seedModel(root, LEGACY_NARRATION_MODEL_ID);
    assert.equal(isNarrationModelCachedAt(root), false);

    await seedModel(root, NARRATION_MODEL_ID);
    assert.equal(isNarrationModelCachedAt(root), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy model cleanup retains the SenseVoice cache", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-recorder-models-"));
  try {
    const legacyDir = await seedModel(root, LEGACY_NARRATION_MODEL_ID);
    await seedModel(root, NARRATION_MODEL_ID);

    await removeLegacyNarrationModelCache(root);

    assert.equal(isNarrationModelCachedAt(root), true);
    await assert.rejects(access(legacyDir), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SenseVoice segments speech around silence and bounds long audio", () => {
  const audio = new Float32Array(64000).fill(0.1);
  audio.fill(0,16000,48000);
  assert.deepEqual(senseVoiceSpeechSpans(audio),[[0,1],[3,4]]);
  assert.deepEqual(senseVoiceSpeechSpans(new Float32Array(16000)),[]);
  assert.deepEqual(senseVoiceSpeechSpans(new Float32Array(60*16000).fill(0.1)),[[0,25],[25,50],[50,60]]);
});
test("SenseVoice rejects incomplete downloads without leaving ready files", async () => {
  const root = await mkdtemp(path.join(tmpdir(),"sensevoice-download-"));
  const previous = globalThis.fetch;
  let requests=0;
  globalThis.fetch = async () => { requests++; return new Response(new Uint8Array([1,2,3])); };
  try {
    await assert.rejects(downloadSenseVoiceModel(root),/校验失败/);
    assert.equal(requests,2);
    assert.deepEqual(await readdir(root),[]);
    assert.equal(isNarrationModelCachedAt(root),false);
  } finally { globalThis.fetch=previous;await rm(root,{recursive:true,force:true}); }
});

test("bundled offline model is selected when user cache is empty", async () => {
  const { resolveNarrationModelRoot } = await import("./sensevoice");
  const root = await mkdtemp(path.join(tmpdir(), "sensevoice-bundled-"));
  try {
    const resources = path.join(root, "resources");
    await seedModel(path.join(resources, "models"), NARRATION_MODEL_ID);
    assert.equal(resolveNarrationModelRoot(path.join(root,"cache"), resources),path.join(resources,"models",NARRATION_MODEL_ID));
  } finally { await rm(root,{recursive:true,force:true}); }
});
