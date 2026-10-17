import { useEffect, useRef } from "react";

export function AnalysisTimer({startedAt,precision="hundredths",label="已用时",ariaLabel="本次执行已用时"}:{startedAt:number;precision?:"seconds"|"hundredths";label?:string;ariaLabel?:string}) {
  const output=useRef<HTMLSpanElement>(null);
  useEffect(()=>{
    const tick=()=>{
      const ticks=Math.floor(Math.max(0,Date.now()-startedAt)/10);
      const pad=(value:number)=>value.toString().padStart(2,'0');
      if(output.current)output.current.textContent=precision==='seconds'?`${Math.floor(ticks/100)} 秒`:`${pad(Math.floor(ticks/6000))}:${pad(Math.floor(ticks/100)%60)}.${pad(ticks%100)}`;
    };
    tick();const timer=window.setInterval(tick,precision==='seconds'?1000:10);
    return ()=>window.clearInterval(timer);
  },[startedAt,precision]);
  return <span className="deep-elapsed" aria-label={ariaLabel}>{label && `${label} `}<span ref={output}>{precision==='seconds'?'0 秒':'00:00.00'}</span></span>;
}
