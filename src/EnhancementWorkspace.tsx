import type { Analysis } from "../common/analysis";
import { useEffect, useRef, useState } from "react";
import type { Answer, EnhancementWorkflow } from "../common/enhancement";
import type { EnhancementAction } from "../common/processing-api";
import type { CapabilityManifest, ProcessingStatus } from "../common/agents";
import { AnalysisTimer } from "./AnalysisTimer";
import { AnalysisResultView } from "./AnalysisResultView";

export const enhancementLabel = (w: EnhancementWorkflow | null) => {
  if (w?.package?.status === "stale") return "需更新";
  if (w?.approvedAt) return "已确认";
  if (w?.decision?.kind === "skip") return "已跳过";
  if (["running", "queued"].includes(w?.run?.status ?? "")) return "分析中";
  if (w?.run?.status === "awaiting-input") return "待回答";
  if (w?.run?.status === "completed") return "待确认";
  if (["failed", "interrupted", "canceled", "paused"].includes(w?.run?.status ?? "")) return "可继续";
  if (w?.package?.status === "identifying") return w.progress?.at(-1)?.phase==='checking'?"自检中":"匹配中";
  return w?.package ? "待分析" : "未开始";
};

export function EnhancementWorkspace({ sessionId, workflow, onWorkflow, onGenerate, activeStage = true, analysis }: {
  analysis: Analysis;
  activeStage?: boolean;
  sessionId: string;
  workflow: EnhancementWorkflow | null;
  onWorkflow: (w: EnhancementWorkflow) => void;
  onGenerate: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [stopping,setStopping]=useState(false),[stopped,setStopped]=useState(false);
  const stopRequested=useRef(false);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [notes, setNotes] = useState("");
  const [details, setDetails] = useState(false);
  const [processing, setProcessing] = useState<ProcessingStatus | null>(null);
  const [snapshot, setSnapshot] = useState<CapabilityManifest | null>(null);
  const attemptClock = useRef(Date.now());
  const autoStarted = useRef<string | null>(null);
  const p = workflow?.package;
  const run = workflow?.run;
  const active = busy || p?.status === "identifying" || run?.status === "queued" || run?.status === "running";

  const call = async (action: EnhancementAction) => {
    const response = await window.skillRecorder.enhancement(action);
    if (!response.ok) throw new Error(response.error ?? "操作失败");
    if (response.workflow) onWorkflow(response.workflow);
    return response.workflow ?? null;
  };
  const perform = async (action: EnhancementAction) => {
    setBusy(true); setError("");
    try { await call(action); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "无法连接深度分析服务。"); return false; }
    finally { setBusy(false); }
  };

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const result = await window.skillRecorder.processing({ kind: "status" });
        if (alive && result.status) setProcessing(result.status);
      } catch { if (alive) setError("无法读取智能处理配置。"); }
    };
    void refresh();
    const off = window.skillRecorder.onSettingsChanged(refresh);
    return () => { alive = false; off(); };
  }, []);

  useEffect(() => {
    setAnswers(p?.answers ?? []);
    setNotes(p?.userNotes ?? "");
    if (p?.workspaceId) void window.skillRecorder.processing({ kind: "capabilities", workspaceId: p.workspaceId }).then((r) => setSnapshot(r.snapshot ?? null));
    else setSnapshot(null);
  }, [p?.preparationId, p?.revision]);

  const start = async (force = false) => {
    stopRequested.current=false;setStopped(false);
    attemptClock.current=Date.now();
    setBusy(true); setError("");
    try {
      let current = workflow;
      if (force || !current?.package || ["draft", "stale"].includes(current.package.status))
        current = await call({ kind: "prepare", sessionId });
      const pack = current?.package;
      if(stopRequested.current)return;
      if (!pack) throw new Error("未能建立深度分析任务。");
      if (pack.status !== "frozen") current = await call({ kind: "confirm", sessionId, scope: pack.scope });
      if(stopRequested.current)return;
      const runId = current?.run?.runId ?? crypto.randomUUID();
      await call({ kind: "run", sessionId, runId, continueRun: !!current?.run });
    } catch (e) { setError(e instanceof Error ? e.message : "深度分析失败。"); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!activeStage || !processing?.ready || workflow?.approvedAt || active || stopped || stopRequested.current || run || p?.status === "awaiting-answers") return;
    const key = `${sessionId}:${p?.preparationId ?? "new"}`;
    if (autoStarted.current === key) return;
    autoStarted.current = key;
    void start(false);
  }, [activeStage, processing?.ready, sessionId, p?.preparationId, p?.status, run?.runId,stopped]);

  const setAnswer = (questionId: string, text: string, status: Answer["status"] = "draft") => {
    setAnswers((prior) => [...prior.filter((a) => a.questionId !== questionId), {
      questionId, text, status, appliesTo: prior.find((a) => a.questionId === questionId)?.appliesTo ?? "",
      updatedAt: Date.now(), confirmedAt: null,
    }]);
  };
  const submitAnswers = async () => {
    if (!p || !run) return;
    stopRequested.current=false;setStopped(false);
    attemptClock.current=Date.now();
    setBusy(true); setError("");
    try {
      let current = await call({ kind: "draft", sessionId, input: { answers, userNotes: notes, materials: p.materials } });
      if(stopRequested.current)return;
      current = await call({ kind: "confirm", sessionId, scope: current?.package?.scope ?? p.scope });
      if(stopRequested.current)return;
      await call({ kind: "run", sessionId, runId: run.runId, continueRun: true });
    } catch (e) { setError(e instanceof Error ? e.message : "无法提交回答。"); }
    finally { setBusy(false); }
  };
  const confirmResult = async () => {
    if (!workflow?.result) return;
    const ok = await perform({ kind: "review", sessionId, decisions: workflow.result.claims.map((claim) => ({ id: claim.id, review: "accepted" as const })) });
    if (ok) onGenerate();
  };

  const progress = workflow?.progress ?? [];
  const questions = p?.questions ?? [];
  const result = workflow?.result ?? null;
  const waitingForAnswers = run?.status === "awaiting-input" || p?.status === "awaiting-answers";
  const canShowResult = !!result && run?.status === "completed";
  const failure = error || (["failed", "interrupted", "paused", "canceled"].includes(run?.status ?? "") ? run?.error : "");
  const toolNames = (p?.scope?.allowedToolRefs ?? []).map((ref) => snapshot?.tools.find((t) => t.ref === ref)?.name ?? ref);
  const stages = [
    ...(p?.backend==='api'?[]:[{phase:"checking",title:"检查 Claude 与模型连接",detail:"用最小请求确认 Claude 和当前模型可用，通过后开始分析。"}]),
    {phase:"planning",title:"规划分析与匹配工具",detail:"识别需要补充的信息，匹配本次可用能力。"},
    {phase:"materials",title:"整理材料与确认工具",detail:"检查原始操作、截图和语音，建立素材索引并确认工具。"},
    {phase:"reading",title:"读取材料与深度分析",detail:"Claude 正在分析录制材料，核对事实和业务规则。"},
    {phase:"finalizing",title:"整理与校验结果",detail:"整理分析结论及待确认问题，校验证据引用。"},
  ];
  const currentPhase = p?.status === "identifying" ? progress.at(-1)?.phase==='checking'?'checking':'planning' : run?.phase === "queued" || run?.phase === "capabilities" ? "materials" : run?.phase ?? "checking";
  const currentIndex = Math.max(0, stages.findIndex(stage=>stage.phase===currentPhase));
  const progressStart = p?.status==='identifying' ? p.preparedAt??0 : run?.attemptStartedAt??run?.createdAt??0;
  const stepEvents=progress.filter(event=>event.at>=progressStart && (currentPhase==='materials'?['materials','capabilities'].includes(event.phase):currentPhase==='planning'?event.phase==='capabilities':event.phase===currentPhase));
  const stepStartedAt=currentPhase==='planning'?stepEvents.length?Math.min(...stepEvents.map(event=>event.at)):p?.preparedAt??attemptClock.current:stepEvents.length?Math.min(...stepEvents.map(event=>event.at)):progressStart||attemptClock.current;
  const currentEvent = [...progress].filter(event=>event.phase===(currentPhase==='checking'?'checking':p?.status==='identifying'?'capabilities':run?.phase) && event.at>=progressStart).sort((a,b)=>b.at-a.at)[0];
  const currentModel = [...progress].reverse().find(event=>event.at>=progressStart && event.model && (currentPhase==='planning'?event.phase==='capabilities':event.phase===currentPhase))?.model;
  const visibleActions=progress.filter(event=>event.at>=progressStart && !['模型已确认','已选择模型','Claude 进程已就绪'].includes(event.title)).reduce<typeof progress>((items,event)=>{
    if(items.at(-1)?.title===event.title && items.at(-1)?.phase===event.phase)items[items.length-1]=event;
    else items.push(event);
    return items;
  },[]).slice(-3);
  const eventTime=(at:number)=>`${Math.max(0,(at-(p?.preparedAt??progressStart))/1000).toFixed(1)}s`;
  const stop=async()=>{
    stopRequested.current=true;setStopping(true);setError('');
    try {await call({kind:'cancel',sessionId});setStopped(true);}
    catch(e){setError(e instanceof Error?e.message:'停止任务失败。');}
    finally{setStopping(false);}
  };

  return (
    <section className="ws enhancement-workspace deep-analysis">
      {(active || waitingForAnswers || canShowResult) && <div className="ws-head deep-head">
        <div><h2>{active ? currentPhase==='checking'?"正在检查连接…":"正在补充分析…" : waitingForAnswers ? `还需要你确认${questions.length ? ` ${questions.length} 点` : ""}` : canShowResult ? "确认这份分析" : "补充分析"}</h2>
          <p>{active ? currentPhase==='checking'?"先确认 Claude 和当前模型可用，自检通过后自动开始分析。":"结合你的目标，补充操作细节和业务规则。" : waitingForAnswers ? "选择一个答案，也可以填写自己的做法。" : canShowResult ? "核对操作概述、步骤与截图，确认后继续生成。" : "从已确认的原始素材继续。"}</p></div>
        {active && <div className="deep-run-controls"><span className="deep-model" aria-label="当前使用模型" title={currentModel}>模型 <b>{currentModel??'确认中…'}</b></span><AnalysisTimer startedAt={p?.preparedAt??attemptClock.current} precision="seconds" label="总用时" ariaLabel="本次任务总用时"/><button className={`secondary deep-stop${stopping?' is-stopping':''}`} onClick={()=>void stop()} disabled={stopping}>{stopping?'正在停止…':'停止任务'}</button></div>}
      </div>}
      <div className="ws-body deep-body">
        {(failure || stopped) && !active && <div className={stopped?'deep-stopped':'analysis-error'} role="status"><strong>{stopped?'任务已停止':'深度分析未完成'}</strong><p>{stopped?'后台任务已停止，原始材料已保留。重试将重新规划并创建新任务。':run?.status === "paused" && run.activeMs >= run.budget.activeMs ? "本次分析额度已用完。点击重试会基于原始材料重新规划，并重新计算额度。" : failure}</p><div className="processing-actions"><button className="secondary" onClick={() => void start(true)}>重试</button>{!stopped&&<button className="linky" onClick={() => void window.skillRecorder.openSettings("agent")}>检查设置</button>}</div></div>}
        {!processing?.ready && !active && <div className="ws-empty"><p className="ws-empty-lead">智能处理还没有准备好</p><p>{processing?.error ?? "正在检查本地 Claude 和模型设置。"}</p><button className="record-cta" onClick={() => void window.skillRecorder.openSettings("agent")}>前往设置</button></div>}

        {active && <div className="deep-progress-layout">
          <aside className="deep-sources"><strong>本次使用</strong><div><b>录制材料</b><span>操作 · 截图 · 语音</span></div>{toolNames.map((name) => <div key={name}><b>{name}</b><span>只读 · 已授权范围</span></div>)}{!toolNames.length && <div><b>已确认的 Skill</b><span>{snapshot?.skills.length ? `${snapshot.skills.length} 项方法参考` : "未使用外部业务工具"}</span></div>}<button className="linky" onClick={() => setDetails((v) => !v)}>查看查询范围与详情</button></aside>
          <div className="deep-timeline">
            <div className="deep-current" role="status"><span>当前进行</span><h3>{stages[currentIndex].title}</h3><p>{currentEvent?.status === "running" ? currentEvent.detail : stages[currentIndex].detail}</p></div>
            <ol className="deep-stage-list" aria-label="分析步骤">{stages.map((stage,index)=>{
              const state=index<currentIndex?"completed":index===currentIndex?"running":"pending";
              return <li className={state} key={stage.phase} aria-current={state==="running"?"step":undefined}><span className="deep-stage-number">{state==="completed"?"✓":index+1}</span><b>{stage.title}</b><span>{state==="running"?<AnalysisTimer startedAt={stepStartedAt} label="" ariaLabel="当前步骤用时"/>:state==="completed"?"已完成":"待开始"}</span></li>;
            })}</ol>
            {!!visibleActions.length && <div className="deep-live-action"><div className="deep-action-heading"><span>最近执行</span><button className="linky" onClick={()=>setDetails(v=>!v)}>{details?'收起详情':'展开详情'}</button></div><ol aria-label="最近执行记录">{visibleActions.map((event,index)=><li key={`${event.sequence}-${event.at}-${index}`}><time>{eventTime(event.at)}</time><div><b>{event.title}</b><p>{event.detail}</p></div></li>)}</ol></div>}
            {details && <details open><summary>运行详情</summary><p>会话只可读取冻结材料；禁止命令执行和业务写操作。</p><p>任务版本：{p?.revision ?? "准备中"} · 尝试：{run?.attempt ?? 1}</p>{[...progress].filter(event=>event.at>=progressStart).sort((a,b)=>a.at-b.at).map(event=><p key={`${event.sequence}-${event.at}`}>{event.title}：{event.detail}</p>)}</details>}
          </div>
        </div>}

        {waitingForAnswers && !active && <div className="deep-questionnaire">
          {questions.map((q, index) => { const answer = answers.find((a) => a.questionId === q.id); return <fieldset key={q.id}><legend><span>问题 {index + 1}</span>{q.text}</legend>{q.options.map((option) => <label className="answer-option" key={option}><input type="radio" name={q.id} checked={answer?.text === option && answer.status === "draft"} onChange={() => setAnswer(q.id, option)}/><span>{option}</span></label>)}<label className="answer-other"><input type="radio" name={q.id} checked={!!answer?.text && !q.options.includes(answer.text)} onChange={() => setAnswer(q.id, "")}/><span>其他</span><input aria-label={`${q.text}的其他答案`} value={!q.options.includes(answer?.text ?? "") ? answer?.text ?? "" : ""} onChange={(e) => setAnswer(q.id, e.target.value)} placeholder="填写你的做法"/></label><button className={`linky unknown-choice ${answer?.status === "unknown" ? "selected" : ""}`} onClick={() => setAnswer(q.id, "", "unknown")}>暂不确定</button></fieldset>; })}
          <label className="deep-notes"><span>补充说明或文件内容</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="可选：补充录制中没有表达清楚的内容"/></label>
          <p className="edit-hint">未回答或暂不确定的内容会保留为待补充，不会被自动推断。</p>
        </div>}

        {canShowResult && result && workflow && !active && <AnalysisResultView analysis={analysis} workflow={workflow} sessionId={sessionId} toolNames={toolNames}/>}
        {!active && !failure && !stopped && !waitingForAnswers && !canShowResult && processing?.ready && <div className="ws-empty"><p className="ws-empty-lead">准备深度分析</p><p>Claude 会自行读取冻结材料并一次性整理需要确认的问题。</p><button className="record-cta" onClick={() => void start(false)}>开始分析</button></div>}
      </div>
      {!active && <div className="ws-foot deep-foot"><div className="ws-foot-back">{canShowResult && <button className="linky" onClick={() => void start(true)}>重新分析</button>}</div><div className="ws-foot-actions">{waitingForAnswers && <button className="record-cta" onClick={() => void submitAnswers()}>提交并继续分析</button>}{canShowResult && <button className="record-cta" onClick={() => void confirmResult()}>确认并生成</button>}</div></div>}
    </section>
  );
}
