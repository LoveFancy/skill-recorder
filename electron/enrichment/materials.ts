import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { sessionDir } from "../recorder/session-store";
import type { FrameRedactor } from "../sensitive/frame-redact";
import { redactIncremental } from "./privacy";
import { fingerprint } from "./store";

/** Export source coverage explicitly; missing/withheld material is never reported as zero events. */
export async function recordingMaterials(id: string, redactor?: FrameRedactor) {
  const dir = realpathSync(sessionDir(id));
  const files: { name: string; content: string; hash: string }[] = [];
  const omitted: { name: string; reason: string }[] = [];
  const safeFile = (name: string) => {
    const file = realpathSync(path.join(dir, name));
    const relative = path.relative(dir, file);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !relative)
      throw new Error("材料路径超出会话目录。");
    return file;
  };
  for (const name of [
    "session.json",
    "bundle.json",
    "analysis.json",
    "analysis.md",
    "audio.json",
    "narration.json",
    "video.json",
    "video-frames.json",
    "frames/frames.json",
    "events.jsonl",
  ]) {
    if (!existsSync(path.join(dir, name))) {
      omitted.push({ name, reason: "未采集或文件缺失" });
      continue;
    }
    const file = safeFile(name);
    if (statSync(file).size > 512000) {
      omitted.push({
        name,
        reason: "超过单份文本上下文上限；原文件仅在本机保留，需用户按范围补充",
      });
      continue;
    }
    const content = await redactIncremental(readFileSync(file, "utf8"));
    files.push({ name, content, hash: fingerprint(content) });
  }
  const images: {
    name: string;
    dataUrl: string;
    hash: string;
    capturedAt: number | null;
  }[] = [];
  const index = path.join(dir, "frames", "frames.json");
  if (existsSync(index)) {
    const frames = JSON.parse(
      readFileSync(safeFile("frames/frames.json"), "utf8"),
    ) as { file: string; tMs?: number }[];
    const chosen = frames
      .filter((_, i) => i % Math.max(1, Math.ceil(frames.length / 12)) === 0)
      .slice(0, 12);
    for (const frame of chosen) {
      const name = path.posix.join("frames", frame.file);
      if (!redactor?.active || !redactor.ready) {
        omitted.push({ name, reason: "截图脱敏不可用，未导出原始图片" });
        continue;
      }
      const bytes = await redactor.redactFrame(safeFile(name));
      if (!bytes) {
        omitted.push({ name, reason: "截图脱敏未成功，未导出" });
        continue;
      }
      images.push({
        name,
        dataUrl: "data:image/jpeg;base64," + bytes.toString("base64"),
        hash: fingerprint(bytes.toString("base64")),
        capturedAt: frame.tMs ?? null,
      });
    }
    if (frames.length > chosen.length)
      omitted.push({
        name: "frames/",
        reason: `采用 ${chosen.length}/${frames.length} 张均匀采样；其余图片保留在本机，未随包导出`,
      });
  }
  return { files, images, omitted, privacy: "redacted" as const };
}
