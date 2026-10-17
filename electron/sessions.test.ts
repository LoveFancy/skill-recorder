import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { deleteSession, listSessions } from "./sessions";
import { toAnalysis } from "../common/analysis";

test("legacy audio timestamps do not mark existing narration as newly added; later transcripts remain stale", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "narration-version-"));
  const prior = process.env.SKILL_RECORDER_SESSIONS_DIR;
  process.env.SKILL_RECORDER_SESSIONS_DIR = root;
  try {
    const id = "narration-version";
    const dir = path.join(root, id);
    await mkdir(dir);
    await writeFile(path.join(dir, "session.json"), JSON.stringify({id, startedAt:1000, stoppedAt:2000}));
    await writeFile(path.join(dir, "audio.json"), "{}");
    await utimes(path.join(dir, "audio.json"), 100, 100);
    const narrationFile = path.join(dir, "narration.json");
    await writeFile(narrationFile, JSON.stringify({segments:[{atMs:0,endMs:1000,text:"保存报价单"}]}));
    await utimes(narrationFile, 101, 101);
    const analysis = toAnalysis(id, 1, {title:"报价",intent:"保存报价单",intentConfidence:"high",intentRationale:"录制旁白",steps:[]}, [], (await stat(path.join(dir,"audio.json"))).mtimeMs);
    await writeFile(path.join(dir, "analysis.json"), JSON.stringify(analysis));
    const [existing] = await listSessions();
    assert.equal(existing.analysis?.narrationSourceUpdatedAt, existing.narrationUpdatedAt);
    await utimes(narrationFile, (analysis.createdAt + 10000)/1000, (analysis.createdAt + 10000)/1000);
    const [updated] = await listSessions();
    assert.ok(updated.narrationUpdatedAt! > updated.analysis!.narrationSourceUpdatedAt!);
  } finally {
    if (prior === undefined) delete process.env.SKILL_RECORDER_SESSIONS_DIR;
    else process.env.SKILL_RECORDER_SESSIONS_DIR = prior;
    await rm(root, {recursive:true, force:true});
  }
});

test("session size includes every artifact and deletion removes the whole directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-recorder-sessions-"));
  const previousRoot = process.env.SKILL_RECORDER_SESSIONS_DIR;
  process.env.SKILL_RECORDER_SESSIONS_DIR = root;

  try {
    const id = "storage-test";
    const dir = path.join(root, id);
    await mkdir(path.join(dir, "video-frames"), { recursive: true });
    await mkdir(path.join(dir, "frames"), { recursive: true });
    await mkdir(path.join(dir, "audio"), { recursive: true });

    const artifacts: [string, string | Uint8Array][] = [
      ["session.json", JSON.stringify({ id, startedAt: 1_000, stoppedAt: 2_000 })],
      ["video.webm", Buffer.alloc(17, 1)],
      [
        "audio.json",
        JSON.stringify({
          version: 2,
          segments: [{ file: "audio/segment-0001.webm" }, { file: "audio/segment-0002.webm" }],
        }),
      ],
      [path.join("audio", "segment-0001.webm"), Buffer.alloc(19, 2)],
      [path.join("audio", "segment-0002.webm"), Buffer.alloc(13, 2)],
      [path.join("video-frames", "frame_000001.jpg"), Buffer.alloc(23, 3)],
      [path.join("frames", "event_1000.jpg"), Buffer.alloc(29, 4)],
    ];
    for (const [file, data] of artifacts) await writeFile(path.join(dir, file), data);

    const [summary] = await listSessions();
    const expectedBytes = artifacts.reduce(
      (sum, [, data]) => sum + (typeof data === "string" ? Buffer.byteLength(data) : data.byteLength),
      0,
    );
    assert.equal(summary?.sizeBytes, expectedBytes);
    assert.equal(summary?.hasAudio, true);
    assert.equal(summary?.narrationLanguage, "en");

    await deleteSession(id);
    await assert.rejects(access(dir), { code: "ENOENT" });
  } finally {
    if (previousRoot === undefined) delete process.env.SKILL_RECORDER_SESSIONS_DIR;
    else process.env.SKILL_RECORDER_SESSIONS_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});
