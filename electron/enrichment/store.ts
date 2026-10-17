import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import {
  WorkflowSchema,
  type EnhancementWorkflow,
} from "../../common/enhancement";
import { isValidSessionId, sessionDir } from "../recorder/session-store";

export function atomicJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = file + "." + randomUUID() + ".tmp";
  const fd = openSync(temp, "wx", 0o600);
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, file);
  if (process.platform !== "win32") {
    const parent = openSync(path.dirname(file), "r");
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
  }
}
export function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function emptyWorkflow(sessionId: string): EnhancementWorkflow {
  return {
    version: 1,
    sessionId,
    package: null,
    run: null,
    evidence: [],
    result: null,
    approvedAt: null,
    progress: [],
    decision: null,
  };
}
export class WorkflowStore {
  constructor(private directory: (id: string) => string = sessionDir) {}
  root(id: string): string {
    if (!isValidSessionId(id)) throw new Error("Unknown session");
    const directory = this.directory(id),
      root = path.join(directory, "enhancement");
    for (const candidate of [directory, root])
      if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink())
        throw new Error("Session storage cannot be a symbolic link");
    return root;
  }
  read(id: string): EnhancementWorkflow {
    const file = path.join(this.root(id), "checkpoint.json");
    if (!existsSync(file)) return emptyWorkflow(id);
    const cp = z
      .object({ snapshot: z.string().uuid() })
      .parse(JSON.parse(readFileSync(file, "utf8")));
    const w = WorkflowSchema.parse(
      JSON.parse(
        readFileSync(
          path.join(this.root(id), "revisions", cp.snapshot + ".json"),
          "utf8",
        ),
      ),
    );
    if (w.sessionId !== id) throw new Error("Checkpoint session mismatch");
    return w;
  }
  save(w: EnhancementWorkflow): void {
    const valid = WorkflowSchema.parse(w),
      root = this.root(w.sessionId),
      revision = randomUUID();
    if (
      w.run &&
      (w.run.sessionId !== w.sessionId ||
        (w.package && w.run.inputRevision !== w.package.inputRevision))
    )
      throw new Error("Run input/session mismatch");
    if (w.package && w.package.sessionId !== w.sessionId)
      throw new Error("Package session mismatch");
    // Immutable state first. The pointer is the commit boundary; never recover a mutable view.
    atomicJson(path.join(root, "revisions", revision + ".json"), valid);
    if (w.package) {
      const p = w.package,
        dir = path.join(root, "preparation", p.preparationId);
      atomicJson(path.join(dir, "draft.json"), p);
      if (p.status === "frozen") {
        const file = path.join(dir, "revisions", String(p.revision) + ".json");
        if (existsSync(file)) {
          if (
            fingerprint(JSON.parse(readFileSync(file, "utf8"))) !==
            fingerprint(p)
          )
            throw new Error("Frozen package revision is immutable");
        } else atomicJson(file, p);
      }
    }
    if (w.run) {
      const dir = path.join(root, w.run.runId);
      atomicJson(path.join(dir, "revisions", revision, "workflow.json"), valid);
      atomicJson(path.join(dir, "manifest.json"), w.run);
      if (w.package && !existsSync(path.join(dir, "task-package.json")))
        atomicJson(path.join(dir, "task-package.json"), w.package);
      atomicJson(path.join(dir, "claims.json"), w.result?.claims ?? []);
      atomicJson(path.join(dir, "gaps.json"), w.package?.gaps ?? []);
      atomicJson(path.join(dir, "questions.json"), {
        questions: w.package?.questions ?? [],
        answers: w.package?.answers ?? [],
      });
      // This is a committed view, not the recovery source. No raw MCP contents are persisted.
      writeFileSync(
        path.join(dir, "evidence.jsonl"),
        w.evidence.map((e) => JSON.stringify(e)).join("\n") + "\n",
        { mode: 0o600 },
      );
      if (w.result) atomicJson(path.join(dir, "result.json"), w.result);
      atomicJson(path.join(dir, "checkpoint.json"), {
        snapshot: revision,
        sequence: w.run.eventSequence,
        packageRevision: w.package?.revision,
      });
    }
    atomicJson(path.join(root, "checkpoint.json"), { snapshot: revision });
  }
  recover(id: string): EnhancementWorkflow {
    const w = this.read(id);
    if (w.run && ["queued", "running"].includes(w.run.status)) {
      w.run.status = "interrupted";
      w.run.error = "应用中断，已保存的材料可恢复。";
      w.run.updatedAt = Date.now();
      this.save(w);
    }
    if (w.package?.status === "identifying") {
      w.package.status = "draft";
      this.save(w);
    }
    return w;
  }
}

/** Shared exclusion between analysis, enhancement and generation, including startup. */
export class SessionLocks {
  private active = new Map<
    string,
    { purpose: string; controller: AbortController; done:Promise<void> }
  >();
  busy(id: string): boolean {
    return this.active.has(id);
  }
  anyBusy(purpose?: string): boolean {
    return [...this.active.values()].some(
      (entry) => !purpose || entry.purpose === purpose,
    );
  }
  purpose(id: string): string | null {
    return this.active.get(id)?.purpose ?? null;
  }
  async withLock<T>(
    id: string,
    purpose: string,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    if (this.active.has(id))
      throw new Error("该录制还有处理任务，请先完成或取消。");
    let release!:()=>void;
    const done=new Promise<void>(resolve=>{release=resolve;});
    const entry = { purpose, controller: new AbortController(),done };
    this.active.set(id, entry);
    try {
      entry.controller.signal.throwIfAborted();
      return await work(entry.controller.signal);
    } finally {
      if (this.active.get(id) === entry) this.active.delete(id);
      release();
    }
  }
  cancel(id: string): void {
    this.active
      .get(id)
      ?.controller.abort(new Error("任务已取消，已保存材料保留。"));
  }
  waitForIdle(id:string):Promise<void> {
    return this.active.get(id)?.done??Promise.resolve();
  }
  cancelAll(): void {
    for (const id of this.active.keys()) this.cancel(id);
  }
}
export const sessionLocks = new SessionLocks();
export const workflowStore = new WorkflowStore();
