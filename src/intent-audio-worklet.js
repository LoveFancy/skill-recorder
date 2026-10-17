class IntentAudioCapture extends AudioWorkletProcessor {
  buffer = new Float32Array(4096);
  offset = 0;
  constructor() {
    super();
    this.port.onmessage = () => {
      if (this.offset) this.port.postMessage(this.buffer.slice(0, this.offset));
      this.offset = 0;
      this.port.postMessage("flushed");
    };
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) for (const sample of channel) {
      this.buffer[this.offset++] = sample;
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer.slice());
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("intent-audio-capture", IntentAudioCapture);
