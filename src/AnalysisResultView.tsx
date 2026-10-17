import type { Analysis } from '../common/analysis';
import type { Claim, EnhancementWorkflow } from '../common/enhancement';
import { StepScreenshots } from './StepScreenshots';

export function AnalysisResultView({analysis,workflow,sessionId}:{analysis:Analysis;workflow:EnhancementWorkflow;sessionId:string;toolNames:string[]}) {
  const result=workflow.result;
  if(!result)return null;
  const findings=(claims:Claim[])=>claims.map(claim=><div className="deep-finding" key={claim.id}>
    <p>{['unknown','inferred'].includes(claim.kind)&&<span className="deep-finding-label">待确认</span>}{claim.text}</p>
  </div>);
  const otherClaims=result.claims.filter(claim=>claim.stepRefs.length!==1||!analysis.steps.some(step=>step.id===claim.stepRefs[0]));
  return <div className="deep-result deep-result-story">
    <div className="summary"><div className="summary-head"><span className="eyebrow">操作概述</span></div><h2 className="summary-text">{analysis.intent}</h2>
      {otherClaims.length>0&&<details className="deep-overview-details"><summary><span>其他补充 <span className="deep-overview-count">{otherClaims.length}</span></span><span className="deep-overview-toggle" aria-hidden="true"/></summary><div className="deep-overview-content">{findings(otherClaims)}</div></details>}
    </div>
    <div className="story-edit"><div className="summary-head"><span className="eyebrow">步骤</span><span className="edit-hint">核对操作、分析补充与对应截图</span></div>
      <div className="tiles">{analysis.steps.map((step,index)=>{
        const claims=result.claims.filter(claim=>claim.stepRefs.length===1&&claim.stepRefs[0]===step.id);
        return <article className="tile step-tile deep-result-step" key={step.id}>
          <div className="tile-head"><span className="tile-num">{index+1}</span><h3>{step.title}</h3></div>
          <p className="ed-detail">{step.detail}</p>
          <StepScreenshots sessionId={sessionId} startMs={step.startMs} endMs={step.endMs} excludedFiles={result.screenshotReviews?.filter(review=>review.decision==='discard').map(review=>review.file)}/>
          {claims.length>0&&<div className="deep-step-findings"><span className="deep-findings-caption">分析补充</span>{findings(claims)}</div>}
        </article>;
      })}</div>
      {!analysis.steps.length&&<p className="edit-hint">暂无可关联的录制步骤。</p>}
    </div>
    {result.remainingGapRefs.length>0&&<section className="deep-gaps"><strong>待补充</strong>{workflow.package?.gaps.filter(g=>result.remainingGapRefs.includes(g.id)).map(g=><p key={g.id}>{g.question}</p>)}</section>}
  </div>;
}
