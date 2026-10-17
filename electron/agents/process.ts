import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export const CLAUDE_OUTPUT_LIMITS = {
  streamJson: true,
  maxOutputBytes: 256 * 1024 * 1024,
  maxRetainedBytes: 64 * 1024 * 1024,
  maxLineBytes: 64 * 1024 * 1024,
} as const;

export function processFailureMessage(code:number|null,diagnostic:string):string {
  const prefix=`Agent 进程失败（退出码 ${code}）`;
  if(/error_max_structured_output_retries|structured.output.*retr/i.test(diagnostic))return prefix+"：Claude 多次未能生成符合约定的结构化结果，请重试终局整理。";
  if(/429|rate.limit|overloaded|529/i.test(diagnostic))return prefix+"：模型服务繁忙或请求频率受限，请稍后重试。";
  if(/context.length|prompt.is.too.long|too many tokens/i.test(diagnostic))return prefix+"：分析材料超过模型上下文容量，请调整模型或缩减材料。";
  if(/connection error|ECONNREFUSED|ENOTFOUND|fetch failed|ETIMEDOUT/i.test(diagnostic))return prefix+"：无法连接模型服务，请检查服务地址与网络。";
  if(/json.schema|no schema with key or ref/i.test(diagnostic))return prefix+"：Claude 结构化输出格式不兼容，请检查 JSON Schema 版本。";
  if(/not logged in|please run \/login|invalid api key|authentication_error|unauthorized/i.test(diagnostic))return prefix+"：Claude 模型认证不可用，请检查全局登录或模型服务令牌。";
  if(/settings.*(?:not found|does not exist|failed|cannot|unable)|(?:cannot|unable|failed).*settings/i.test(diagnostic))return prefix+"：任务设置文件无法读取，请重新建立任务配置。";
  if(/unknown option|invalid option/i.test(diagnostic))return prefix+"：当前 Claude 版本不支持所需启动参数，请升级或检查兼容性。";
  return prefix+"，请检查模型连接、登录与项目配置。";
}

/** No shell, bounded output, and cancellation waits for the child to exit. */
export function runProcess(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    input?: string;
    env?: NodeJS.ProcessEnv;
    onSpawn?: (process: { pid: number; pgid: number | null; startedAt: number }) => void;
    onJsonEvent?: (event: unknown) => void;
    diagnosticFile?: string;
    onWaiting?: (elapsedMs:number, idleMs:number, receivedResponse:boolean) => void;
    waitingIntervalMs?: number;
    /** Deliver all JSON events live, but retain only complete messages and the result. */
    streamJson?: boolean;
    maxOutputBytes?: number;
    maxRetainedBytes?: number;
    maxLineBytes?: number;
  } = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    options.signal?.throwIfAborted();
    const maxOutputBytes=options.maxOutputBytes??64*1024*1024;
    const maxRetainedBytes=options.maxRetainedBytes??64*1024*1024;
    const maxLineBytes=options.maxLineBytes??maxRetainedBytes;
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const startedAt = Date.now();
    let lastEventAt=startedAt, receivedResponse=false, eventCount=0;
    const diagnostic=(event:string,fields:Record<string,unknown>={})=>{
      if(!options.diagnosticFile)return;
      try {
        mkdirSync(path.dirname(options.diagnosticFile),{recursive:true,mode:0o700});
        appendFileSync(options.diagnosticFile,JSON.stringify({at:Date.now(),elapsedMs:Date.now()-startedAt,event,pid:child.pid,...fields})+'\n',{mode:0o600});
      }catch{/* Diagnostic storage must not interrupt execution. */}
    };
    diagnostic('spawn',{timeoutMs:options.timeoutMs??15000,inputBytes:Buffer.byteLength(options.input??''),maxOutputBytes,maxRetainedBytes,streamJson:!!options.streamJson});
    if (child.pid) options.onSpawn?.({ pid: child.pid, pgid: process.platform === "win32" ? null : child.pid, startedAt });
    let output = "",
      bytes = 0,
      failure: Error | null = null;
    let retainedBytes=0,transientEvents=0;
    let stderrDiagnostic = "";
    const decoder = new StringDecoder("utf8");
    let pendingLine = "";
    const retain=(text:string)=>{
      retainedBytes+=Buffer.byteLength(text);
      if(retainedBytes>maxRetainedBytes){terminate(new Error('Agent 有效消息与最终结果超过保留上限。'));return;}
      output+=text;
    };
    const consume = (text: string) => {
      if(!options.streamJson){output += text;retainedBytes+=Buffer.byteLength(text);}
      if (!options.streamJson && !options.onJsonEvent && !options.diagnosticFile && !options.onWaiting) return;
      pendingLine += text;
      let newline: number;
      while ((newline = pendingLine.indexOf("\n")) !== -1) {
        const line = pendingLine.slice(0, newline); pendingLine = pendingLine.slice(newline + 1);
        if(options.streamJson && Buffer.byteLength(line)>maxLineBytes){terminate(new Error('Agent 单条消息超过限制。'));return;}
        let event: unknown;
        try { event = JSON.parse(line); } catch { if(options.streamJson && line.trim())retain(line+'\n');continue; }
        lastEventAt=Date.now();eventCount++;
        const e=event as {type?:unknown;subtype?:unknown};
        const type=typeof e?.type==='string' && /^[a-z_]{1,60}$/.test(e.type)?e.type:'unknown';
        const subtype=typeof e?.subtype==='string' && /^[a-z_]{1,80}$/.test(e.subtype)?e.subtype:undefined;
        if(['stream_event','assistant','result'].includes(type))receivedResponse=true;
        const transient=type==='stream_event' || type==='system' && subtype!=='init';
        if(transient)transientEvents++;
        else diagnostic('stdout_event',{type,subtype,eventCount});
        if(receivedResponse && !firstResponseLogged){firstResponseLogged=true;diagnostic('first_response',{type});}
        try { options.onJsonEvent?.(event); } catch (error) { terminate(error instanceof Error ? error : new Error("执行事件处理失败。")); }
        if(options.streamJson && !transient){
          const message=event as {message?:{content?:unknown[]}};
          if(type==='assistant' && Array.isArray(message.message?.content)) {
            // Complete tool calls must survive for evidence extraction; reasoning is transient.
            retain(JSON.stringify({...message,message:{...message.message,content:message.message.content.filter(block=>!['thinking','redacted_thinking'].includes(String((block as {type?:unknown}|null)?.type)))}})+'\n');
          } else retain(line+'\n');
        }
        if(failure)return;
      }
      if(options.streamJson && Buffer.byteLength(pendingLine)>maxLineBytes)terminate(new Error('Agent 单条消息超过限制。'));
    };
    const terminate = (error: Error) => {
      if (failure) return;
      failure = error;
      diagnostic('terminate',{reason:/超时/.test(error.message)?'timeout':/取消/.test(error.message)?'canceled':/上限|限制/.test(error.message)?'output_limit':'execution_error',eventCount,receivedResponse,bytes,retainedBytes,transientEvents});
      killTree("SIGTERM");
      escalation = setTimeout(() => killTree("SIGKILL"), 1500);
    };
    const killTree = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") {
          const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", ...(signal === "SIGKILL" ? ["/F"] : [])], {
            shell: false, windowsHide: true, stdio: "ignore",
          });
          killer.unref();
        } else process.kill(-child.pid, signal);
      } catch {
        try { child.kill(signal); } catch { /* already exited */ }
      }
    };
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let firstResponseLogged=false;
    const waiting=setInterval(()=>{
      const elapsed=Date.now()-startedAt,idle=Date.now()-lastEventAt;
      diagnostic('waiting',{idleMs:idle,eventCount,receivedResponse,bytes,retainedBytes,transientEvents});
      try{options.onWaiting?.(elapsed,idle,receivedResponse);}catch(error){terminate(error instanceof Error?error:new Error('执行事件处理失败。'));}
    },options.waitingIntervalMs??15000);
    const abort = () => terminate(new Error(/timed out|timeout/i.test(String(options.signal?.reason?.message ?? options.signal?.reason ?? "")) ? "Agent 响应超时。" : "任务已取消。"));
    const timer = setTimeout(
      () => terminate(new Error("Agent 响应超时。")),
      options.timeoutMs ?? 15000,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      if(failure)return;
      bytes += chunk.length;
      if (bytes > maxOutputBytes)
        terminate(new Error(`Agent 累计输出超过限制（${Math.round(maxOutputBytes/1024/1024)} MB）。`));
      else consume(decoder.write(chunk));
    });
    // Classify bounded diagnostics in memory; never return/log raw stderr.
    child.stderr.on("data", (chunk:Buffer) => {if(stderrDiagnostic.length<16384)stderrDiagnostic+=chunk.toString().slice(0,16384-stderrDiagnostic.length);});
    child.stdin.on("error", () => {});
    child.stdin.end(options.input ?? "");
    const clean = () => {
      clearTimeout(timer);
      clearInterval(waiting);
      if (escalation) clearTimeout(escalation);
      options.signal?.removeEventListener("abort", abort);
    };
    child.once("error", (error) => {
      diagnostic('spawn_error',{code:(error as NodeJS.ErrnoException).code});
      clean();
      reject(error);
    });
    child.once("close", (code,signal) => {
      if(!failure){consume(decoder.end());if (pendingLine.trim()) consume("\n");}
      clean();
      diagnostic('exit',{code,signal,eventCount,receivedResponse,bytes,retainedBytes,transientEvents,failure:failure?'terminated':code!==0||resultError(output)?'process_error':null,category:!failure&&(code!==0||resultError(output))?processFailureMessage(code,stderrDiagnostic+resultError(output)):undefined});
      if (failure) reject(failure);
      else if (code !== 0 || resultError(output))
        reject(
          new Error(processFailureMessage(code, stderrDiagnostic + resultError(output))),
        );
      else resolve(output);
    });
  });
}

function resultError(output:string):string {
  for(const line of output.trim().split("\n").reverse())try {
    const event=JSON.parse(line);
    if(event.type==="result" && event.is_error)return JSON.stringify({subtype:event.subtype,result:event.result,errors:event.errors});
  }catch { /* Only structured error envelopes are classified. */ }
  return "";
}
