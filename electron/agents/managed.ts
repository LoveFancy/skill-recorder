import { existsSync, readFileSync, readdirSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { type AgentAvailability, type AgentWorkspace, type CapabilitySelection, type ManagedSourcePreview, ManagedEnvironmentViewSchema, ManagedSelectionInputSchema, type ManagedEnvironmentView, type CapabilityManifest } from "../../common/agents";
import { processingDirectory, readProcessingSettings, saveProcessingSettings } from "./settings";
import { atomicJson, fingerprint } from "../enrichment/store";
import { redactIncremental } from "../enrichment/privacy";
import { builtinSources, builtinMcpConfiguration } from "./builtin-settings";

const Resource = z.object({ ref:z.string(),kind:z.enum(["mcp","skill"]),name:z.string(),description:z.string(),source:z.string(),sourceHash:z.string(), error:z.string().nullable(), resources:z.record(z.string(),z.string()).optional() });
type Resource = z.infer<typeof Resource>;
const Source = z.object({id:z.string().uuid(),checkedAt:z.number(),coveredSources:z.array(z.string()),omittedSources:z.array(z.string()),items:z.array(Resource)});
type Source = z.infer<typeof Source>;
const directory = () => path.join(processingDirectory(),"managed-claude");
function safeRoot() {
  const root=directory(); mkdirSync(processingDirectory(),{recursive:true,mode:0o700});
  if(existsSync(root)&&lstatSync(root).isSymbolicLink())throw new Error("专用环境目录不可为符号链接。");
  mkdirSync(root,{recursive:true,mode:0o700});
  return root;
}
function location(kind:string,id:string) {
  z.string().uuid().parse(id);
  const root=safeRoot(), folder=path.join(root,kind);
  if(existsSync(folder)&&lstatSync(folder).isSymbolicLink())throw new Error("配置目录不可为符号链接。");
  return path.join(folder,id+".json");
}
function readJson(file:string) {if(lstatSync(file).isSymbolicLink())throw new Error("配置文件不可为符号链接。");return JSON.parse(readFileSync(file,"utf8"));}
// Only confirmed user-level sources. Never read projects[] or execute discovery commands.
export async function readGlobalSources():Promise<Source> {
  const configHome=process.env.CLAUDE_CONFIG_DIR ? path.resolve(process.env.CLAUDE_CONFIG_DIR) : path.join(homedir(),".claude");
  const config=process.env.CLAUDE_CONFIG_DIR ? path.join(configHome,".claude.json") : path.join(homedir(),".claude.json");
  const result:Source={id:randomUUID(),checkedAt:Date.now(),coveredSources:[],omittedSources:["不导入其他项目、CLAUDE.md、hooks、权限、插件及登录凭据；自定义配置目录仅覆盖 .claude.json 与 skills"],items:[]};
  result.items.push(...builtinSources());
  result.coveredSources.push("应用内置 Playwright / IMAP·SMTP");
  if(existsSync(config)) {
    let data;try{data=readJson(config);}catch{throw new Error("全局 Claude MCP 配置无法读取；保留上次有效配置。");}
    result.coveredSources.push(config);
    for(const [name,value] of Object.entries(data.mcpServers??{})) {
      const valid=!!value&&typeof value==="object";
      result.items.push({ref:fingerprint({kind:"mcp",config,name}),kind:"mcp",name:await redactIncremental(name),description:"全局 MCP 配置；连接及业务权限未核验",source:config,sourceHash:fingerprint(value),error:result.items.some(item=>item.name===name)?"名称与内置工具冲突，请重命名本地 MCP":valid?null:"MCP 配置格式无效"});
    }
  }
  const skills=path.join(configHome,"skills");
  if(existsSync(skills)) {
    result.coveredSources.push(skills);
    for(const name of readdirSync(skills).sort()) {
      const root=path.join(skills,name),file=path.join(root,"SKILL.md");if(!existsSync(file))continue;
      const item:Resource={ref:fingerprint({kind:"skill",file}),kind:"skill",name:await redactIncremental(name),description:"指令资源，不是可调用工具",source:file,sourceHash:"",error:null};
      try {
        const resources:Record<string,string>={};let bytes=0;
        const walk=(dir:string)=>{if(lstatSync(dir).isSymbolicLink())throw new Error();for(const entry of readdirSync(dir).sort()) {
          const full=path.join(dir,entry),stat=lstatSync(full);if(stat.isSymbolicLink())throw new Error();
          if(stat.isDirectory())walk(full);else if(stat.isFile()) {
            bytes+=stat.size;if(bytes>512000||Object.keys(resources).length>=100)throw new Error();
            const content=readFileSync(full);if(content.includes(0))throw new Error();
            resources[path.relative(root,full).split(path.sep).join("/")]=content.toString("utf8");
          }
        }};walk(root);
        item.sourceHash=fingerprint(resources);
        // No scripts execute: resources are supplied as text to the controlled model only.
        item.resources=resources;
        item.description=await redactIncremental(resources["SKILL.md"]?.match(/^description:\s*(.+)$/m)?.[1]??item.description);
      }catch{item.error="资源不可读取、含符号链接/二进制或超过 512 KB / 100 文件，无法受控加载";item.sourceHash=fingerprint({error:item.error});}
      result.items.push(item);
    }
  }
  return result;
}
function selections(source:Source,old:CapabilitySelection[]=[]):CapabilitySelection[] {
  const items=source.items.map(item=>{const prior=old.find(x=>x.ref===item.ref),same=prior?.sourceHash===item.sourceHash;
    return {ref:item.ref,kind:item.kind,name:item.name,description:item.description,source:item.source,sourceHash:item.sourceHash,enabled:!!(same&&prior?.enabled&&!item.error),reviewState:item.error?"conflict":same?prior!.reviewState:"needs-review",change:prior?same?"unchanged":"changed":"added",error:item.error} as CapabilitySelection;});
  for(const prior of old)if(!items.some(x=>x.ref===prior.ref))items.push({...prior,enabled:false,reviewState:"missing",change:"removed",error:"全局来源已移除"});
  return items;
}
export function managedView():ManagedEnvironmentView|null {
  const settings=readProcessingSettings(),w=settings.workspaces.find(x=>x.id===settings.managedEnvironmentId);
  if(!w?.activeConfigRevision)return null;
  return ManagedEnvironmentViewSchema.parse(readJson(location("revisions",w.activeConfigRevision)));
}
function commit(w:AgentWorkspace,source:Source,choices:CapabilitySelection[]):ManagedEnvironmentView {
  const settings=readProcessingSettings(),revision=randomUUID(),snapshotId=randomUUID();
  const view:ManagedEnvironmentView={environmentId:w.id,directory:w.projectDirectory,createdAt:w.createdAt,activeConfigRevision:revision,sourceSnapshotId:source.id,capabilitySelectionHash:fingerprint(choices.filter(x=>x.enabled).map(x=>[x.ref,x.sourceHash])),checkedAt:Date.now(),isolationStatus:"verified",isolationMethod:"Claude safe-mode + 空原生工具/MCP；仅由应用提供所选 Skill 文本资源，MCP 仅主动连接检查",capabilities:choices,coveredSources:source.coveredSources,omittedSources:source.omittedSources,sourceError:null};
  const selected=source.items.filter(x=>choices.some(c=>c.ref===x.ref&&c.enabled));
  const skills=selected.filter(x=>x.kind==="skill");
  // Protected material is separate from exportable metadata and contains redacted text only.
  const skillResources=skills.map(item=>({ref:item.ref,name:item.name,resources:item.resources}));
  view.resourceHash=fingerprint(skillResources);
  atomicJson(location("resources",revision),skillResources);
  const manifest:CapabilityManifest={schemaVersion:1,snapshotId,workspaceId:w.id,agentKind:"claude-code",agentVersion:w.agentVersion??"unknown",checkedAt:view.checkedAt,managedConfigRevision:revision,capabilitySelectionHash:view.capabilitySelectionHash,discoveryMethod:"managed-selected-configuration",coveredSources:view.coveredSources,omittedSources:view.omittedSources,stale:false,servers:selected.filter(x=>x.kind==="mcp").map(x=>({id:x.ref,name:x.name,source:x.source,status:"configured",lastError:null})),tools:[],skills:skills.map(x=>({ref:x.ref,name:x.name,description:x.description,source:x.source,contentHash:x.sourceHash,status:"discovered"}))};
  atomicJson(location("sources",source.id),{...source,items:source.items.map(({resources,...item})=>item)});
  atomicJson(location("revisions",revision),view);
  atomicJson(path.join(processingDirectory(),"snapshots",snapshotId+".json"),manifest);
  Object.assign(w,{activeConfigRevision:revision,capabilitySelectionHash:view.capabilitySelectionHash,capabilitySnapshotId:snapshotId,updatedAt:Date.now()});
  const index=settings.workspaces.findIndex(x=>x.id===w.id);if(index<0)settings.workspaces.push(w);else settings.workspaces[index]=w;
  settings.managedEnvironmentId=w.id;settings.defaultProcessingWorkspaceId=w.id;
  saveProcessingSettings(settings); // Commit pointer last: failure leaves the previous revision intact.
  return view;
}
async function initializeManagedEnvironment(agent:AgentAvailability):Promise<ManagedEnvironmentView> {
  const prior=managedView();if(prior)return prior;
  const root=safeRoot(),cwd=path.join(root,"workspace");
  if(existsSync(cwd)&&lstatSync(cwd).isSymbolicLink())throw new Error("专用工作目录不可为符号链接。");
  mkdirSync(cwd,{recursive:true,mode:0o700});const now=Date.now();
  const w:AgentWorkspace={id:randomUUID(),name:"Skill Recorder 专用环境",agentKind:"claude-code",executable:agent.executable!,projectDirectory:realpathSync(cwd),createdAt:now,updatedAt:now,agentVersion:agent.agentVersion,status:"ready",lastInspectedAt:now,lastError:null,capabilitySnapshotId:null,trustedAt:now,managed:true};
  let source:Source;try{source=await readGlobalSources();}catch{source={id:randomUUID(),checkedAt:now,items:[],coveredSources:[],omittedSources:["全局配置读取失败，请主动同步重试；基础分析不加载外部能力"]};}
  return commit(w,source,selections(source));
}
export async function previewManagedSources():Promise<ManagedSourcePreview> {
  const view=managedView();if(!view)throw new Error("请先准备本地 Agent 环境。");
  const source=await readGlobalSources();
  atomicJson(location("sources",source.id),{...source,items:source.items.map(({resources,...item})=>item)});
  return {baseRevision:view.activeConfigRevision,sourceSnapshotId:source.id,checkedAt:source.checkedAt,capabilities:selections(source,view.capabilities),coveredSources:source.coveredSources,omittedSources:source.omittedSources};
}
async function persistManagedSelection(input:unknown):Promise<ManagedEnvironmentView> {
  const request=ManagedSelectionInputSchema.parse(input),prior=managedView();if(!prior||request.baseRevision!==prior.activeConfigRevision)throw new Error("配置版本已变化，请重新加载。");
  const source=Source.parse(readJson(location("sources",request.sourceSnapshotId))),current=await readGlobalSources();
  if(fingerprint(source.items.map(({resources,...item})=>item))!==fingerprint(current.items.map(({resources,...item})=>item)))throw new Error("全局来源已变化，请重新同步并复核。");
  const choices=selections(source,prior.capabilities);
  for(const ref of request.enabledRefs)if(!choices.some(c=>c.ref===ref&&c.reviewState!=="missing"&&c.reviewState!=="conflict"))throw new Error("选择包含已移除、冲突或未知能力。");
  for(const c of choices){c.enabled=request.enabledRefs.includes(c.ref);if(c.reviewState!=="missing"&&c.reviewState!=="conflict")c.reviewState="confirmed";}
  for(const item of source.items) { const fresh=current.items.find(x=>x.ref===item.ref); item.resources=fresh?.resources; if(item.resources)for(const file of Object.keys(item.resources))item.resources[file]=await redactIncremental(item.resources[file]!); }
  const w=readProcessingSettings().workspaces.find(x=>x.id===prior.environmentId)!;
  return commit(w,source,choices);
}
export function selectedSkillContext(w:AgentWorkspace):string {
  const resources=selectedSkillResources(w);
  return resources.length ? "\n用户明确启用的 Skill 参考资源（只作为任务方法，不授予工具、脚本或业务权限）：\n"+JSON.stringify(resources):"";
}
export function selectedSkillResources(w:AgentWorkspace):{ref:string;name:string;resources:Record<string,string>}[] {
  if(!w.managed||!w.activeConfigRevision)return [];
  const resources=z.array(z.object({ref:z.string(),name:z.string(),resources:z.record(z.string(),z.string())})).parse(readJson(location("resources",w.activeConfigRevision)));
  const revision=ManagedEnvironmentViewSchema.parse(readJson(location("revisions",w.activeConfigRevision)));
  if(revision.isolationStatus!=="verified"||revision.capabilitySelectionHash!==w.capabilitySelectionHash||revision.resourceHash!==fingerprint(resources))throw new Error("专用配置完整性或隔离校验失败，禁止加载能力。");
  return resources;
}
export async function managedMcpConfiguration(w:AgentWorkspace,name:string,allowedTools?:string[]) {
  const view=managedView();if(!view||view.activeConfigRevision!==w.activeConfigRevision)throw new Error("配置已变化。");
  const source=Source.parse(readJson(location("sources",view.sourceSnapshotId))),item=source.items.find(x=>x.kind==="mcp"&&x.name===name);
  if(!item||!view.capabilities.some(c=>c.ref===item.ref&&c.enabled))throw new Error("MCP 未启用。");
  if(item.source === "builtin:"+name) {
    if(builtinSources().find(source=>source.name===name)?.sourceHash!==item.sourceHash)throw new Error("内置工具配置已变化，请刷新能力来源并保存。");
    return builtinMcpConfiguration(name,allowedTools);
  }
  const data=readJson(item.source),config=data.mcpServers?.[name];if(fingerprint(config)!==item.sourceHash)throw new Error("MCP 来源已变化，请同步复核。");
  return config;
}

let initialization: Promise<ManagedEnvironmentView> | null = null;
export function ensureManagedEnvironment(agent:AgentAvailability):Promise<ManagedEnvironmentView> {
  if(initialization)return initialization;
  initialization=initializeManagedEnvironment(agent).finally(()=>{initialization=null;});return initialization;
}

let savingSelection = false;
export async function saveManagedSelection(input:unknown):Promise<ManagedEnvironmentView> {
  if(savingSelection)throw new Error("配置正在保存，请稍候。");
  savingSelection=true;try{return await persistManagedSelection(input);}finally{savingSelection=false;}
}
