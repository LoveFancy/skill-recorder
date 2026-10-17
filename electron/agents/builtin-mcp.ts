import { createInterface } from "node:readline";
import { z } from "zod";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { simpleParser } from "mailparser";
import { MailAccountSchema } from "../../common/builtin-tools";

const mode = process.env.SKILL_RECORDER_BUILTIN;
const permitted: string[] | null = process.env.SKILL_RECORDER_BUILTIN_ALLOWED_TOOLS ? z.array(z.string()).parse(JSON.parse(process.env.SKILL_RECORDER_BUILTIN_ALLOWED_TOOLS)) : null;
const definitions = mode === "recorder-browser" ? [
  {name:"browser_navigate",description:"打开 HTTP(S) 网页并读取页面。独立 Chrome 窗口中可由用户手动登录。",schema:z.object({url:z.url()})},
  {name:"browser_snapshot",description:"读取当前页面的可访问性树、标题及 URL",schema:z.object({})},
  {name:"browser_screenshot",description:"获取当前页面可见区域截图",schema:z.object({})},
  {name:"browser_click",description:"点击指定 CSS 选择器匹配的元素，可能产生业务写操作",schema:z.object({selector:z.string().min(1).max(1000)})},
  {name:"browser_fill",description:"填写指定输入框，可能触发业务写操作",schema:z.object({selector:z.string().min(1).max(1000),value:z.string().max(24000)})},
] : mode === "recorder-mail" ? [
  {name:"mail_search",description:"只读搜索邮件，返回 UID、主题、发件人及日期，不改变已读状态",schema:z.object({query:z.string().max(1000).default(""),mailbox:z.string().max(300).default("INBOX"),limit:z.number().int().min(1).max(50).default(20)})},
  {name:"mail_read",description:"只读获取指定 UID 的邮件正文，不改变已读状态，不返回附件",schema:z.object({uid:z.number().int().positive(),mailbox:z.string().max(300).default("INBOX")})},
  {name:"mail_send",description:"发送邮件，会产生业务写操作；深度分析禁止使用",schema:z.object({to:z.array(z.email()).min(1).max(20),subject:z.string().max(1000),text:z.string().max(50000)})},
] : [];
const tools = definitions.filter(tool=>!permitted || permitted.includes(tool.name));
let context: BrowserContext | null = null;
let current: Page | null = null;
async function page() {
  if (!context) context = await chromium.launchPersistentContext(process.env.SKILL_RECORDER_BROWSER_PROFILE!, {channel:"chrome",headless:false,acceptDownloads:false});
  if (!current || current.isClosed()) current = context.pages()[0] ?? await context.newPage();
  return current;
}
async function browserCall(name:string,args:Record<string,unknown>) {
  const p = await page(); p.setDefaultTimeout(15000);
  if (name === "browser_navigate") {
    const url = new URL(String(args.url));
    if (!["https:","http:"].includes(url.protocol) || url.username || url.password) throw new Error("仅支持不含凭据的 HTTP(S) 网页");
    await p.goto(url.href,{waitUntil:"domcontentloaded",timeout:30000});
  }
  if (name === "browser_click") await p.locator(String(args.selector)).click();
  if (name === "browser_fill") await p.locator(String(args.selector)).fill(String(args.value));
  if (name === "browser_screenshot") return {content:[{type:"image",mimeType:"image/png",data:(await p.screenshot({timeout:15000})).toString("base64")}]};
  return text({url:p.url(),title:await p.title(),snapshot:(await p.locator("body").ariaSnapshot()).slice(0,50000)});
}
const text = (value:unknown) => ({content:[{type:"text",text:JSON.stringify(value)}]});
async function mailCall(name:string,args:Record<string,unknown>) {
  const account = MailAccountSchema.extend({password:z.string().min(1)}).parse(JSON.parse(process.env.SKILL_RECORDER_MAIL_ACCOUNT ?? "{}"));
  if (name === "mail_send") {
    const transport = nodemailer.createTransport({host:account.smtpHost,port:account.smtpPort,secure:account.smtpPort===465,requireTLS:true,auth:{user:account.username,pass:account.password},connectionTimeout:15000,socketTimeout:30000});
    try { const sent = await transport.sendMail({from:account.address,to:args.to as string[],subject:String(args.subject),text:String(args.text)}); return text({messageId:sent.messageId,accepted:sent.accepted}); }
    finally { transport.close(); }
  }
  const client = new ImapFlow({host:account.imapHost,port:account.imapPort,secure:true,auth:{user:account.username,pass:account.password},logger:false,connectionTimeout:15000,socketTimeout:30000});
  try {
    await client.connect();
    const lock = await client.getMailboxLock(String(args.mailbox),{readOnly:true});
    try {
      if (name === "mail_search") {
        const ids = await client.search(args.query ? {text:String(args.query)} : {all:true},{uid:true});
        if (!ids || !ids.length) return text({messages:[]});
        const selected = ids.slice(-Number(args.limit)).reverse();
        const messages=[];
        for await (const m of client.fetch(selected,{uid:true,envelope:true},{uid:true})) messages.push({uid:m.uid,envelope:m.envelope});
        return text({messages});
      }
      const message = await client.fetchOne(Number(args.uid),{envelope:true,source:{maxLength:256000}},{uid:true});
      if (!message) throw new Error("找不到指定邮件");
      const parsed = await simpleParser(message.source ?? Buffer.alloc(0),{skipHtmlToText:false,skipTextToHtml:true});
      return text({uid:message.uid,envelope:message.envelope,text:parsed.text?.slice(0,50000) ?? "",truncated:(message.source?.length ?? 0)>=256000});
    } finally { lock.release(); }
  } finally { await client.logout().catch(()=>client.close()); }
}

async function dispatch(request: {id?:number|string;method:string;params?:Record<string,unknown>}) {
  if (request.id === undefined) return;
  let result:unknown;
  if (request.method === "initialize") result={protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:mode,version:"1.0.0"}};
  else if (request.method === "ping") result={};
  else if (request.method === "tools/list") result={tools:tools.map(t=>({name:t.name,description:t.description,inputSchema:z.toJSONSchema(t.schema)}))};
  else if (request.method === "tools/call") {
    try {
      const definition=tools.find(t=>t.name===request.params?.name);
      if (!definition) throw new Error("未知或未启用的工具");
      const args=definition.schema.parse(request.params?.arguments ?? {});
      result=mode === "recorder-browser" ? await browserCall(definition.name,args) : await mailCall(definition.name,args);
    } catch {
      // Provider errors may include credentials. Keep raw errors off the wire.
      result={isError:true,content:[{type:"text",text:mode === "recorder-browser" ? "浏览器操作失败：请确认已安装 Chrome、页面可访问且工具已启用。" : "邮箱操作失败：请检查服务器、账号授权码及邮件 UID；未返回敏感诊断信息。"}]};
    }
  } else { process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:request.id,error:{code:-32601,message:"Method not found"}})+"\n"); return; }
  process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:request.id,result})+"\n");
}
const lines=createInterface({input:process.stdin});
let queue=Promise.resolve();
lines.on("line",line=>{
  if (line.length>1024*1024) return;
  queue=queue.then(async()=>{try{await dispatch(JSON.parse(line));}catch{process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:null,error:{code:-32700,message:"Invalid request"}})+"\n");}});
});
let closing=false;
async function close() { if(closing)return;closing=true;await queue;await context?.close().catch(()=>undefined);process.exit(0); }
lines.on("close",()=>void close());
process.on("SIGTERM",()=>void close());
process.on("SIGINT",()=>void close());
