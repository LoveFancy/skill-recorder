import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { getStepScreenshots } from "./step-screenshots";

test("step screenshots select bounded chronological samples and reject escaped files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "step-shots-"));
  const previous = process.env.SKILL_RECORDER_SESSIONS_DIR;
  process.env.SKILL_RECORDER_SESSIONS_DIR = root;
  try {
    const dir = path.join(root, "session");
    await mkdir(path.join(dir, "video-frames"), { recursive: true });
    await writeFile(path.join(dir, "session.json"), JSON.stringify({ startedAt: 10000 }));
    const jpeg = await sharp({ create: { width: 20, height: 10, channels: 3, background: "red" } }).jpeg().toBuffer();
    const frames = [];
    for (let i=0; i<5; i++) {
      const file = `video-frames/${i}.jpg`;
      await writeFile(path.join(dir, file), jpeg);
      frames.push({ file, tMs: 10000+i*1000 });
    }
    const manifest = path.join(dir, "video-frames.json");
    await writeFile(manifest, JSON.stringify({ frames }));
    assert.deepEqual((await getStepScreenshots("session", 0, 4000)).map(f => f.timeMs), [0,2000,4000]);
    await mkdir(path.join(dir,"frames"),{recursive:true});
    await writeFile(path.join(dir,"frames/frames.json"),JSON.stringify([{file:"reviewed.jpg",tMs:12000}]));
    assert.deepEqual((await getStepScreenshots("session",0,4000,["frames/reviewed.jpg"])).map(f=>f.timeMs),[0,1000,4000],"discard reviewed image before selecting replacement screenshots");
    assert.deepEqual((await getStepScreenshots("session",0,4000,["frames/unknown.jpg","../video-frames/0.jpg"])).map(f=>f.timeMs),[0,2000,4000],"unknown paths must not hide other images");
    assert.ok((await readFile(path.join(dir,"video-frames/2.jpg"))).length,"original remains recoverable");
    assert.equal((await getStepScreenshots("session", 1000, 1000)).length, 1);
    const region = { x:0.1,y:0.2,width:0.3,height:0.4 };
    await writeFile(path.join(dir,"events.jsonl"), JSON.stringify({ type:"marker",epoch:11000,payload:{ region,note:"重点" } })+"\n");
    const annotated = await getStepScreenshots("session", 0, 4000);
    assert.deepEqual(annotated.find(f => f.timeMs === 1000)?.regions,[region]);
    assert.deepEqual(await getStepScreenshots("session"), []);
    assert.deepEqual(await getStepScreenshots("session", 6000, 7000), []);
    await assert.rejects(getStepScreenshots("../session", 0, 4000));
    await writeFile(path.join(root, "outside.jpg"), jpeg);
    await symlink(path.join(root, "outside.jpg"), path.join(dir, "video-frames/escape.jpg"));
    await writeFile(manifest, JSON.stringify({ frames: [{ file: "video-frames/escape.jpg", tMs: 10000 }] }));
    await assert.rejects(getStepScreenshots("session", 0, 1000), /截图路径/);
  } finally {
    if (previous === undefined) delete process.env.SKILL_RECORDER_SESSIONS_DIR;
    else process.env.SKILL_RECORDER_SESSIONS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("saved region and click screenshots survive without any video manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "annotation-shots-"));
  const previous = process.env.SKILL_RECORDER_SESSIONS_DIR;
  process.env.SKILL_RECORDER_SESSIONS_DIR = root;
  try {
    const dir = path.join(root,"session");
    await mkdir(path.join(dir,"frames"),{recursive:true});
    await writeFile(path.join(dir,"session.json"),JSON.stringify({startedAt:10000}));
    const png = await sharp({create:{width:100,height:100,channels:3,background:"orange"}}).png().toBuffer();
    const events = [];
    for (let i=0;i<4;i++) {
      const screenshot = `frames/annotation_${i}.png`;
      await writeFile(path.join(dir,screenshot),png);
      events.push({type:"marker",epoch:11000+i*100,payload:{screenshot,capturedAt:10500, ...(i%2 ? {click:{x:0.5,y:0.5}} : {region:{x:0.1,y:0.1,width:0.5,height:0.5}})}});
    }
    await writeFile(path.join(dir,"events.jsonl"),events.map(e=>JSON.stringify(e)).join("\n"));
    const screenshots = await getStepScreenshots("session",0,2000);
    assert.equal(screenshots.length,4,"all explicitly annotated images must be retained");
    assert.deepEqual(screenshots.map(s=>s.timeMs),[1000,1100,1200,1300]);
    assert.ok(screenshots.every(s=>s.regions.length===0),"baked-in boxes must not be duplicated");
    assert.ok(screenshots.every(s=>s.dataUrl.startsWith("data:image/jpeg;base64,")));
  } finally {
    if (previous === undefined) delete process.env.SKILL_RECORDER_SESSIONS_DIR;
    else process.env.SKILL_RECORDER_SESSIONS_DIR = previous;
    await rm(root,{recursive:true,force:true});
  }
});
