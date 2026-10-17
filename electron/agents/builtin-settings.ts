import { safeStorage, app } from "electron";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { MailAccountSchema, type BuiltinToolsView, BUILTIN_SERVERS } from "../../common/builtin-tools";
import { processingDirectory } from "./settings";
import { atomicJson, fingerprint } from "../enrichment/store";

const SavedSchema = z.object({ mail: MailAccountSchema.extend({ encryptedPassword: z.string() }).nullable() });
const file = () => path.join(processingDirectory(), "builtin-tools.json");
function saved() { return existsSync(file()) ? SavedSchema.parse(JSON.parse(readFileSync(file(), "utf8"))) : {mail:null}; }
export function builtinToolsView(): BuiltinToolsView {
  const mail = saved().mail;
  if (!mail) return {mail:null};
  const {encryptedPassword, ...account} = mail;
  return {mail:{...account,hasPassword:!!encryptedPassword}};
}
export function saveBuiltinMail(input: unknown): BuiltinToolsView {
  if (input === null) { atomicJson(file(), {mail:null}); return builtinToolsView(); }
  const request = MailAccountSchema.extend({password:z.string().max(4096).optional()}).parse(input);
  const {password, ...account} = request;
  let encryptedPassword = saved().mail?.encryptedPassword;
  if (password) {
    if (!safeStorage.isEncryptionAvailable() || (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text"))
      throw new Error("系统安全存储不可用，无法保存邮箱授权码。");
    encryptedPassword = safeStorage.encryptString(password).toString("base64");
  }
  if (!encryptedPassword) throw new Error("请输入邮箱密码或应用专用授权码。");
  atomicJson(file(), {mail:{...account,encryptedPassword}});
  return builtinToolsView();
}
export function builtinSources() {
  return BUILTIN_SERVERS.map(item => ({
    ref: "builtin:" + item.name, kind: "mcp" as const, name:item.name, description:item.description,
    source: "builtin:" + item.name, sourceHash: fingerprint({version:1,name:item.name,account:item.name === "recorder-mail" ? saved().mail : null}),
    error:item.name === "recorder-mail" && !saved().mail ? "请先配置邮箱账号" : null,
  }));
}
export function builtinMcpConfiguration(name:string, allowedTools?:string[]) {
  if (!BUILTIN_SERVERS.some(item=>item.name===name)) throw new Error("未知内置工具");
  const env:Record<string,string> = { ELECTRON_RUN_AS_NODE:"1", SKILL_RECORDER_BUILTIN:name,
    SKILL_RECORDER_BROWSER_PROFILE:path.join(processingDirectory(),"browser-profile") };
  if (allowedTools) env.SKILL_RECORDER_BUILTIN_ALLOWED_TOOLS = JSON.stringify(allowedTools);
  if (name === "recorder-mail") {
    const mail = saved().mail;
    if (!mail) throw new Error("请先配置邮箱账号");
    const {encryptedPassword,...account} = mail;
    env.SKILL_RECORDER_MAIL_ACCOUNT = JSON.stringify({...account,password:safeStorage.decryptString(Buffer.from(encryptedPassword,"base64"))});
  }
  return {command:process.execPath,args:[path.join(app.getAppPath(),"dist-electron","builtin-mcp.js")],env};
}
