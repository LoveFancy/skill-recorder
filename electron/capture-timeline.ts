import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sessionDir } from './recorder/session-store';
import type { CaptureTimeline } from '../common/ipc';
export async function getCaptureTimeline(id:string):Promise<CaptureTimeline>{
  const dir=sessionDir(id);
  const json=async(name:string)=>{try{return JSON.parse(await readFile(path.join(dir,name),'utf8'));}catch{return null;}};
  const [meta,frames,voice]=await Promise.all([json('session.json'),json('video-frames.json'),json('narration.json')]);
  let lines:string[]=[];try{lines=(await readFile(path.join(dir,'events.jsonl'),'utf8')).split('\n');}catch{}
  const browser:CaptureTimeline['browser']=[];
  for(const line of lines){try{const e=JSON.parse(line);if(e.type==='browser.action'){const t=e.payload.capturedAt-meta.startedAt;if(Number.isFinite(t)&&t>=0)browser.push({atMs:t,kind:e.payload.action,summary:String(e.payload.element?.redacted?"敏感字段（内容已隐藏）":e.payload.element?.name||e.payload.element?.text||e.payload.title||"页面操作").slice(0,160)});}}catch{}}
  const samples=Array.isArray(frames)?frames:frames?.frames??[];
  return {durationMs:Math.max(1,(meta?.stoppedAt??meta?.startedAt??0)-(meta?.startedAt??0)),frames:samples.map((f:any)=>Number.isFinite(f.tMs)&&Number.isFinite(meta?.startedAt)?f.tMs-meta.startedAt:f.offsetMs).filter((t:unknown)=>typeof t==="number"&&Number.isFinite(t)&&t>=0),voice:(voice?.segments??[]).filter((s:any)=>Number.isFinite(s.atMs)&&Number.isFinite(s.endMs)).map((s:any)=>({atMs:s.atMs,endMs:s.endMs,text:String(s.text??"").slice(0,4000)})),browser};
}
