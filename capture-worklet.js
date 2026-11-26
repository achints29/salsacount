// Collects mic samples on the audio thread and posts them to the page in ~43 ms blocks,
// tagged with the audio-clock time of the first sample.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(2048);
    this.n = 0;
    this.t0 = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      if (this.n === 0) this.t0 = currentTime;
      this.buf.set(ch, this.n);
      this.n += ch.length;
      if (this.n + 128 > this.buf.length) {
        this.port.postMessage({ samples: this.buf.slice(0, this.n), time: this.t0 });
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('capture', Capture);
