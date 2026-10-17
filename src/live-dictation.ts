/** Serial recognition of cumulative PCM. Hypotheses replace the same utterance. */
export class LiveDictation {
  private chunks: Float32Array[] = [];
  private length = 0;
  private pending: Promise<void> | null = null;
  private closed = false;
  text = "";
  constructor(
    private transcribe: (samples: Float32Array) => Promise<{ok:boolean;text?:string;error?:string}>,
    private onText: (text:string) => void,
  ) {}
  add(samples: Float32Array): void {
    if (this.closed) return;
    const chunk = samples.slice(0, Math.max(0, 16000 * 60 - this.length));
    if (chunk.length) { this.chunks.push(chunk); this.length += chunk.length; }
  }
  async preview(): Promise<void> {
    if (this.closed || this.pending || this.length < 1600) return;
    this.pending = this.recognize();
    try { await this.pending; } finally { this.pending = null; }
  }
  async finish(): Promise<void> {
    this.closed = true;
    await this.pending?.catch(() => undefined);
    if (this.length >= 1600) await this.recognize();
    if (!this.text) throw new Error("没有识别到语音，请靠近麦克风重试。");
  }
  private async recognize(): Promise<void> {
    const samples = new Float32Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) { samples.set(chunk, offset); offset += chunk.length; }
    const result = await this.transcribe(samples);
    if (!result.ok) {
      if (result.error?.includes("没有识别到语音")) return;
      throw new Error(result.error ?? "语音转写失败，请重试。");
    }
    if (result.text?.trim()) { this.text = result.text.trim(); this.onText(this.text); }
  }
}
