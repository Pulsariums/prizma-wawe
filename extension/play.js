class Play extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 48000 * 40;
    this.buf = [0, 1, 2, 3].map(() => new Float32Array(this.cap));
    this.r = 0; this.w = 0; this.fill = 0; this.started = false;
    this.hold = false; this.byp = false; this.g = 1; // g: 1 = işlenmiş, 0 = orijinal
    this.port.onmessage = (e) => {
      const d = e.data;
      if (!Array.isArray(d)) { if ("hold" in d) this.hold = d.hold; if ("byp" in d) this.byp = d.byp; return; }
      const [L, R, rL, rR] = d;
      for (let k = 0; k < L.length; k++) {
        if (this.fill >= this.cap) break;
        this.buf[0][this.w] = L[k]; this.buf[1][this.w] = R[k];
        this.buf[2][this.w] = rL ? rL[k] : L[k]; this.buf[3][this.w] = rR ? rR[k] : R[k];
        this.w = (this.w + 1) % this.cap; this.fill++;
      }
    };
  }
  process(_i, outputs) {
    const o = outputs[0], n = o[0].length;
    if (!this.started && !this.hold && this.fill >= 4800) this.started = true;
    if (this.started && this.fill < n) this.started = false;
    const tg = this.byp ? 0 : 1;
    for (let k = 0; k < n; k++) {
      if (this.started) {
        this.g += (tg - this.g) * 0.01;
        const g = this.g, h = 1 - g;
        o[0][k] = g * this.buf[0][this.r] + h * this.buf[2][this.r];
        if (o[1]) o[1][k] = g * this.buf[1][this.r] + h * this.buf[3][this.r];
        this.r = (this.r + 1) % this.cap; this.fill--;
      } else { o[0][k] = 0; if (o[1]) o[1][k] = 0; }
    }
    return true;
  }
}
registerProcessor("play", Play);
