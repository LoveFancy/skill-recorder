import type { AsrPipeline } from "./sensevoice";
import { SENSEVOICE_LANGUAGES } from "../../common/narration";

/** In-memory, 16 kHz mono dictation. Never creates a recording session or audio file. */
export async function transcribeIntentAudio(
  samples: unknown,
  language: string,
  load: () => Promise<AsrPipeline>,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  if (!(samples instanceof Float32Array) || samples.length < 1600 || samples.length > 16000 * 60 ||
      samples.some(value => !Number.isFinite(value) || Math.abs(value) > 1)) {
    return { ok: false, error: "语音数据无效，请录制 0.1 至 60 秒的语音。" };
  }
  if (!SENSEVOICE_LANGUAGES.some(item => item.code === language)) {
    return { ok: false, error: "请在语音设置中选择中文、粤语、英语、日语或韩语。" };
  }
  try {
    const pipe = await load();
    const { text } = await pipe(samples, { language });
    const trimmed = text.trim();
    return trimmed ? { ok: true, text: trimmed } : { ok: false, error: "没有识别到语音，请靠近麦克风重试。" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "语音转写失败，请重试。" };
  }
}
