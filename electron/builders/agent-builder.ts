import { AgentClient, type AgentSession } from "../ai/client";

import { createLogger } from "../logger";

/**
 * Shared plumbing for the final-stage, multi-turn model builders (Skill Builder
 * and Automation Builder). Owns one lazily-started {@link AgentClient} and a small
 * pool of live conversations — one per recording — so each build's plan → refine →
 * create flow stays in a single session. Subclasses add the build-specific tools,
 * system prompt, and `build`/`create` turns; everything below is common.
 */

/** The minimum every live build carries so the pool can manage it. */
export interface BaseLive {
  sessionId: string;
  agent: AgentSession;
}

const MAX_LIVE_SESSIONS = 4;

export abstract class AgentBuilder<TLive extends BaseLive> {
  isBusy(): boolean { return this.active.size > 0; }

  private client: AgentClient | null = null;
  private clientStart: Promise<AgentClient> | null = null;
  protected model: string | undefined;
  protected readonly live = new Map<string, TLive>();
  protected readonly active = new Set<string>();
  protected readonly log;

  /** @param name Used for logs and the "not signed in" / startup-timeout messages. */
  constructor(name: string) {
    this.log = createLogger(name);
  }

  isBuilding(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  async cancel(sessionId: string): Promise<void> {
    const live = this.live.get(sessionId);
    if (live) await live.agent.abort().catch(() => undefined);
  }

  async forget(sessionId: string): Promise<void> {
    await this.disposeLive(sessionId);
  }

  async evictIdle(): Promise<void> {
    for (const [id, live] of this.live) {
      if (this.active.has(id)) continue;
      this.live.delete(id);
      await live.agent.disconnect().catch(() => undefined);
    }
  }

  async dispose(): Promise<void> {
    for (const [id] of this.live) await this.disposeLive(id);
    if (this.client) await this.client.stop().catch(() => undefined);
    this.client = null;
    this.clientStart = null;
  }

  /** Start (once) and return the shared model client. */
  protected async ensureClient(): Promise<AgentClient> {
    if (this.client) return this.client;
    if (this.clientStart) return this.clientStart;
    this.clientStart = (async () => {
      const client = new AgentClient();
      await client.start();
      this.model = process.env.SKILL_RECORDER_MODEL || undefined;
      this.log.info("Model client ready");
      this.client = client;
      return client;
    })();
    try {
      return await this.clientStart;
    } catch (err) {
      this.clientStart = null;
      throw err;
    }
  }

  /** Add a freshly created live session to the pool, evicting the oldest idle one
   *  when the pool is over budget. */
  protected registerLive(live: TLive): void {
    this.live.set(live.sessionId, live);
    for (const [id, l] of this.live) {
      if (this.live.size <= MAX_LIVE_SESSIONS) break;
      if (id === live.sessionId || this.active.has(id)) continue;
      this.live.delete(id);
      void l.agent.disconnect().catch(() => undefined);
    }
  }

  protected async disposeLive(sessionId: string): Promise<void> {
    const live = this.live.get(sessionId);
    if (!live) return;
    this.live.delete(sessionId);
    await live.agent.disconnect().catch(() => undefined);
  }
}
