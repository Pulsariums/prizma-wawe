import { stft, packInput, restore } from "./dsp.js";
import { KEEP as K0, PRE as P0, POST, XF } from "./engine.js";
export const CH = 2400;
// Akış halinde parçalar işler; engine.processAll ile aynı çapraz geçişi kullanır.
export class StreamProc {
  constructor(o = {}) { this.KEEP = o.keep || K0; this.PRE = o.pre || P0; this.chunks = new Map(); this.n = 0; this.seg = 0; this.tail = null; }
  push(L, R) { this.chunks.set(this.n++, [L, R]); }
  ready() { return this.n * CH >= (this.seg + 1) * this.KEEP + POST; }
  backlog() { return this.n * CH - ((this.seg + 1) * this.KEEP + POST); }
  gather(a, b) {
    const L = new Float32Array(b - a), R = new Float32Array(b - a);
    for (let i = Math.floor(a / CH); i * CH < b; i++) {
      const c = this.chunks.get(i); if (!c) continue;
      const s0 = Math.max(a, i * CH), s1 = Math.min(b, (i + 1) * CH);
      L.set(c[0].subarray(s0 - i * CH, s1 - i * CH), s0 - a); R.set(c[1].subarray(s0 - i * CH, s1 - i * CH), s0 - a);
    }
    return [L, R];
  }
  // ort/session/codec verilirse işler, null ise ham sesi geçirir. {L,R,rawL,rawR,ms} döndürür.
  async step(ort, session, codec, gain = 1) {
    const KEEP = this.KEEP, PRE = this.PRE, s = this.seg, k0 = s * KEEP, k1 = k0 + KEEP, a = Math.max(0, k0 - PRE), b = k1 + POST;
    const [rl, rr] = this.gather(a, b);
    let yl = rl, yr = rr;
    const t0 = Date.now();
    if (session) {
      const sl = stft(rl), sr = stft(rr);
      const out = await session.run({
        spec: new ort.Tensor("float32", packInput(sl, sr), [1, 4, 512, sl.N]),
        codec: new ort.Tensor("int64", BigInt64Array.from([BigInt(codec)]), [1]),
      });
      [yl, yr] = restore(sl, sr, out.res.data, b - a, gain);
    }
    const ms = Date.now() - t0;
    const lo = Math.max(0, k0 - XF), hi = k1 + XF, n = hi - lo;
    const aL = new Float32Array(n), aR = new Float32Array(n);
    for (let i = lo; i < hi; i++) {
      let w = 1;
      if (s > 0 && i < k0 + XF) w = (i - (k0 - XF)) / (2 * XF);
      if (i > k1 - XF) w = Math.min(w, 1 - (i - (k1 - XF)) / (2 * XF));
      aL[i - lo] = w * yl[i - a]; aR[i - lo] = w * yr[i - a];
    }
    if (this.tail) for (let j = 0; j < 2 * XF; j++) { aL[j] += this.tail[0][j]; aR[j] += this.tail[1][j]; }
    this.tail = [aL.slice(n - 2 * XF), aR.slice(n - 2 * XF)];
    const m = n - 2 * XF;
    const [rawL, rawR] = this.gather(lo, lo + m);
    for (const k of [...this.chunks.keys()]) if (k < Math.floor((k1 - PRE) / CH)) this.chunks.delete(k);
    this.seg++;
    return { L: aL.slice(0, m), R: aR.slice(0, m), rawL, rawR, ms };
  }
}
