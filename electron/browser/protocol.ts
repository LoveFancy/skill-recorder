import { z } from "zod";
import type { BrowserAction } from "../../common/browser";
const text = z.string().max(512);
const coord = z.number().finite().min(-1e7).max(1e7);
const bounds = z.object({x:coord,y:coord,width:coord,height:coord});
export const BrowserWireEvent = z.object({
  eventId:z.string().min(1).max(100), sessionId:z.string().min(1).max(128),
  capturedAt:z.number().finite(),
  action:z.enum(["click","input","change","submit","navigation","scroll"]),
  url:z.string().max(2048).refine(s=>/^https?:\/\//.test(s)),title:text,
  tabId:z.number().int().nonnegative(),frameId:z.number().int().nonnegative(),documentId:text.optional(),
  viewport:z.object({width:coord,height:coord,dpr:z.number().min(0.1).max(20),scrollX:coord,scrollY:coord}),
  point:z.object({x:coord,y:coord}).optional(),
  element:z.object({tag:text,role:text.optional(),name:text.optional(),text:text.optional(),
    inputType:text.optional(),value:text.optional(),checked:z.boolean().optional(),redacted:z.boolean().optional(),
    locators:z.array(z.object({kind:z.enum(["css","role","text"]),value:text,unique:z.boolean()})).max(8),
    bounds,shadow:z.boolean().optional(),
  }).optional(),
});
export function validateBrowserEvent(raw:unknown,sessionId:string,startedAt:number,receivedAt=Date.now()):BrowserAction {
  const e=BrowserWireEvent.parse(raw);
  if(e.sessionId!==sessionId) throw new Error("stale session");
  if(e.capturedAt<startedAt || e.capturedAt>receivedAt+2000) throw new Error("invalid capture time");
  if(e.element && (e.element.redacted || /password|file|hidden/i.test(e.element.inputType ?? "") || /password|secret|token|api.?key|密码|密钥|验证码/i.test(e.element.name ?? ""))) {
    e.element={tag:e.element.tag,inputType:e.element.inputType,redacted:true,locators:[],bounds:e.element.bounds};
  }
  // Avoid forwarding credentials in navigation URLs, even if supplied by a client.
  const url=new URL(e.url); url.username=""; url.password=""; url.search=""; url.hash="";
  return {...e,url:url.toString(),receivedAt,scope:"user-bound-tab",coordinateSpace:"css-viewport"};
}
