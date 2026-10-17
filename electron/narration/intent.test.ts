import assert from "node:assert/strict";
import test from "node:test";
import { transcribeIntentAudio } from "./intent";

test("dictation passes PCM and selected language to ASR and trims its result", async () => {
  const samples = new Float32Array(16000).fill(0.1);
  const result = await transcribeIntentAudio(samples, "zh", async () => async (audio, options) => {
    assert.equal(audio, samples);
    assert.equal(options?.language, "zh");
    return { text: "  根据订单准备报价单。  " };
  });
  assert.deepEqual(result, { ok: true, text: "根据订单准备报价单。" });
});

test("invalid, oversized, non-finite audio and unsupported languages never load a model", async () => {
  const load = async (): Promise<never> => { assert.fail("invalid request loaded a model"); };
  for (const audio of [[], new Float32Array(1), new Float32Array(960001), new Float32Array(1600).fill(NaN), new Float32Array(1600).fill(2)]) {
    assert.equal((await transcribeIntentAudio(audio, "zh", load)).ok, false);
  }
  assert.equal((await transcribeIntentAudio(new Float32Array(1600), "fr", load)).ok, false);
});

test("silence and inference failures return actionable errors", async () => {
  assert.match((await transcribeIntentAudio(new Float32Array(1600), "zh", async () => async () => ({ text: " " }))).error!, /没有识别到语音/);
  assert.deepEqual(await transcribeIntentAudio(new Float32Array(1600), "en", async () => { throw new Error("模型尚未下载"); }),
    { ok: false, error: "模型尚未下载" });
});
