import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { safeStorage } from "electron";
import { builtinSources, builtinToolsView, saveBuiltinMail, builtinMcpConfiguration } from "./builtin-settings";
import { builtinToolAccess } from "../../common/builtin-tools";

test("mail credentials are encrypted, never returned, and scoped to the dedicated MCP",t=>{
  const root=mkdtempSync(path.join(tmpdir(),"builtin-mail-")),previous=process.env.SKILL_RECORDER_PROCESSING_DIR;
  process.env.SKILL_RECORDER_PROCESSING_DIR=root;
  t.after(()=>{if(previous===undefined)delete process.env.SKILL_RECORDER_PROCESSING_DIR;else process.env.SKILL_RECORDER_PROCESSING_DIR=previous;rmSync(root,{recursive:true,force:true});});
  t.mock.method(safeStorage,"isEncryptionAvailable",()=>true);
  t.mock.method(safeStorage,"getSelectedStorageBackend",()=>"gnome_libsecret");
  t.mock.method(safeStorage,"encryptString",(value:string)=>Buffer.from(value.split("").reverse().join("")));
  t.mock.method(safeStorage,"decryptString",(value:Buffer)=>value.toString().split("").reverse().join(""));
  assert.equal(builtinToolsView().mail,null);
  const account={address:"person@example.com",username:"person@example.com",imapHost:"imap.example.com",imapPort:993,smtpHost:"smtp.example.com",smtpPort:465};
  assert.throws(()=>saveBuiltinMail(account),/授权码/);
  const view=saveBuiltinMail({...account,password:"private-password"});
  assert.equal(view.mail?.hasPassword,true);
  assert.doesNotMatch(JSON.stringify(view),/private-password|encryptedPassword/);
  assert.doesNotMatch(readFileSync(path.join(root,"builtin-tools.json"),"utf8"),/private-password/);
  const sources=builtinSources();assert.equal(sources.find(s=>s.name==="recorder-mail")?.error,null);
  assert.equal(builtinToolAccess("recorder-mail","mail_send"),"write");
  assert.equal(builtinToolAccess("recorder-mail","mail_read"),"read");
  assert.equal(builtinToolAccess("recorder-browser","browser_click"),"write");
  assert.equal(builtinToolAccess("recorder-browser","browser_snapshot"),"read");
  const config=builtinMcpConfiguration("recorder-mail",["mail_read"]);
  assert.deepEqual(JSON.parse(config.env.SKILL_RECORDER_BUILTIN_ALLOWED_TOOLS),["mail_read"]);
  assert.equal(JSON.parse(config.env.SKILL_RECORDER_MAIL_ACCOUNT).password,"private-password");
  assert.equal(builtinMcpConfiguration("recorder-browser").env.SKILL_RECORDER_MAIL_ACCOUNT,undefined);
  saveBuiltinMail(account);
  assert.equal(builtinToolsView().mail?.hasPassword,true);
  saveBuiltinMail(null);assert.equal(builtinToolsView().mail,null);
});

test("unavailable secure storage never persists plaintext",t=>{
  t.mock.method(safeStorage,"isEncryptionAvailable",()=>false);
  assert.throws(()=>saveBuiltinMail({address:"person@example.com",username:"person",imapHost:"imap.example.com",smtpHost:"smtp.example.com",password:"secret"}),/安全存储/);
});
