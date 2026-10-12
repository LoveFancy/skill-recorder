export interface AnalysisRun { canceled: boolean }

/** Synchronous guards prevent duplicate clicks and stale results after cancellation. */
export class AnalysisRecovery {
  private current: AnalysisRun | null = null;
  beginRun(): AnalysisRun | null {
    if (this.current) return null;
    return (this.current = { canceled: false });
  }
  isCurrent(run: AnalysisRun): boolean { return this.current === run; }
  accepts(run: AnalysisRun): boolean { return this.isCurrent(run) && !run.canceled; }
  finishRun(run: AnalysisRun): void { if (this.isCurrent(run)) this.current = null; }
  cancelRun(): void { if (this.current) this.current.canceled = true; }
  invalidate(): void { this.cancelRun(); this.current = null; }
}
