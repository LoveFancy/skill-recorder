import {useEffect,useState} from 'react';
import type {CaptureTimeline as Data} from '../common/ipc';
export function CaptureTimeline({sessionId,hasAudio,hasVideo,busy}:{sessionId:string;hasAudio:boolean;hasVideo:boolean;busy:boolean}){
  const [preview,setPreview]=useState<{title:string;text?:string;image?:string;loading?:boolean}|null>(null);
  const [hoverKey,setHoverKey]=useState<string|null>(null);
  const [data,setData]=useState<Data|null>(null);
  useEffect(()=>{let live=true;const refresh=()=>window.skillRecorder.captureTimeline(sessionId).then(d=>{if(live)setData(d);}).catch(()=>{});void refresh();const timer=busy?setInterval(refresh,2000):null;return()=>{live=false;if(timer)clearInterval(timer);};},[sessionId,busy]);
  useEffect(()=>{setPreview(null);setHoverKey(null);},[sessionId]);
  useEffect(()=>{
    if(!hoverKey?.startsWith('screen:'))return;
    let live=true;const at=Number(hoverKey.split(':')[1]);
    void window.skillRecorder.stepScreenshots(sessionId,at,at).then(frames=>{
      if(live)setPreview(previous=>previous?{...previous,loading:false,image:frames.sort((a,b)=>Math.abs(a.timeMs-at)-Math.abs(b.timeMs-at))[0]?.dataUrl,text:frames.length?undefined:'此采样点没有可用截图'}:null);
    }).catch(()=>{if(live)setPreview(previous=>previous?{...previous,loading:false,text:'截图加载失败'}:null);});
    return()=>{live=false;};
  },[hoverKey,sessionId]);
  if(!data)return null;
  const percent=(ms:number)=>Math.max(0,Math.min(100,ms/data.durationMs*100));
  const time=(ms:number)=>`${(ms/1000).toFixed(1)} 秒`;
  const rows=[{label:'语音',color:'voice',items:data.voice.map(s=>({at:s.atMs,end:s.endMs,title:`语音片段 ${time(s.atMs)}–${time(s.endMs)}`,text:s.text})),empty:hasAudio?'等待转写片段':'未开启'},
    {label:'录屏',color:'screen',items:data.frames.map(at=>({at,end:at,title:`截图采样 ${time(at)}`,text:undefined})),empty:hasVideo?'等待截图采样':'未开启'},
    {label:'浏览器',color:'browser',items:data.browser.map(e=>({at:e.atMs,end:e.atMs,title:`${({click:'点击',input:'输入',change:'选择变化',submit:'提交',navigation:'导航',scroll:'滚动'} as Record<string,string>)[e.kind]??e.kind} · ${time(e.atMs)}`,text:e.summary})),empty:'无操作数据'}];
  return <section className="capture-timeline" onMouseLeave={()=>{setHoverKey(null);setPreview(null);}} aria-label="采集证据时间线"><div className="capture-timeline-heading"><strong>采集时间线</strong><span>录制时长 {time(data.durationMs)}</span></div>
    {rows.map(row=><div className="capture-timeline-row" key={row.label}><span>{row.label}</span><div className={`capture-timeline-track ${row.color}`}>
      {row.label==='录屏'&&hasVideo&&<div className="capture-video-coverage" title="录屏已保存；覆盖范围以实际视频为准"/>}
      {row.items.map((item,i)=><button type="button" key={i} className="capture-timeline-mark" aria-label={item.title} onMouseEnter={()=>{if(hoverKey!==`${row.color}:${item.at}`){setHoverKey(`${row.color}:${item.at}`);setPreview({title:item.title,text:item.text,loading:row.color==='screen'});}}} onFocus={()=>{if(hoverKey!==`${row.color}:${item.at}`){setHoverKey(`${row.color}:${item.at}`);setPreview({title:item.title,text:item.text,loading:row.color==='screen'});}}} onBlur={()=>{setHoverKey(null);setPreview(null);}} style={{left:`${percent(item.at)}%`,width:item.end>item.at?`${Math.max(.3,percent(item.end)-percent(item.at))}%`:3}}/>)}
      {!row.items.length&&<span className="capture-timeline-empty">{row.empty}</span>}
    </div><span className="capture-timeline-count">{row.items.length}</span></div>)}
    <div className="capture-timeline-axis"><span>0 秒</span><span>{time(data.durationMs/2)}</span><span>{time(data.durationMs)}</span></div>
    {preview&&<div className="capture-timeline-preview" role="status"><strong>{preview.title}</strong>{preview.loading&&<p>正在加载截图…</p>}{preview.image&&<img src={preview.image} alt={preview.title}/>} {preview.text&&<p>{preview.text}</p>}</div>}
    <p>语音为转写片段 · 录屏为截图采样 · 浏览器为真实操作事件</p>
  </section>;
}
