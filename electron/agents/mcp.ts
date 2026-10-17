import { managedMcpConfiguration } from "./managed";
import { builtinToolAccess } from "../../common/builtin-tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync, copyFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { capabilitySnapshot } from "./service";
import {
  processingDirectory,
  readProcessingSettings,
  saveProcessingSettings,
} from "./settings";
import { atomicJson, fingerprint } from "../enrichment/store";
import { redactIncremental, redactValue } from "../enrichment/privacy";

/** Active discovery is explicit. Tools remain unknown-access; server annotations cannot grant permission. */
export async function refreshCapabilities(id: string) {
  const settings = readProcessingSettings(),
    w = settings.workspaces.find((w) => w.id === id),
    m = capabilitySnapshot(id);
  if (!w?.trustedAt || !m) throw new Error("请先关联项目并检查配置。");
  if (m.stale) throw new Error("能力快照已过期，请同步复核。");
  for (const server of m.servers) {
    if (server.lastError?.code === "source-conflict") continue;
    try {
      const config = w.managed ? null : JSON.parse(readFileSync(server.source, "utf8"));
      const c = w.managed ? await managedMcpConfiguration(w, server.name) :
        server.source === path.join(homedir(), ".claude.json")
          ? (config.projects?.[w.projectDirectory]?.mcpServers?.[server.name] ??
            config.mcpServers?.[server.name])
          : config.mcpServers?.[server.name];
      if (!c?.command || c.type === "http" || c.type === "sse") {
        server.status = "unverified";
        server.lastError = {
          code: "unsupported-transport",
          message:
            "此连接需要认证或远程协议适配；本版不自动连接，使用人工增强。",
        };
        continue;
      }
      if (
        !Array.isArray(c.args ?? []) ||
        !(c.args ?? []).every((a: unknown) => typeof a === "string")
      )
        throw new Error("配置无效");
      const tools = z
        .array(
          z.object({
            name: z.string().min(1),
            description: z.string().optional(),
            inputSchema: z.record(z.string(), z.unknown()).optional(),
          }),
        )
        .parse(
          await listStdio(
            c.command,
            c.args ?? [],
            w.projectDirectory,
            c.env ?? {},
          ),
        );
      const discovered = [];
      for (const t of tools)
        discovered.push({
          ref: server.id + ":" + t.name,
          providerId: server.id,
          name: t.name,
          description: await redactIncremental(t.description ?? ""),
          inputSchema: await redactValue(t.inputSchema ?? {}),
          schemaHash: fingerprint(t.inputSchema ?? {}),
          accountRefs: [],
          access: server.source === "builtin:" + server.name ? builtinToolAccess(server.name,t.name) : "unknown" as const,
          accessVerifiedBy: server.source === "builtin:" + server.name ? "application-builtin-v1" : null,
        });
      m.tools = [
        ...m.tools.filter((t) => t.providerId !== server.id),
        ...discovered,
      ];
      server.status = "connected";
      server.lastError = null;
    } catch {
      server.status = "connection-failed";
      server.lastError = {
        code: "discovery",
        message: "MCP 连接或工具枚举失败，请在线下检查配置/认证。",
      };
    }
  }
  const oldSnapshotId = m.snapshotId;
  m.snapshotId = randomUUID();
  const sources = path.join(
    processingDirectory(),
    "snapshots",
    oldSnapshotId + ".sources.json",
  );
  if (existsSync(sources))
    copyFileSync(
      sources,
      path.join(
        processingDirectory(),
        "snapshots",
        m.snapshotId + ".sources.json",
      ),
    );
  m.checkedAt = Date.now();
  m.stale = m.servers.some((server) => server.status === "connection-failed");
  m.discoveryMethod = "explicit-stdio-tools-list";
  atomicJson(
    path.join(processingDirectory(), "snapshots", m.snapshotId + ".json"),
    m,
  );
  w.capabilitySnapshotId = m.snapshotId;
  w.lastInspectedAt = m.checkedAt;
  saveProcessingSettings(settings);
  return m;
}
function listStdio(
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<
  {
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }[]
> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "",
      bytes = 0,
      done = false,
      pageCount = 0;
    const allTools: {
      name: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
    }[] = [];
    const finish = (
      error?: Error,
      tools?: {
        name: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
      }[],
    ) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      const killer = setTimeout(() => child.kill("SIGKILL"), 1500);
      killer.unref();
      error ? reject(error) : resolve(tools ?? []);
    };
    const timer = setTimeout(() => finish(new Error("MCP 超时")), 15000);
    const send = (v: unknown) => child.stdin.write(JSON.stringify(v) + "\n");
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {});
    child.on("error", () => finish(new Error("启动失败")));
    child.on("close", () => {
      if (!done) finish(new Error("MCP 提前退出"));
    });
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) return finish(new Error("响应过大"));
      buffer += chunk.toString();
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          const response = JSON.parse(line);
          if (response.error) return finish(new Error("协议错误"));
          if (response.id === 1) {
            send({ jsonrpc: "2.0", method: "notifications/initialized" });
            send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
          }
          if (response.id === 2) {
            if (!Array.isArray(response.result?.tools))
              return finish(new Error("工具清单不完整"));
            allTools.push(...response.result.tools);
            if (response.result.nextCursor) {
              if (++pageCount > 20)
                return finish(new Error("工具清单分页超过限制"));
              send({
                jsonrpc: "2.0",
                id: 2,
                method: "tools/list",
                params: { cursor: response.result.nextCursor },
              });
            } else finish(undefined, allTools);
          }
        } catch {
          finish(new Error("非法响应"));
        }
      }
    });
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "skill-recorder", version: "0.7.0" },
      },
    });
  });
}
