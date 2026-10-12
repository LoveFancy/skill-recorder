import { readEvents } from "../frames/correlate";
import { scanSession, buildRedactor } from "../sensitive/scanner";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Tool } from "../ai/client";

import type { Analysis } from "../../common/analysis";
import type { SessionBundle } from "../../common/bundle";

/**
 * The two read-only tools every final-stage builder exposes: `get_analysis`
 * (the approved intent + steps the builder generalizes) and `get_timeline` (the
 * deterministic evidence behind those steps). Shared by the Skill Builder and the
 * Automation Builder so both ground their plans in the same recording data.
 */

export function readBundle(sessionDir: string): SessionBundle | null {
  const p = path.join(sessionDir, "bundle.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as SessionBundle;
  } catch {
    return null;
  }
}

export interface ReadToolsContext {
  sessionDir: string;
  /** The approved analysis being generalized (the builder's input). */
  analysis: Analysis;
  /** Streamed to the UI as the agent works. */
  onProgress?: (message: string) => void;
}

/** Build the shared `get_analysis` + `get_timeline` tools for one builder session. */
export function createReadTools(ctx: ReadToolsContext): Tool[] {
  const { sessionDir, analysis } = ctx;
  const progress = (m: string) => ctx.onProgress?.(m);

  const getAnalysis: Tool = {
    name: "get_analysis",
    description:
      "Return the approved analysis you are generalizing: the overall intent and the ordered list of steps (with each step's title, detail, apps, and evidence). Read this first.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: () => {
      progress("正在读取分析结果…");
      const view = {
        intent: analysis.intent,
        intentRationale: analysis.intentRationale,
        stepCount: analysis.steps.length,
        steps: analysis.steps.map((s) => ({
          id: s.id,
          title: s.title,
          detail: s.detail,
          apps: s.apps,
          evidence: s.evidence,
          browserEventIds: s.browserEventIds,
        })),
      };
      return JSON.stringify(view, null, 2);
    },
  };

  const getTimeline: Tool = {
    name: "get_timeline",
    description:
      "Return the deterministic timeline behind the analysis: ordered steps with their app, window titles, hosts, URLs, terminal commands, clipboard counts and markers. Use it to ground your native-tool mapping in real evidence.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: () => {
      progress("正在读取时间线…");
      const bundle = readBundle(sessionDir);
      if (!bundle) {
        return "No timeline is available (bundle.json missing). Work from get_analysis instead.";
      }
      const view = {
        durationMs: bundle.session.durationMs,
        platform: bundle.session.platform,
        steps: bundle.steps.map((s) => ({
          index: s.index,
          app: s.app,
          titles: s.titles,
          hosts: s.hosts,
          urls: s.urls,
          commands: s.commands,
          clipboardCount: s.clipboardCount,
          markers: s.markers,
          summary: s.summary,
        })),
      };
      return JSON.stringify(view, null, 2);
    },
  };

  const getBrowserTargets: Tool = {
    name:"get_browser_targets",
    description:"Read exact element locator candidates and frame context for real Chrome events referenced by the approved analysis. Use to ground browser automation and Skill instructions; uniqueness was checked at capture time, not guaranteed on replay.",
    parameters:{type:"object",properties:{offset:{type:"integer",minimum:0}},additionalProperties:false},
    handler:async raw=>{
      const offset=(raw as {offset?:number}|null)?.offset??0;
      if(!Number.isInteger(offset)||offset<0)return "Invalid offset";
      const wanted=new Set(analysis.steps.flatMap(s=>s.browserEventIds??[]));
      if(!wanted.size)return JSON.stringify({total:0,events:[],nextOffset:null});
      const events=readEvents(path.join(sessionDir,"events.jsonl")).filter(e=>e.type==="browser.action" && wanted.has(e.payload.eventId as string));
      const scan=await scanSession(path.basename(sessionDir));
      return buildRedactor(scan.values)(JSON.stringify({total:events.length,nextOffset:offset+100<events.length?offset+100:null,events:events.slice(offset,offset+100).map(e=>e.payload)},null,2));
    },
  };
  return [getAnalysis, getTimeline, getBrowserTargets];
}
