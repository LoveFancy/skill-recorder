import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

import type { Tool } from "../ai/client";

import { AnalysisSubmissionSchema, type AnalysisSubmission } from "../../common/analysis";
import { MEANINGFUL_EVENT_TYPES } from "../../common/correlation";
import type { SessionBundle } from "../../common/bundle";
import { NARRATION_FILE, type NarrationTranscript } from "../../common/narration";
import type { RecEvent } from "../../common/types";
import { readEvents } from "../frames/correlate";
import type { FrameExtractor } from "../frames/extractor";
import type { FrameRedactor } from "../sensitive/frame-redact";
import { createLogger } from "../logger";
import {
  listTerminalCommands,
  searchTerminalOutput,
} from "../terminal/artifacts";

const log = createLogger("Describer/tools");

/** Redaction applied to a session's data before it leaves the machine. Threaded
 *  through a mutable slot so the same live tools pick up fresh values each turn. */
export interface RedactionContext {
  /** Mask every detected raw value in an outgoing text string. */
  redactText: (text: string) => string;
  /** Frame OCR + blur policy for get_frames, or null to serve frames unchanged. */
  frameRedactor: FrameRedactor | null;
}

/** Everything a session's tools are bound to. */
export interface ToolContext {
  sessionDir: string;
  /** `session.json` startedAt (epoch ms) — origin of the agent's `atMs` clock. */
  startedAt: number;
  /** Frame service, or null when the session has no video. */
  extractor: FrameExtractor | null;
  /** Mutable redaction slot; `current` is set per turn (null = no redaction). */
  redaction: { current: RedactionContext | null };
  /** Streamed to the UI as the agent works. */
  onProgress?: (message: string) => void;
  /** Called when the agent submits a (validated) analysis. */
  onSubmit: (submission: AnalysisSubmission) => void;
}

const MAX_IMAGES_PER_CALL = 6;
const MAX_STR = 2000;
/** Cap rows returned by get_events so an un-windowed call can't dump the whole log. */
const MAX_EVENTS = 500;
const MAX_TERMINAL_COMMANDS = 50;

const truncate = (v: unknown): unknown =>
  typeof v === "string" && v.length > MAX_STR ? v.slice(0, MAX_STR) + "…[truncated]" : v;

function readBundle(sessionDir: string): SessionBundle | null {
  const p = path.join(sessionDir, "bundle.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as SessionBundle;
  } catch {
    return null;
  }
}

function readNarration(sessionDir: string): NarrationTranscript | null {
  const p = path.join(sessionDir, NARRATION_FILE);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as NarrationTranscript;
  } catch {
    return null;
  }
}

/**
 * Build the custom in-process tools exposed to one model session. Handlers run
 * in the Electron main process (dispatched over JSON-RPC by the SDK), read the
 * session's captured signals, and — for frames — return the JPEGs **inline** so
 * the model can see the screen without any `view`/`bash` tool. `submit_analysis`
 * captures guaranteed-structured output. The whole surface is sandboxed to the
 * one session dir.
 */
export function createDescriberTools(ctx: ToolContext): Tool[] {
  const { sessionDir, startedAt, extractor, onSubmit } = ctx;
  const progress = (m: string) => ctx.onProgress?.(m);
  // Mask detected sensitive values in every outgoing text field (null slot = no-op).
  const redact = (s: string): string => ctx.redaction.current?.redactText(s) ?? s;
  const rel = (epoch: number) => Math.round(epoch - startedAt);
  const abs = (atMs: number) => startedAt + atMs;
  const sec = (atMs: number) => (atMs / 1000).toFixed(1);
  const mmss = (atMs: number) => {
    const total = Math.max(0, Math.round(atMs / 1000));
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };

  const readBrowserActions = (): RecEvent[] => {
    try { return readEvents(path.join(sessionDir,"events.jsonl")).filter(e=>e.type==="browser.action").sort((a,b)=>a.epoch-b.epoch); }
    catch { return []; }
  };
  const inspectedBrowserActions = new Set<number>();
  const getBrowserActions: Tool = {
    name: "get_browser_actions",
    description: "Read real browser operations from the offline Chrome extension, including element locator candidates and CSS viewport coordinates. Read all pages before submission. These are actual browser events; user click annotations only express intent. Locators are candidates, not guaranteed replay selectors.",
    parameters: { type:"object", properties:{offset:{type:"integer",minimum:0}},additionalProperties:false },
    handler: raw => {
      const offset = (raw as {offset?:number}|null)?.offset ?? 0;
      if(!Number.isInteger(offset)||offset<0) return "Invalid offset";
      const all=readBrowserActions(), rows=all.slice(offset,offset+100);
      for(const e of rows) inspectedBrowserActions.add(e.seq);
      return redact(JSON.stringify({total:all.length,nextOffset:offset+rows.length<all.length?offset+rows.length:null,
        scope:"User explicitly bound one Chrome tab. Browser viewport coordinates cannot be overlaid onto desktop frames without verified mapping. Cross-origin frames may not be covered.",
        events:rows.map(e=>({seq:e.seq,atMs:rel(e.epoch),...e.payload}))},null,2));
    },
  };

  const readAnnotations = () => readEvents(path.join(sessionDir,"events.jsonl"))
    .filter(e => e.type === "marker" && typeof e.payload.screenshot === "string");
  const inspectedAnnotations = new Set<string>();
  const annotationKind = (e: RecEvent) => e.payload.cropRegion ? "crop" : e.payload.click ? "click" : "region";

  const getAnnotations: Tool = {
    name: "get_annotations",
    description: "View saved user cropped screenshots and region/click annotation screenshots, with coordinates and capture/confirmation times. Always call when markers are present; combine these images with narration and events. Click annotations are user intent, not proof of an actual application click. Supports pagination.",
    parameters: { type:"object", properties:{ offset:{type:"integer",minimum:0} }, additionalProperties:false },
    handler: async raw => {
      const offset = Math.max(0, Math.floor(Number((raw as {offset?:number})?.offset) || 0));
      const annotations = readAnnotations();
      const page = annotations.slice(offset, offset+MAX_IMAGES_PER_CALL);
      progress(`正在查看用户重点标注 ${offset+1}–${offset+page.length} / ${annotations.length}…`);
      const narration = readNarration(sessionDir);
      const available = new Set<string>();
      const redactor = ctx.redaction.current?.frameRedactor;
      const images: {data:string; mimeType:string; type:"image"; description:string}[] = [];
      for (const e of page) {
        const file = e.payload.screenshot as string;
        if (!/^frames\/annotation_[A-Za-z0-9-]+\.png$/.test(file)) continue;
        if (redactor?.active && !redactor.ready) continue;
        try {
          const fullPath = realpathSync(path.join(sessionDir,file));
          const relative = path.relative(realpathSync(sessionDir), fullPath);
          if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
          const bytes = redactor?.active ? await redactor.redactFrame(fullPath) : readFileSync(fullPath);
          if (!bytes) continue;
          available.add(file);
          images.push({data:bytes.toString("base64"),mimeType:redactor?.active ? "image/jpeg" : "image/png",type:"image",description:`${file} (${annotationKind(e)}) 用户标注，确认于 ${rel(e.epoch)}ms；截图时间 ${rel(Number(e.payload.capturedAt) || e.epoch)}ms`});
        } catch { /* Missing or unreadable screenshots are reported by the image count. */ }
      }
      for (const e of page) inspectedAnnotations.add(e.payload.screenshot as string);
      const rows = page.map(e => {
        const capturedAtMs = rel(Number(e.payload.capturedAt) || e.epoch);
        const atMs = rel(e.epoch);
        const nearbySpeech = narration?.segments.filter(segment => segment.endMs >= Math.min(atMs,capturedAtMs)-10000 && segment.atMs <= Math.max(atMs,capturedAtMs)+10000) ?? [];
        return {...e.payload,kind:annotationKind(e),atMs,capturedAtMs,imageAvailable:available.has(e.payload.screenshot as string),nearbyNarration:nearbySpeech.slice(0,8),nearbyNarrationTruncated:nearbySpeech.length>8};
      });
      return { resultType:"success", textResultForLlm:redact(JSON.stringify({total:annotations.length,nextOffset:offset+page.length < annotations.length ? offset+page.length : null,imagesReturned:images.length,guidance:"These are explicit user focus signals. Explain the marked control/region using nearby narration and surrounding events. A click marker is intent, not proof of a real click. If imageAvailable=false, report the missing visual evidence and avoid inventing content.",annotations:rows})),binaryResultsForLlm:images };
    },
  };

  const getTimeline: Tool = {
    name: "get_timeline",
    description:
      "Return the segmented session timeline: ordered steps with their start time (atMs, ms since recording start), duration, app, urls, titles, commands, clipboard counts and markers. Call this first.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: () => {
      progress("正在读取时间线…");
      const bundle = readBundle(sessionDir);
      if (!bundle) {
        return "No timeline is available yet (bundle.json missing). Use get_events to read the raw event stream instead.";
      }
      const view = {
        durationMs: bundle.session.durationMs,
        platform: bundle.session.platform,
        stats: bundle.stats,
        browserCoverage: {
          total:readBrowserActions().length,
          guidance:"Call get_browser_actions with offset=0 and follow nextOffset until null. Ground steps in actual click/input/navigation and preserve locator candidates for subsequent browser automation; correlate with nearby screenshots and narration.",
        },
        annotationCoverage: {
          total: readAnnotations().length,
          counts: readAnnotations().reduce((counts,e) => { counts[annotationKind(e)]++; return counts; },{region:0,click:0,crop:0} as Record<string,number>),
          guidance:"User annotations are priority evidence. Call get_annotations with offset=0 and follow nextOffset until null before submitting; include their meaning in the appropriate steps. This is required even when no video frames are available.",
        },
        captureCoverage: {
          capturedFrameCount: extractor?.capturedManifest.length ?? 0,
          retainedFrameCount: extractor?.manifest.length ?? 0,
          firstFrameAtMs: extractor?.capturedManifest[0] ? rel(extractor.capturedManifest[0].tMs) : null,
          lastFrameAtMs: extractor?.capturedManifest.at(-1) ? rel(extractor.capturedManifest.at(-1)!.tMs) : null,
          guidance: "Retained frames are only an extracted subset, NOT all recorded images. Inspect get_frames across the full duration before concluding there were no later interactions.",
        },
        steps: bundle.steps.map((s) => ({
          index: s.index,
          atMs: rel(s.startMs),
          durationMs: s.durationMs,
          boundary: s.boundary,
          app: s.app,
          titles: s.titles,
          hosts: s.hosts,
          urls: s.urls,
          commands: s.commands,
          clipboardCount: s.clipboardCount,
          markers: s.markers,
          browserEventIds: s.browserEventIds,
          browserActionCount: readBrowserActions().filter(e=>s.eventSeqs.includes(e.seq)).length,
          frameCount: s.frames.length,
          summary: s.summary,
        })),
      };
      return redact(JSON.stringify(view, null, 2));
    },
  };

  const getEvents: Tool = {
    name: "get_events",
    description:
      "Return the raw event stream (with clipboard text, full titles, full URLs, commands). Optionally filter by `types` (e.g. [\"browser.url\",\"clipboard.change\"]) and/or a time window `fromMs`/`toMs` (atMs, ms since recording start). Defaults to the meaningful events across the whole session.",
    parameters: {
      type: "object",
      properties: {
        types: { type: "array", items: { type: "string" }, description: "Event types to include." },
        fromMs: { type: "number", description: "Window start (atMs)." },
        toMs: { type: "number", description: "Window end (atMs)." },
      },
      additionalProperties: false,
    },
    handler: (raw) => {
      const args = (raw ?? {}) as { types?: string[]; fromMs?: number; toMs?: number };
      const wanted = args.types && args.types.length ? new Set(args.types) : null;
      const from = typeof args.fromMs === "number" ? args.fromMs : -Infinity;
      const to = typeof args.toMs === "number" ? args.toMs : Infinity;
      progress(
        `Reading events ${args.fromMs != null ? sec(args.fromMs) + "s" : "start"}–${
          args.toMs != null ? sec(args.toMs) + "s" : "end"
        }…`,
      );
      let events: RecEvent[];
      try {
        events = readEvents(path.join(sessionDir, "events.jsonl"));
      } catch (err) {
        return `Could not read events: ${err instanceof Error ? err.message : String(err)}`;
      }
      const all = events
        .filter((e) => (wanted ? wanted.has(e.type) : MEANINGFUL_EVENT_TYPES.has(e.type)))
        .map((e) => ({ e, atMs: rel(e.epoch) }))
        .filter(({ atMs }) => atMs >= from && atMs <= to)
        .map(({ e, atMs }) => {
          const payload: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(e.payload)) payload[k] = truncate(v);
          return { seq: e.seq, atMs, type: e.type, source: e.source, ...payload };
        });
      // Bound the payload so a long, un-windowed session can't return thousands
      // of rows in one tool result. When truncated, tell the agent how to narrow.
      const rows = all.slice(0, MAX_EVENTS);
      const truncated = all.length > rows.length;
      return redact(
        JSON.stringify(
          {
            count: rows.length,
            total: all.length,
            ...(truncated
              ? { truncated: true, note: `Showing the first ${MAX_EVENTS} of ${all.length} events. Narrow with fromMs/toMs or filter by types.` }
              : {}),
            events: rows,
          },
          null,
          2,
        ),
      );
    },
  };

  const listTerminalCommandsTool: Tool = {
    name: "list_terminal_commands",
    description:
      "List indexed commands from the app-owned recorded terminal with command ids, timing, cwd, shell, exit status, interruption state and transcript ranges. Output is local-redacted. Use cursor/limit to page.",
    parameters: {
      type: "object",
      properties: {
        cursor: { type: "number", description: "Zero-based command cursor." },
        limit: { type: "number", description: "Rows to return, maximum 50." },
        fromMs: { type: "number", description: "Optional command start-time lower bound." },
        toMs: { type: "number", description: "Optional command start-time upper bound." },
      },
      additionalProperties: false,
    },
    handler: async (raw) => {
      const args = (raw ?? {}) as {
        cursor?: number;
        limit?: number;
        fromMs?: number;
        toMs?: number;
      };
      progress("Reading terminal command index…");
      const page = await listTerminalCommands(
        sessionDir,
        args.cursor ?? 0,
        Math.min(
          Math.max(Math.trunc(args.limit ?? MAX_TERMINAL_COMMANDS), 1),
          MAX_TERMINAL_COMMANDS,
        ),
      );
      const commands = page.commands
        .filter(
          (command) =>
            (args.fromMs == null || command.startAtMs >= args.fromMs) &&
            (args.toMs == null || command.startAtMs <= args.toMs),
        )
        .map((command) => ({
          ...command,
          command: truncate(command.command),
          cwd: truncate(command.cwd),
        }));
      return redact(
        JSON.stringify(
          {
            count: commands.length,
            nextCursor: page.nextCursor,
            commands,
          },
          null,
          2,
        ),
      );
    },
  };

  const searchTerminalOutputTool: Tool = {
    name: "search_terminal_output",
    description:
      "Search the full local recorded-terminal transcript by literal query, command id, or time window. Returns bounded, paginated, locally redacted excerpts only; it never sends the full transcript.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Case-insensitive literal text to find." },
        commandId: { type: "string", description: "Restrict output to one indexed command." },
        fromMs: { type: "number", description: "Output window start." },
        toMs: { type: "number", description: "Output window end." },
        cursor: { type: "number", description: "Cursor from a previous page." },
        limit: { type: "number", description: "Excerpt count, maximum 50." },
      },
      additionalProperties: false,
    },
    handler: async (raw) => {
      const args = (raw ?? {}) as {
        query?: string;
        commandId?: string;
        fromMs?: number;
        toMs?: number;
        cursor?: number;
        limit?: number;
      };
      progress("Searching recorded terminal output…");
      try {
        const page = await searchTerminalOutput(sessionDir, args);
        return redact(JSON.stringify(page, null, 2));
      } catch (error) {
        return `Could not search terminal output: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }
    },
  };

  const listFrames: Tool = {
    name: "list_frames",
    description:
      "List the screen frames already available for this session (file, atMs, source, reason). Returns an empty list when no video was recorded. Use get_frames to actually view frames.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: () => {
      progress("正在读取截图列表…");
      if (!extractor) return JSON.stringify({ hasVideo: false, frames: [] });
      const frames = extractor.capturedManifest.map((f) => ({
        file: f.file,
        atMs: rel(f.tMs),
      }));
      return JSON.stringify({ hasVideo: true, frames }, null, 2);
    },
  };

  const getFrames: Tool = {
    name: "get_frames",
    description:
      "Sample and VIEW the available 1 fps screen snapshots within a time window [fromMs, toMs] (atMs, ms since recording start) and return them inline as images. Optional `fps` can reduce sampling density but cannot add detail beyond the 1 fps capture. Optional `crop` {x,y,w,h} zooms a region. Use only where events are ambiguous.",
    parameters: {
      type: "object",
      properties: {
        fromMs: { type: "number", description: "Window start (atMs)." },
        toMs: { type: "number", description: "Window end (atMs)." },
        fps: { type: "number", description: "Sampling density up to the 1 fps source rate. Default 1." },
        crop: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            w: { type: "number" },
            h: { type: "number" },
          },
          required: ["x", "y", "w", "h"],
          additionalProperties: false,
        },
        reason: { type: "string", description: "Why you need a closer look." },
      },
      required: ["fromMs", "toMs"],
      additionalProperties: false,
    },
    handler: async (raw) => {
      const args = (raw ?? {}) as {
        fromMs?: number;
        toMs?: number;
        fps?: number;
        crop?: { x: number; y: number; w: number; h: number };
        reason?: string;
      };
      if (!extractor) {
        return { textResultForLlm: "No video was recorded for this session; no frames are available.", resultType: "failure" };
      }
      const fromMs = typeof args.fromMs === "number" ? args.fromMs : 0;
      const toMs = typeof args.toMs === "number" ? Math.max(fromMs, args.toMs) : fromMs + 3000;
      progress(`正在查看 ${sec(fromMs)}–${sec(toMs)} 秒画面…`);
      try {
        await extractor.extractWindow({
          startMs: abs(fromMs),
          endMs: abs(toMs),
          fps: args.fps,
          crop: args.crop,
          reason: args.reason ?? "describer:get_frames",
          maxFrames: MAX_IMAGES_PER_CALL,
          preserveTimeline: true,
        });
      } catch (err) {
        log.warn("get_frames extract failed:", err instanceof Error ? err.message : err);
      }

      const inWindow = extractor.manifest.filter((f) => {
        const atMs = rel(f.tMs);
        return atMs >= fromMs && atMs <= toMs;
      });
      if (inWindow.length === 0) {
        return { textResultForLlm: `No frames could be extracted for ${sec(fromMs)}–${sec(toMs)}s.`, resultType: "success" };
      }
      // Evenly sample which frames to attach as images (bounded cost).
      const picks: typeof inWindow = [];
      if (inWindow.length <= MAX_IMAGES_PER_CALL) picks.push(...inWindow);
      else {
        const stride = (inWindow.length - 1) / (MAX_IMAGES_PER_CALL - 1);
        for (let i = 0; i < MAX_IMAGES_PER_CALL; i++) picks.push(inWindow[Math.round(i * stride)]);
      }

      // Advanced protection: frames are the only image channel, so on-screen text
      // must be OCR'd + blurred before any pixels are sent. Policy:
      //   inactive          → serve raw frames (baseline behaviour).
      //   active, not ready  → WITHHOLD frames (assets still loading) — never raw.
      //   active, ready      → blur detected regions per frame; withhold on failure.
      const redactor = ctx.redaction.current?.frameRedactor ?? null;
      const protect = redactor?.active ?? false;
      if (redactor?.active && !redactor.ready) {
        return {
          textResultForLlm:
            "Advanced protection is on but the on-device OCR model could not be made ready (it may still be downloading, or the download failed, for example when offline), so screen frames are being withheld for this window to avoid sending unredacted on-screen text. Proceeding on events and narration; frames become available once the model is ready.",
          resultType: "success",
        };
      }

      const binaryResultsForLlm: { data: string; mimeType: string; type: "image"; description?: string }[] = [];
      let withheld = 0;
      for (const f of picks) {
        const file = path.join(sessionDir, "frames", f.file);
        if (!existsSync(file)) continue;
        try {
          let data: string;
          if (protect && redactor) {
            const buf = await redactor.redactFrame(file);
            if (!buf) {
              // Redaction failed for this frame — withhold it rather than serve raw.
              withheld++;
              continue;
            }
            data = buf.toString("base64");
          } else {
            data = readFileSync(file).toString("base64");
          }
          binaryResultsForLlm.push({
            data,
            mimeType: "image/jpeg",
            type: "image",
            description: `${sec(rel(f.tMs))}s (${f.source}) ${f.file}`,
          });
        } catch (err) {
          log.warn("frame read failed:", err instanceof Error ? err.message : err);
        }
      }
      const listing = inWindow.map((f) => `- ${sec(rel(f.tMs))}s ${f.file} (${f.source})`).join("\n");
      progress(`已读取 ${sec(fromMs)}–${sec(toMs)} 秒的 ${binaryResultsForLlm.length} 张截图。`);
      const protectNote = protect
        ? ` On-device Advanced protection blurred any detected sensitive on-screen text${withheld ? `; ${withheld} frame(s) were withheld because redaction failed` : ""}.`
        : "";
      return {
        textResultForLlm:
          `Frames in ${sec(fromMs)}–${sec(toMs)}s (${inWindow.length} total, ${binaryResultsForLlm.length} shown as images):\n${listing}${protectNote}`,
        binaryResultsForLlm,
        resultType: "success",
      };
    },
  };

  const getNarration: Tool = {
    name: "get_narration",
    description:
      "Return the user's spoken voice narration for this session as timestamped lines ([mm:ss] text). This is the user's own words describing what they are doing and why, so treat it as the most direct statement of intent and use it to name and order the steps. Optionally pass `query` to return only lines containing that text (case-insensitive). Returns a note when the user recorded no narration.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Only return narration lines containing this text (case-insensitive).",
        },
      },
      additionalProperties: false,
    },
    handler: (raw) => {
      const args = (raw ?? {}) as { query?: string };
      const transcript = readNarration(sessionDir);
      if (!transcript || transcript.segments.length === 0) {
        return "The user did not record any voice narration for this session.";
      }
      progress(args.query ? `正在搜索旁白“${args.query}”…` : "正在读取语音旁白…");
      const q = args.query?.trim().toLowerCase();
      const lines = transcript.segments
        .filter((s) => (q ? s.text.toLowerCase().includes(q) : true))
        .map((s) => `[${mmss(s.atMs)}] ${s.text}`);
      if (lines.length === 0) {
        return `No narration lines match “${args.query}”. Call get_narration with no query to read the whole transcript.`;
      }
      return redact(lines.join("\n"));
    },
  };

  const submitAnalysis: Tool = {
    name: "submit_analysis",
    description:
      "Submit your final structured analysis: the overall intent and the ordered list of steps. Call this exactly once when confident (and again on later turns after incorporating feedback).",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            'A short 2–5 word label for this task in Title Case, under ~40 characters, no trailing period, e.g. "Research Habit Articles" or "Save Teams Chat To Notes". Used as the session name in lists. Write a fresh, scannable name — do NOT just truncate the intent sentence.',
        },
        intent: { type: "string", description: "One sentence naming the user's overall goal." },
        intentConfidence: { type: "string", enum: ["high", "medium", "low"] },
        intentRationale: { type: "string", description: '1–2 sentences of evidence for the intent, in the past tense addressed to the user (e.g. "Navigated to the blog, copied a passage, then searched Google for it"). Avoid the third person.' },
        steps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Stable short id, e.g. \"s1\"." },
              title: {
                type: "string",
                description:
                  'A short label naming what the user did, in the past tense addressed to the user (e.g. "Opened the Teams event link", "Searched Google for the passage"). Not imperative or third person.',
              },
              detail: {
                type: "string",
                description:
                  'What happened and why it matters, in 1–3 sentences. Write in the past tense addressed to the user, starting with a past-tense verb (e.g. "Opened the Copilot Studio technical guide."). Do not use the third person ("The user…", "User was…") or the present tense.',
              },
              startMs: { type: "number", description: "Step start (atMs)." },
              endMs: { type: "number", description: "Step end (atMs)." },
              apps: { type: "array", items: { type: "string" } },
              evidence: { type: "array", items: { type: "string" } },
              browserEventIds: { type: "array", items: { type: "string" }, description:"IDs from get_browser_actions represented by this step. Group related real operations; every substantive browser operation must be represented." },
              confidence: { type: "string", enum: ["high", "medium", "low"] },
            },
            required: ["id", "title", "detail"],
            additionalProperties: false,
          },
        },
      },
      required: ["title", "intent", "steps"],
      additionalProperties: false,
    },
    handler: (raw) => {
      const annotations = readAnnotations();
      const firstMissing = annotations.findIndex(e => !inspectedAnnotations.has(e.payload.screenshot as string));
      if (firstMissing !== -1) return {
        resultType:"failure",
        textResultForLlm:`submit_analysis rejected: user annotations have not all been inspected. Call get_annotations with offset=${firstMissing} and follow nextOffset until null. Combine each click, crop, and region with nearby narration and surrounding events before submitting.`,
      };
      const missingBrowser = readBrowserActions().findIndex(e=>!inspectedBrowserActions.has(e.seq));
      if(missingBrowser>=0) return {resultType:"failure",textResultForLlm:`submit_analysis rejected: real browser actions have not all been inspected. Call get_browser_actions with offset=${missingBrowser} and follow nextOffset until null; use their controls, locators, values and timing in the trajectory.`};
      const parsed = AnalysisSubmissionSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          textResultForLlm:
            "submit_analysis rejected — the payload did not match the schema. Fix these and call again:\n" +
            parsed.error.issues.map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`).join("\n"),
          resultType: "failure",
        };
      }
      const browserActions = readBrowserActions();
      const referenced = new Set(parsed.data.steps.flatMap(s=>s.browserEventIds ?? []));
      const validIds = new Set(browserActions.map(e=>e.payload.eventId as string));
      if([...referenced].some(id=>!validIds.has(id))) return {resultType:"failure",textResultForLlm:"Unknown browserEventIds. Use exact IDs from get_browser_actions."};
      const unrepresented = browserActions.filter(e=>e.payload.action!=="scroll" && !referenced.has(e.payload.eventId as string));
      if(unrepresented.length) return {resultType:"failure",textResultForLlm:`Browser operations are missing from the trajectory. Add browserEventIds to appropriate steps, grouping related operations. Remaining IDs: ${unrepresented.slice(0,100).map(e=>e.payload.eventId).join(", ")}`};
      progress("已收到分析草稿。");
      onSubmit(parsed.data);
      return "Analysis recorded. You may stop now.";
    },
  };

  return [
    getTimeline,
    getBrowserActions,
    getAnnotations,
    getEvents,
    listTerminalCommandsTool,
    searchTerminalOutputTool,
    getNarration,
    listFrames,
    getFrames,
    submitAnalysis,
  ];
}
