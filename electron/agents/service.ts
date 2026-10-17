import { ensureManagedEnvironment } from "./managed";
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  lstatSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  type AgentAvailability,
  type AgentWorkspace,
  type CapabilityManifest,
  CapabilityManifestSchema,
  type ProcessingStatus,
} from "../../common/agents";
import { runProcess } from "./process";
import {
  processingDirectory,
  readProcessingSettings,
  saveProcessingSettings,
} from "./settings";
import { atomicJson, fingerprint } from "../enrichment/store";
import { getAiSettings } from "../ai/settings";
import { redactIncremental } from "../enrichment/privacy";

export function chooseBackend(
  preference: string,
  availability: AgentAvailability,
): "local-agent" | "api" {
  if (preference === "api") return "api";
  if (availability.status === "not-installed" && preference === "auto")
    return "api";
  if (availability.status !== "available")
    throw new Error(availability.lastError?.message ?? "本地 Agent 不可用。");
  return "local-agent";
}
export async function detectAgent(
  explicit?: string,
): Promise<AgentAvailability> {
  const result: AgentAvailability = {
    agentKind: "claude-code",
    status: "not-installed",
    executable: null,
    agentVersion: null,
    checkedAt: Date.now(),
    lastError: null,
    controlled: false,
  };
  const names =
    process.platform === "win32" ? ["claude.exe", "claude.cmd"] : ["claude"];
  const candidates = explicit
    ? [explicit]
    : [
        ...(process.env.PATH ?? "")
          .split(path.delimiter)
          .flatMap((d) => names.map((n) => path.join(d, n))),
        path.join(homedir(), ".local", "bin", names[0]!),
      ];
  const exe = candidates.find((p) => existsSync(p));
  if (!exe) {
    if (explicit) {
      result.status = "check-failed";
      result.lastError = { code: "path", message: "指定的 Agent 程序不存在。" };
    }
    return result;
  }
  result.executable = exe;
  try {
    accessSync(exe, constants.X_OK);
    const version = await runProcess(exe, ["--version"]);
    result.agentVersion = version.trim().split(/\s/)[0]!;
    const help = await runProcess(exe, ["--help"]);
    if (
      ![
        "--json-schema",
        "--tools",
        "--strict-mcp-config",
        "--input-format",
        "--safe-mode",
      ].every((flag) => help.includes(flag))
    ) {
      result.status = "incompatible";
      throw new Error("Claude 版本不支持所需的隔离与结构化接口，请升级。");
    }
    const auth = JSON.parse(await runProcess(exe, ["auth", "status"]));
    if (auth.loggedIn !== true) {
      result.status = "auth-required";
      throw new Error("Claude 尚未登录，请在线下运行 claude auth login。");
    }
    result.status = "available";
    result.controlled = true;
  } catch (error) {
    if (result.status === "not-installed") result.status = "check-failed";
    result.lastError = {
      code: result.status,
      message: error instanceof Error ? error.message : "Agent 检查失败。",
    };
  }
  return result;
}
export async function processingStatus(): Promise<ProcessingStatus> {
  let settings = readProcessingSettings();
  const prior = settings.workspaces.find(w => w.id === settings.managedEnvironmentId);
  const availability = await detectAgent(prior?.executable);
  let backend: ProcessingStatus["backend"] = null, error: string | null = null;
  let managed: ProcessingStatus["managed"] = null;
  try {
    backend = chooseBackend(settings.backendPreference, availability);
    if (backend === "local-agent") {
      managed = await ensureManagedEnvironment(availability);
      settings = readProcessingSettings();
      const workspace = settings.workspaces.find(w=>w.id===managed!.environmentId)!;
      if (lstatSync(workspace.projectDirectory).isSymbolicLink() || !statSync(workspace.projectDirectory).isDirectory()) throw new Error("专用环境目录不可用。");
      accessSync(workspace.projectDirectory, constants.R_OK);
      if (!availability.controlled) throw new Error("无法保证能力隔离，请升级 Claude 或使用 API。");
    } else if (!getAiSettings().configured) throw new Error("本机未安装可用 Agent，请配置 API 或安装 Claude。");
  } catch(e) { error=e instanceof Error?e.message:"配置检查失败。"; }
  return {settings,availability,backend,ready:error===null,error,managed};
}

export async function associateWorkspace(input: {
  directory: string;
  name: string;
  trust: boolean;
  create?: boolean;
  executable?: string;
}): Promise<AgentWorkspace> {
  if (input.trust !== true) throw new Error("必须明确确认目录信任。");
  if (!path.isAbsolute(input.directory) || !input.name.trim())
    throw new Error("请输入项目名称并选择绝对路径。");
  if (input.create)
    mkdirSync(input.directory, { recursive: true, mode: 0o700 });
  const directory = realpathSync(input.directory);
  if (!statSync(directory).isDirectory()) throw new Error("请选择目录。");
  const agent = await detectAgent(input.executable);
  if (!agent.executable) throw new Error("请先安装 Claude Code。");
  const settings = readProcessingSettings();
  if (settings.workspaces.some((w) => w.projectDirectory === directory))
    throw new Error("目录已关联。");
  const now = Date.now();
  const w: AgentWorkspace = {
    id: randomUUID(),
    name: input.name.trim(),
    agentKind: "claude-code",
    executable: agent.executable,
    projectDirectory: directory,
    createdAt: now,
    updatedAt: now,
    agentVersion: agent.agentVersion,
    status: agent.status === "available" ? "ready" : "error",
    lastInspectedAt: null,
    lastError: agent.lastError,
    capabilitySnapshotId: null,
    trustedAt: now,
  };
  settings.workspaces.push(w);
  settings.defaultProcessingWorkspaceId ??= w.id;
  saveProcessingSettings(settings);
  return w;
}
export function capabilitySnapshot(id: string, snapshotId?: string): CapabilityManifest | null {
  const workspace = readProcessingSettings().workspaces.find(
    (w) => w.id === id,
  );
  if (!workspace) throw new Error("项目不存在。");
  if (!workspace.capabilitySnapshotId && !snapshotId) return null;
  if (snapshotId && !/^[0-9a-f-]{36}$/i.test(snapshotId)) throw new Error("非法快照引用。");
  const manifest = CapabilityManifestSchema.parse(
    JSON.parse(
      readFileSync(
        path.join(
          processingDirectory(),
          "snapshots",
          (snapshotId ?? workspace.capabilitySnapshotId) + ".json",
        ),
        "utf8",
      ),
    ),
  );
  if (manifest.workspaceId !== id) throw new Error("快照环境不匹配。");
  manifest.stale = Date.now() - manifest.checkedAt > 86400000;
  const stateFile = path.join(
    processingDirectory(),
    "snapshots",
    manifest.snapshotId + ".sources.json",
  );
  if (existsSync(stateFile)) {
    const sources = JSON.parse(readFileSync(stateFile, "utf8")) as {
      path: string;
      hash: string;
    }[];
    if (
      sources.some(
        (source) =>
          !existsSync(source.path) ||
          fingerprint(readFileSync(source.path, "utf8")) !== source.hash,
      )
    )
      manifest.stale = true;
  }
  return manifest;
}
/** Config-only inspection: does not start MCP or claim live connectivity. */
export async function inspectCapabilities(
  id: string,
): Promise<CapabilityManifest> {
  const settings = readProcessingSettings(),
    w = settings.workspaces.find((w) => w.id === id);
  if (!w?.trustedAt) throw new Error("项目未关联或未信任。");
  if (w.managed) { const snapshot=capabilitySnapshot(id); if(!snapshot)throw new Error("专用环境快照不可用。"); return snapshot; }
  const agent = await detectAgent(w.executable);
  const m: CapabilityManifest = {
    schemaVersion: 1,
    snapshotId: randomUUID(),
    workspaceId: id,
    agentKind: "claude-code",
    agentVersion: agent.agentVersion ?? "unknown",
    checkedAt: Date.now(),
    discoveryMethod: "configuration-only",
    coveredSources: [],
    omittedSources: ["插件/远程托管能力未枚举；不会假装已连接"],
    stale: false,
    servers: [],
    tools: [],
    skills: [],
  };
  const configs = [
    path.join(homedir(), ".claude.json"),
    path.join(w.projectDirectory, ".mcp.json"),
  ];
  for (const file of configs) {
    if (!existsSync(file)) continue;
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      m.coveredSources.push(file);
      const servers = file.endsWith(".claude.json")
        ? {
            ...value.mcpServers,
            ...value.projects?.[w.projectDirectory]?.mcpServers,
          }
        : value.mcpServers;
      for (const name of Object.keys(servers ?? {})) {
        const previous = m.servers.find((s) => s.name === name);
        if (previous) {
          previous.status = "unverified";
          previous.lastError = {
            code: "source-conflict",
            message: "多个来源声明同名 MCP，需在线下确认。",
          };
          continue;
        }
        m.servers.push({
          id: fingerprint({ file, name }).slice(0, 24),
          name: await redactIncremental(name),
          source: file,
          status: "configured",
          lastError: null,
        });
      }
    } catch {
      m.omittedSources.push(file + "：无法读取或解析");
    }
  }
  for (const root of [
    path.join(homedir(), ".claude", "skills"),
    path.join(w.projectDirectory, ".claude", "skills"),
  ]) {
    if (!existsSync(root)) continue;
    m.coveredSources.push(root);
    for (const name of readdirSync(root)) {
      const file = path.join(root, name, "SKILL.md");
      if (!existsSync(file)) continue;
      try {
        const content = readFileSync(file, "utf8");
        const same = m.skills.find((s) => s.name === name);
        if (same) same.status = "conflict";
        m.skills.push({
          ref: fingerprint(file).slice(0, 24),
          name: await redactIncremental(name),
          description: await redactIncremental(
            content.match(/^description:\s*(.+)$/m)?.[1] ??
              "已发现文件；未验证加载，不是可调用工具",
          ),
          source: file,
          contentHash: fingerprint(content),
          status: same ? "conflict" : "discovered",
        });
      } catch {
        m.skills.push({
          ref: fingerprint(file).slice(0, 24),
          name,
          description: "无法读取",
          source: file,
          contentHash: null,
          status: "unreadable",
        });
      }
    }
  }
  atomicJson(
    path.join(processingDirectory(), "snapshots", m.snapshotId + ".json"),
    m,
  );
  atomicJson(
    path.join(
      processingDirectory(),
      "snapshots",
      m.snapshotId + ".sources.json",
    ),
    [...configs, ...m.skills.map((s) => s.source)]
      .filter((file) => existsSync(file))
      .map((file) => ({
        path: file,
        hash: fingerprint(readFileSync(file, "utf8")),
      })),
  );
  w.capabilitySnapshotId = m.snapshotId;
  w.lastInspectedAt = m.checkedAt;
  w.agentVersion = agent.agentVersion;
  w.status = agent.status === "available" ? "ready" : "error";
  w.lastError = agent.lastError;
  w.updatedAt = Date.now();
  saveProcessingSettings(settings);
  return m;
}
