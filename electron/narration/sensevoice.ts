import { existsSync, statSync } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { app } from "electron";
import { SENSEVOICE_LANGUAGES } from "../../common/narration";
import { detectSilence } from "./audio-analysis";

export const NARRATION_MODEL_ID = "SenseVoiceSmall-INT8";
export const LEGACY_NARRATION_MODEL_ID = "Xenova/whisper-small.en";
export const NARRATION_MODEL_FILES = ["model.int8.onnx", "tokens.txt"] as const;
export const MODEL_REPOSITORY = "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17";
const REVISION = "2365baeacb507f821a0c8120fcee3d484dba7a07";
export const MODEL_ARTIFACTS = [
  { file:"model.int8.onnx", size:239233841, sha256:"c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51" },
  { file:"tokens.txt", size:315894, sha256:"f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc" },
] as const;
export interface ModelLoadProgress { status:string; file?:string; progress?:number; loaded?:number; total?:number }
export interface ModelLoadOptions { allowDownload:boolean; onProgress?:(progress:ModelLoadProgress)=>void }
export type AsrPipeline = (audio:Float32Array, options?:{ language?:string }) => Promise<{ text:string; chunks?:Array<{ timestamp:[number,number|null]; text:string }> }>;
export function narrationModelId() { return NARRATION_MODEL_ID; }
export function narrationModelCacheDir() { return process.env.SKILL_RECORDER_MODELS_DIR ? path.resolve(process.env.SKILL_RECORDER_MODELS_DIR) : path.join(app.getPath("userData"),"models"); }
export function isNarrationModelCachedAt(cacheDir:string, modelId=NARRATION_MODEL_ID) {
  const root=path.join(cacheDir,...modelId.split("/"));
  return MODEL_ARTIFACTS.every(f=> { try { const stat=statSync(path.join(root,f.file)); return stat.isFile() && stat.size===f.size; } catch { return false; } });
}
export function isNarrationModelCached() { return isNarrationModelCachedAt(narrationModelCacheDir()); }
// Keep existing recordings and multilingual Whisper assets; remove only the already-obsolete English cache.
export async function removeLegacyNarrationModelCache(cacheDir=narrationModelCacheDir()) { await rm(path.join(cacheDir,...LEGACY_NARRATION_MODEL_ID.split("/")),{recursive:true,force:true}); }

export async function downloadSenseVoiceModel(root:string, onProgress?:ModelLoadOptions["onProgress"]) {
  await mkdir(root,{recursive:true});
  const total=MODEL_ARTIFACTS.reduce((sum,f)=>sum+f.size,0);
  let completed=0;
  for(const artifact of MODEL_ARTIFACTS) {
    const final=path.join(root,artifact.file);
    if(existsSync(final) && statSync(final).size===artifact.size){ completed+=artifact.size;continue; }
    let success=false;
    for(const host of ["https://hf-mirror.com", "https://huggingface.co"]) {
      const temp=`${final}.tmp.${process.pid}.${Date.now()}`;
      let handle;
      try {
        const response=await fetch(`${host}/${MODEL_REPOSITORY}/resolve/${REVISION}/${artifact.file}`,{signal:AbortSignal.timeout(600_000)});
        if(!response.ok || !response.body)throw new Error(`HTTP ${response.status}`);
        handle=await open(temp,"wx");
        const hash=createHash("sha256"); let received=0;
        for await(const chunk of response.body) {
          received+=chunk.byteLength;
          if(received>artifact.size)throw new Error("下载文件超过预期大小");
          hash.update(chunk);await handle.writeFile(chunk);
          onProgress?.({status:"progress_total",file:artifact.file,loaded:completed+received,total,progress:(completed+received)/total*100});
        }
        await handle.close();handle=undefined;
        if(received!==artifact.size || hash.digest("hex")!==artifact.sha256)throw new Error("SenseVoice 模型文件校验失败");
        await rename(temp,final);success=true;break;
      } catch(error) {
        if(host==="https://huggingface.co")throw new Error(`无法下载 SenseVoice：${error instanceof Error ? error.message : String(error)}`);
      } finally { await handle?.close();await rm(temp,{force:true}); }
    }
    if(!success)throw new Error("SenseVoice 下载失败");
    completed+=artifact.size;
  }
  onProgress?.({status:"progress_total",progress:100,loaded:total,total});
}

/** Speech spans use silence boundaries, with a 25-second bound to keep memory predictable. */
export function senseVoiceSpeechSpans(audio:Float32Array): Array<[number,number]> {
  const duration=audio.length/16000, silence=detectSilence(audio), spans:Array<[number,number]>=[];
  let cursor=0;
  const add=(start:number,end:number) => {
    if(end-start<0.15)return;
    while(end-start>25){spans.push([start,start+25]);start+=25;}
    if(end-start>=0.15)spans.push([start,end]);
  };
  for(const gap of silence) { add(cursor,gap.start);cursor=gap.end; }
  add(cursor,duration);return spans;
}
interface Recognizer {
  createStream():{ acceptWaveform(input:{samples:Float32Array;sampleRate:number}):void };
  decodeAsync(stream:unknown):Promise<void>;
  getResult(stream:unknown):{text:string};
}
let loadedPipe:AsrPipeline|null=null;
let pipePromise:Promise<AsrPipeline>|null=null;
async function build(options:ModelLoadOptions):Promise<AsrPipeline> {
  const root=path.join(narrationModelCacheDir(),NARRATION_MODEL_ID);
  if(!isNarrationModelCached()) {
    if(!options.allowDownload)throw new Error("SenseVoice Small INT8 尚未下载，请先下载语音模型");
    await downloadSenseVoiceModel(root,options.onProgress);
  }
  const require=createRequire(import.meta.url);
  const sherpa=require("sherpa-onnx-node") as { OfflineRecognizer:{createAsync(config:unknown):Promise<Recognizer>} };
  const recognizers=new Map<string,Recognizer>();
  const getRecognizer=async(language:string) => {
    if(!SENSEVOICE_LANGUAGES.some(item=>item.code===language))throw new Error("SenseVoice 支持中文、粤语、英语、日语和韩语；请调整旁白语言");
    let recognizer=recognizers.get(language);
    if(!recognizer) {
      recognizer=await sherpa.OfflineRecognizer.createAsync({featConfig:{sampleRate:16000,featureDim:80},modelConfig:{senseVoice:{model:path.join(root,"model.int8.onnx"),language,useInverseTextNormalization:1},tokens:path.join(root,"tokens.txt"),numThreads:2,provider:"cpu",debug:0},decodingMethod:"greedy_search"});
      recognizers.set(language,recognizer);
    }
    return recognizer;
  };
  await getRecognizer("zh");
  return async(audio,opts) => {
    const recognizer=await getRecognizer(opts?.language ?? "zh");
    const chunks:Array<{timestamp:[number,number];text:string}>=[];
    for(const [start,end] of senseVoiceSpeechSpans(audio)) {
      const stream=recognizer.createStream();
      stream.acceptWaveform({samples:audio.subarray(Math.floor(start*16000),Math.ceil(end*16000)),sampleRate:16000});
      await recognizer.decodeAsync(stream);
      const text=recognizer.getResult(stream).text.replace(/<\|[^|]*\|>/g,"").trim();
      if(text)chunks.push({timestamp:[start,end],text});
    }
    return {text:chunks.map(c=>c.text).join(opts?.language === "en" || opts?.language === "ko" ? " " : ""),chunks};
  };
}
export async function getAsrPipeline(options:ModelLoadOptions):Promise<AsrPipeline> {
  if(loadedPipe)return loadedPipe;
  if(!pipePromise)pipePromise=build(options);
  try { loadedPipe=await pipePromise;return loadedPipe; } finally { pipePromise=null; }
}
