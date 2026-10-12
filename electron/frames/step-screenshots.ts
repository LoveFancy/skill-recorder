import { isCaptureRegion } from "../../common/capture-region";
import type { RecEvent } from "../../common/types";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { sessionDir, sessionsRoot } from "../recorder/session-store";

export async function getStepScreenshots(id: string, start?: number, end?: number) {
  if (!Number.isFinite(start)) return [];
  const root = await realpath(sessionsRoot());
  const dir = await realpath(sessionDir(id));
  const inside = (base: string, file: string) => {
    const relative = path.relative(base, file);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  };
  if (!inside(root, dir)) throw new Error("无效的录制目录");
  const readJson = async (file: string) => {
    const resolved = await realpath(path.join(dir, file));
    if (!inside(dir, resolved)) throw new Error("无效的截图路径");
    return JSON.parse(await readFile(resolved, "utf8"));
  };
  const session = await readJson("session.json");
  let frames: { file: string; tMs: number }[];
  try { frames = (await readJson("video-frames.json")).frames; }
  catch { try { frames = (await readJson("frames/frames.json")).map((f: { file: string; tMs: number }) => ({ ...f, file: `frames/${f.file}` })); } catch { frames = []; } }
  // Current analyses use session-relative milliseconds; accept legacy epoch spans too.
  const from = start! > 1e12 ? start! : session.startedAt + start!;
  const until = Number.isFinite(end) ? (end! > 1e12 ? end! : session.startedAt + end!) : from;
  let candidates = frames.filter(f => Number.isFinite(f.tMs) && f.tMs >= from-250 && f.tMs <= Math.max(from, until)+250).sort((a,b) => a.tMs-b.tMs);
  let annotations: RecEvent[] = [];
  try {
    const eventsFile = await realpath(path.join(dir, "events.jsonl"));
    if (inside(dir, eventsFile)) annotations = (await readFile(eventsFile, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line)).filter(event => event.type === "marker" && (isCaptureRegion(event.payload?.region) || typeof event.payload?.screenshot === "string"));
  } catch { /* Older sessions have no region annotations. */ }
  const saved = annotations.filter(a => a.epoch >= from-250 && a.epoch <= Math.max(from,until)+250 && typeof a.payload.screenshot === "string").map(a => ({file:a.payload.screenshot as string,tMs:a.epoch}));
  candidates = [...saved, ...candidates];
  const selected = candidates.length <= 3 ? candidates : [candidates[0], candidates[Math.floor((candidates.length-1)/2)], candidates[candidates.length-1]];
  const annotated = annotations.filter(a => a.epoch >= from && a.epoch <= until).map(a => candidates.find(f => f.tMs >= a.epoch && f.tMs-a.epoch <= 5000)).filter((f): f is { file:string; tMs:number } => !!f);
  const previews = [...new Map([...saved, ...annotated, ...selected].map(f => [f.file,f])).values()].slice(0,Math.max(3,saved.length)).sort((a,b) => a.tMs-b.tMs);
  return Promise.all(previews.map(async f => {
    if (typeof f.file !== "string" || !/^(video-frames|frames)\/[A-Za-z0-9_.-]+\.(jpg|jpeg|png)$/.test(f.file)) throw new Error("无效的截图路径");
    const file = await realpath(path.join(dir, f.file));
    if (!inside(dir, file)) throw new Error("无效的截图路径");
    const bytes = await sharp(file).resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
    return { regions: annotations.filter(a => !a.payload.screenshot && f.tMs >= a.epoch && f.tMs-a.epoch <= 5000).map(a => a.payload.region).filter(isCaptureRegion), timeMs: f.tMs-session.startedAt, dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}` };
  }));
}
