class Cap extends AudioWorkletProcessor {
  constructor() { super(); this.n = 2400; this.reset(); }
  reset() { this.b = [new Float32Array(this.n), new Float32Array(this.n)]; this.i = 0; }
  process(inputs) {
    const x = inputs[0];
    if (!x || !x.length) return true;
    const L = x[0], R = x[1] || x[0];
    for (let k = 0; k < L.length; k++) {
      this.b[0][this.i] = L[k]; this.b[1][this.i] = R[k]; this.i++;
      if (this.i === this.n) {
        this.port.postMessage([this.b[0], this.b[1]], [this.b[0].buffer, this.b[1].buffer]);
        this.reset();
      }
    }
    return true;
  }
}
registerProcessor("cap", Cap);
