import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const CONNECTION_ENV = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL", "ANTHROPIC_DEFAULT_HAIKU_MODEL"];
export function claudeConnectionSettings(source: NodeJS.ProcessEnv = process.env): {env:Record<string,string>;model?:string} {
  const configHome=source.CLAUDE_CONFIG_DIR ? path.resolve(source.CLAUDE_CONFIG_DIR) : path.join(source.HOME ?? source.USERPROFILE ?? homedir(),".claude");
  const file=path.join(configHome,"settings.json");
  if(!existsSync(file))return {env:{}};
  const settings=JSON.parse(readFileSync(file,"utf8"));
  return {env:Object.fromEntries(CONNECTION_ENV.flatMap(key=>typeof settings.env?.[key]==="string"?[[key,settings.env[key]]]:[])),...(typeof settings.model==="string"?{model:settings.model}:{})};
}
export function claudeTaskEnvironment(source: NodeJS.ProcessEnv = process.env, connection = source === process.env ? claudeConnectionSettings(source) : {env:{} as Record<string,string>}) {
  const allowed = ["PATH", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "CLAUDE_CONFIG_DIR", ...CONNECTION_ENV];
  return Object.fromEntries(allowed.flatMap(key => (source[key] ?? connection.env[key]) === undefined ? [] : [[key, (source[key] ?? connection.env[key])!]]));
}
