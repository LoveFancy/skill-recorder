import { readModelSettings, type ModelSettings } from "./settings";
import { processingStatus } from "../agents/service";
import { localRequest } from "../agents/local-request";
import { executionModel } from "../agents/claude-progress";
import type { AgentWorkspace } from "../../common/agents";

export interface Tool {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  handler: (args: unknown, context: { sessionId: string; toolCallId: string; toolName: string; arguments: unknown }) => unknown | Promise<unknown>;
}
export interface SessionConfig {
  systemMessage?: { mode: string; content: string };
  tools?: Tool[];
  availableTools?: string[];
  model?: string;
  terminalTools?: string[];
  onExecution?: (title:string,detail:string,model?:string)=>void;
  connectionCheck?: boolean;
}
interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null | unknown[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/** Runs only explicitly supplied in-process tools; no shell or filesystem tools are implicit. */
export class AgentSession {
  private messages: Message[] = [];
  private controller: AbortController | null = null;
  private closed = false;

  constructor(private config: SessionConfig = {}, private settings?: ModelSettings,
    private request: typeof fetch = fetch, private onDisconnect?: () => void) {
    if (config.systemMessage) this.messages.push({ role: "system", content: config.systemMessage.content });
  }

  async sendAndWait(input: string | { prompt: string }, timeoutMs = 180_000): Promise<void> {
    if (this.closed) throw new Error("Model session is closed.");
    if (this.controller) throw new Error("A model turn is already running.");
    const settings = this.settings ?? readModelSettings();
    const model = this.config.model ?? settings.model;
    if (!model) throw new Error("Configure an AI model in AI settings before analyzing or building.");
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(new Error("Model turn timed out.")), timeoutMs);
    const start = this.messages.length;
    this.messages.push({ role: "user", content: typeof input === "string" ? input : input.prompt });
    const tools = (this.config.tools ?? []).filter((tool) => !this.config.availableTools || this.config.availableTools.includes(tool.name));
    try {
      if(settings.baseUrl!=="http://local")this.config.onExecution?.('正在调用模型','使用已配置的 API 模型。',executionModel(model));
      for (let turn = 0; turn < 40; turn++) {
        controller.signal.throwIfAborted();
        const response = await this.request(`${settings.baseUrl}/chat/completions`, {
          method: "POST", signal: controller.signal, redirect: "error",
          headers: { "Content-Type": "application/json", ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}) },
          body: JSON.stringify({ model, messages: this.messages, stream: false,
            ...(tools.length ? { tools: tools.map((tool) => ({ type: "function", function: {
              name: tool.name, description: tool.description, parameters: tool.parameters ?? { type: "object", properties: {} },
            } })), tool_choice: "auto" } : {}),
          }),
        });
        // Do not echo response bodies, which can include credentials or recording contents.
        if (!response.ok) throw new Error(`Model API returned HTTP ${response.status}. Check the API URL, key and model in AI settings.`);
        const data = await response.json() as { model?:unknown; choices?: { message?: Message; finish_reason?: string }[] };
        if(settings.baseUrl!=="http://local" && executionModel(data.model))this.config.onExecution?.('模型已确认','已获取服务返回的模型。',executionModel(data.model));
        controller.signal.throwIfAborted();
        const choice = data.choices?.[0];
        const message = choice?.message;
        if (!message || message.role !== "assistant") throw new Error("Model API returned an invalid chat response.");
        if (choice?.finish_reason === "length") throw new Error("Model output was truncated. Increase the provider's output limit.");
        this.messages.push({ role: "assistant", content: message.content ?? null, ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}) });
        if (!message.tool_calls?.length) return;
        const images: unknown[] = [];
        let submitted = false;
        for (const call of message.tool_calls) {
          controller.signal.throwIfAborted();
          const tool = tools.find((candidate) => candidate.name === call.function.name);
          let result: unknown;
          try {
            if (!tool) throw new Error("Tool is not available.");
            const args: unknown = JSON.parse(call.function.arguments);
            result = await tool.handler(args, { sessionId: "local", toolCallId: call.id, toolName: tool.name, arguments: args });
          } catch (error) {
            result = { textResultForLlm: error instanceof Error ? error.message : "Tool failed.", resultType: "failure" };
          }
          controller.signal.throwIfAborted();
          const structured = result && typeof result === "object" ? result as {
            textResultForLlm?: string; resultType?: string;
            binaryResultsForLlm?: { type: string; mimeType: string; data: string; description?: string }[];
          } : null;
          const content = structured?.textResultForLlm ?? (typeof result === "string" ? result : JSON.stringify(result) ?? "Done.");
          this.messages.push({ role: "tool", tool_call_id: call.id, content });
          for (const image of structured?.binaryResultsForLlm ?? []) {
            if (image.type !== "image") continue;
            if (image.description) images.push({ type: "text", text: image.description });
            images.push({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } });
          }
          if (tool && (this.config.terminalTools?.includes(tool.name) || /^(submit_analysis|submit_skill|propose_plan|propose_automation_plan|submit_judgement)$/.test(tool.name)) && structured?.resultType !== "failure") submitted = true;
        }
        if (images.length) this.messages.push({ role: "user", content: [{ type: "text", text: "Images returned by the preceding tool calls:" }, ...images] });
        if (submitted) return;
      }
      throw new Error("Model exceeded the 40-step tool-call limit.");
    } catch (error) {
      // A canceled/failed turn must not leave unpaired tool calls in the next request.
      this.messages.splice(start);
      throw error;
    } finally {
      clearTimeout(timer);
      this.controller = null;
    }
  }

  async abort(): Promise<void> { this.controller?.abort(new Error("Model turn canceled.")); }
  async disconnect(): Promise<void> {
    this.closed = true; await this.abort(); this.messages = []; this.onDisconnect?.();
  }
}

export class AgentClient {
  private sessions = new Set<AgentSession>();
  private backend: "api"|"local-agent" = "api";
  private workspace: AgentWorkspace | null = null;
  async start(): Promise<void> {
    const status=await processingStatus();
    if(!status.ready || !status.backend)throw new Error(status.error??"智能处理配置不可用。");
    this.backend=status.backend;
    this.workspace=status.settings.workspaces.find(w=>w.id===status.settings.defaultProcessingWorkspaceId)??null;
  }
  async createSession(config: SessionConfig): Promise<AgentSession> {
    const session = new AgentSession(config, this.backend==="local-agent" ? {baseUrl:"http://local",model:"local-claude",apiKey:""} : readModelSettings(), this.backend==="local-agent" && this.workspace ? localRequest(this.workspace,config.onExecution,{includeSkillContext:!config.connectionCheck}) : fetch, () => this.sessions.delete(session));
    this.sessions.add(session);
    return session;
  }
  async stop(): Promise<void> {
    await Promise.all([...this.sessions].map((session) => session.disconnect()));
    this.sessions.clear();
  }
}
