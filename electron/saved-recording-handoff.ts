import type { RecorderStatus } from "../common/ipc";

/** One handoff per explicit save, excluding discard failures and repeated processing updates. */
export class SavedRecordingHandoff {
  private saving = false;
  private opened = new Set<string>();

  consume(status: Pick<RecorderStatus, "state" | "transition" | "lastFinish">, shuttingDown: boolean): string | null {
    if (status.transition !== "none") {
      this.saving = status.transition === "stopping";
      return null;
    }
    if (status.state !== "idle") return null;
    const saved = this.saving;
    this.saving = false;
    const finish = status.lastFinish;
    if (!saved || shuttingDown || finish?.outcome !== "saved" || this.opened.has(finish.sessionId)) return null;
    this.opened.add(finish.sessionId);
    return finish.sessionId;
  }
}
