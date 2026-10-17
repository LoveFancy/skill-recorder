/** Project execution metadata only. Never expose reasoning, arguments or tool results. */
export function executionModel(value:unknown): string|undefined {
  return typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,159}$/.test(value) ? value : undefined;
}
export function claudeExecutionProgress(onProgress: (title:string,detail:string,model?:string)=>void, onTool?: (name:string)=>void) {
  const calls=new Map<string,string>();
  let model:string|undefined;
  let fragments=0,lastStreamUpdate=0;
  const emit=(title:string,detail:string)=>onProgress(title,detail,model);
  return (value:unknown) => {
    if (!value || typeof value !== 'object') return;
    const e=value as {type?:string;subtype?:string;model?:unknown;is_error?:boolean;event?:{type?:string;delta?:{type?:string};message?:{model?:unknown};content_block?:{type?:string;name?:unknown}};message?:{model?:unknown;content?:Array<Record<string,unknown>>}};
    const reported=executionModel(e.type==='system' && e.subtype==='init'?e.model:e.type==='assistant'?e.message?.model:e.type==='stream_event' && e.event?.type==='message_start'?e.event.message?.model:undefined);
    if(reported && reported!==model){model=reported;emit('模型已确认','已获取当前会话使用的模型。');}
    if(e.type==='system' && e.subtype==='init')emit('Claude 进程已就绪','会话初始化完成，等待模型服务响应。');
    if(e.type==='stream_event' && e.event?.type==='content_block_start' && ['thinking','text'].includes(e.event.content_block?.type??''))emit('模型正在处理','正在分析输入并组织结果。');
    if(e.type==='stream_event' && e.event?.type==='content_block_start' && e.event.content_block?.type==='tool_use') {
      const name=e.event.content_block.name;
      if(typeof name==='string' && /^[A-Za-z0-9_-]{1,200}$/.test(name))emit(name==='StructuredOutput'?'正在生成结构化结果':'正在生成工具请求',name.startsWith('mcp__')?name.split('__').slice(1).join(' / '):name);
    }
    if(e.type==='stream_event' && e.event?.type==='content_block_delta' && ['thinking_delta','text_delta','input_json_delta'].includes(e.event.delta?.type??'')) {
      fragments++;
      if(Date.now()-lastStreamUpdate>=2000){
        lastStreamUpdate=Date.now();
        emit(e.event.delta?.type==='input_json_delta'?'正在生成工具参数':e.event.delta?.type==='thinking_delta'?'模型持续处理中':'正在生成回复',`持续收到模型响应，累计 ${fragments} 个输出片段。`);
      }
    }
    for(const block of Array.isArray(e.message?.content)?e.message.content:[]) {
      if(e.type==='assistant' && block.type==='tool_use' && typeof block.id==='string' && typeof block.name==='string') {
        if(calls.has(block.id))continue;
        const name=/^[A-Za-z0-9_-]{1,200}$/.test(block.name)?block.name:'工具';calls.set(block.id,name);onTool?.(name);
        const action:Record<string,string>={Read:'读取材料',Glob:'查找文件',Grep:'检索材料',StructuredOutput:'整理结构化结果'};
        const filename=String((block.input as {file_path?:unknown}|undefined)?.file_path??'').split(/[\\/]/).pop()??'';
        const knownFiles=new Set(['materials-index.md','task-package.json','evidence.jsonl','analysis.json','analysis.md','narration.json','browser.jsonl','session.json','video-frames.json','frames.json']);
        const detail=name==='Read'&&knownFiles.has(filename)?filename:name.startsWith('mcp__')?name.split('__').slice(1).join(' / '):name;
        emit(action[name]??'调用工具',detail);
      }
      if(e.type==='user' && block.type==='tool_result' && typeof block.tool_use_id==='string' && calls.has(block.tool_use_id))emit(block.is_error?'工具执行失败':'工具执行完成',calls.get(block.tool_use_id)!);
    }
    if(e.type==='result')emit(e.is_error?'Claude 执行未完成':'Claude 已返回结果',e.is_error?'正在处理执行错误。':'正在校验输出和证据。');
  };
}
