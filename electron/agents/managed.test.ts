import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from "node:fs";
import path from "node:path";
import {tmpdir} from "node:os";
import {ensureManagedEnvironment,previewManagedSources,saveManagedSelection,selectedSkillContext,managedMcpConfiguration} from "./managed";
import {readProcessingSettings,saveProcessingSettings} from "./settings";
import {localRequest} from "./local-request";
import {capabilitySnapshot} from "./service";
function fixture(t:{after:(f:()=>void)=>void}) {
 const root=mkdtempSync(path.join(tmpdir(),"managed-agent-")),config=path.join(root,"claude");mkdirSync(config);
 for(const [key,value] of Object.entries({SKILL_RECORDER_PROCESSING_DIR:path.join(root,"processing"),CLAUDE_CONFIG_DIR:config})) {const old=process.env[key];process.env[key]=value;t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});}
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const file=path.join(config,".claude.json"),skill=path.join(config,"skills","business");mkdirSync(skill,{recursive:true});
 writeFileSync(path.join(skill,"SKILL.md"),"---\nname: business\ndescription: Business process\n---\nSELECTED-SKILL-INSTRUCTION");
 writeFileSync(file,JSON.stringify({mcpServers:{mail:{command:"never-launch-this",args:["original"],env:{TOKEN:"never-export-token"}}},projects:{"/unrelated":{mcpServers:{hidden:{command:"not-imported"}}}}}));
 return {root,config,file,skill};
}
const agent={agentKind:"claude-code" as const,status:"available" as const,executable:process.execPath,agentVersion:"2.1.251",checkedAt:1,lastError:null,controlled:true};
test("managed sources default off, selected context is isolated, diffs require review, frozen snapshots survive",async t=>{
 const {file,skill}=fixture(t),original=readFileSync(file,"utf8");
 const [view,second]=await Promise.all([ensureManagedEnvironment(agent),ensureManagedEnvironment(agent)]);assert.equal(view.environmentId,second.environmentId);
 assert.equal(view.capabilities.length,4);assert.ok(view.capabilities.every(c=>!c.enabled));assert.equal(JSON.stringify(view).includes("never-export-token"),false);
 assert.ok(view.capabilities.some(c=>c.source==="builtin:recorder-browser"));
 assert.equal(view.capabilities.find(c=>c.name==="recorder-mail")?.reviewState,"conflict");
 let w=readProcessingSettings().workspaces[0]!;assert.equal(selectedSkillContext(w),"");assert.equal(capabilitySnapshot(w.id)?.servers.length,0);
 const preview=await previewManagedSources(),refs=preview.capabilities.filter(c=>!c.source.startsWith("builtin:")).map(c=>c.ref);
 const saved=await saveManagedSelection({baseRevision:preview.baseRevision,sourceSnapshotId:preview.sourceSnapshotId,enabledRefs:refs,confirmed:true});
 w=readProcessingSettings().workspaces[0]!;assert.match(selectedSkillContext(w),/SELECTED-SKILL-INSTRUCTION/);assert.equal((await managedMcpConfiguration(w,"mail")).command,"never-launch-this");
 const frozen=w.capabilitySnapshotId!;assert.equal(capabilitySnapshot(w.id)?.servers.length,1);assert.equal(readFileSync(file,"utf8"),original);
 writeFileSync(path.join(skill,"SKILL.md"),"Changed skill");
 const changed=await previewManagedSources();assert.equal(changed.capabilities.find(c=>c.kind==="skill")?.change,"changed");assert.equal(changed.capabilities.find(c=>c.kind==="skill")?.enabled,false);
 await assert.rejects(saveManagedSelection({baseRevision:view.activeConfigRevision,sourceSnapshotId:view.sourceSnapshotId,enabledRefs:[],confirmed:true}),/版本/);
 const off=await saveManagedSelection({baseRevision:saved.activeConfigRevision,sourceSnapshotId:changed.sourceSnapshotId,enabledRefs:[],confirmed:true});
 assert.notEqual(off.activeConfigRevision,saved.activeConfigRevision);assert.equal(selectedSkillContext(readProcessingSettings().workspaces[0]!),"");assert.equal(capabilitySnapshot(w.id,frozen)?.servers.length,1);
 assert.match(selectedSkillContext(w),/SELECTED-SKILL-INSTRUCTION/,"captured workspace retains immutable revision");
 const stale=await previewManagedSources();writeFileSync(file,JSON.stringify({mcpServers:{}}));
 await assert.rejects(saveManagedSelection({baseRevision:off.activeConfigRevision,sourceSnapshotId:stale.sourceSnapshotId,enabledRefs:[],confirmed:true}),/来源已变化/);
 const removed=await previewManagedSources();assert.equal(removed.capabilities.find(c=>c.name==="mail")?.reviewState,"missing");
});
test("unreadable sources do not replace a valid revision; linked skill resources cannot load",async t=>{
 const {file,skill,root}=fixture(t);const view=await ensureManagedEnvironment(agent);
 symlinkSync(root,path.join(skill,"outside"));const diff=await previewManagedSources();assert.equal(diff.capabilities.find(c=>c.kind==="skill")?.reviewState,"conflict");
 await assert.rejects(saveManagedSelection({baseRevision:view.activeConfigRevision,sourceSnapshotId:diff.sourceSnapshotId,enabledRefs:[diff.capabilities.find(c=>c.kind==="skill")!.ref],confirmed:true}),/冲突/);
 writeFileSync(file,"invalid-json");await assert.rejects(previewManagedSources(),/保留上次/);assert.equal(readProcessingSettings().workspaces[0]?.activeConfigRevision,view.activeConfigRevision);
});

test("actual subprocess payload contains only chosen Skill resources and native capabilities stay disabled",async t=>{
 const {root}=fixture(t);await ensureManagedEnvironment(agent);const p=await previewManagedSources();
 const skill=p.capabilities.find(c=>c.kind==="skill")!;
 await saveManagedSelection({baseRevision:p.baseRevision,sourceSnapshotId:p.sourceSnapshotId,enabledRefs:[skill.ref],confirmed:true});
 const exe=path.join(root,"fake-claude"),capture=path.join(root,"capture.json");
 writeFileSync(exe,`#!/usr/bin/env node
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{require('node:fs').writeFileSync(${JSON.stringify(capture)},JSON.stringify({args:process.argv.slice(2),input}));console.log(JSON.stringify({type:'result',structured_output:{content:'ok',toolCalls:[]}}));});`,{mode:0o700});
 let w={...readProcessingSettings().workspaces[0]!,executable:exe};
 await localRequest(w)("http://local",{body:JSON.stringify({messages:[],tools:[]})});
 const request=JSON.parse(readFileSync(capture,"utf8"));assert.match(request.input,/SELECTED-SKILL-INSTRUCTION/);assert.ok(request.args.includes("--safe-mode"));assert.equal(request.args[request.args.indexOf("--mcp-config")+1],'{"mcpServers":{}}');assert.doesNotMatch(request.input,/never-export-token|never-launch-this/);
 await localRequest(w,undefined,{includeSkillContext:false})("http://local",{body:JSON.stringify({messages:[],tools:[]})});
 assert.doesNotMatch(JSON.parse(readFileSync(capture,"utf8")).input,/SELECTED-SKILL-INSTRUCTION/,'connection checks exclude selected Skill content');
 const next=await previewManagedSources();await saveManagedSelection({baseRevision:next.baseRevision,sourceSnapshotId:next.sourceSnapshotId,enabledRefs:[],confirmed:true});
 w={...readProcessingSettings().workspaces[0]!,executable:exe};await localRequest(w)("http://local",{body:JSON.stringify({messages:[],tools:[]})});assert.doesNotMatch(JSON.parse(readFileSync(capture,"utf8")).input,/SELECTED-SKILL-INSTRUCTION/);
});

test("migration preserves legacy project records and does not import or delete their files",async t=>{
 const {root}=fixture(t),project=path.join(root,"old-project");mkdirSync(project);writeFileSync(path.join(project,".mcp.json"),'{"mcpServers":{"projectOnly":{"command":"not-imported"}}}');
 const id="00000000-0000-4000-8000-000000000001",legacy={id,name:"Legacy",agentKind:"claude-code" as const,executable:process.execPath,projectDirectory:project,createdAt:1,updatedAt:1,agentVersion:"old",status:"ready" as const,lastInspectedAt:null,lastError:null,capabilitySnapshotId:null,trustedAt:1};
 saveProcessingSettings({version:1,backendPreference:"auto",defaultProcessingWorkspaceId:id,workspaces:[legacy]});
 const view=await ensureManagedEnvironment(agent),settings=readProcessingSettings();assert.equal(settings.defaultProcessingWorkspaceId,view.environmentId);assert.deepEqual(settings.workspaces.find(w=>w.id===id),legacy);assert.equal(view.capabilities.some(c=>c.name==="projectOnly"),false);assert.match(readFileSync(path.join(project,".mcp.json"),"utf8"),/projectOnly/);
});
