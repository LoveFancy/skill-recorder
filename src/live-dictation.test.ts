import assert from "node:assert/strict";
import test from "node:test";
import { LiveDictation } from "./live-dictation";

test("previews serialize recognition and final pass drains audio received during inference", async () => {
  const lengths:number[] = [], texts:string[] = [];
  let resolve!: (value:{ok:boolean;text:string}) => void;
  const session = new LiveDictation(audio => {
    lengths.push(audio.length);
    return lengths.length === 1 ? new Promise(done => {resolve=done;}) : Promise.resolve({ok:true,text:"完整句子"});
  }, text => texts.push(text));
  session.add(new Float32Array(16000));
  const first = session.preview();
  session.add(new Float32Array(8000));
  await session.preview();
  assert.deepEqual(lengths,[16000]);
  const final = session.finish();
  resolve({ok:true,text:"完整"});
  await first; await final;
  assert.deepEqual(lengths,[16000,24000]);
  assert.deepEqual(texts,["完整","完整句子"]);
  await session.preview();
  assert.equal(lengths.length,2);
});

test("silence previews are ignored; final silence and inference errors are surfaced", async () => {
  const silent = new LiveDictation(async()=>({ok:false,error:"没有识别到语音"}),()=>assert.fail());
  silent.add(new Float32Array(16000));
  await silent.preview();
  await assert.rejects(silent.finish(),/没有识别到语音/);
  const broken = new LiveDictation(async()=>({ok:false,error:"模型不可用"}),()=>assert.fail());
  broken.add(new Float32Array(16000));
  await assert.rejects(broken.preview(),/模型不可用/);
});

test("dictation bounds PCM to 60 seconds", async () => {
  const session = new LiveDictation(async audio=>{
    assert.equal(audio.length,960000);
    return {ok:true,text:"长语音"};
  },()=>undefined);
  session.add(new Float32Array(1000000));
  await session.finish();
});
