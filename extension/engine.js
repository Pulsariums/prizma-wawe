import { stft, packInput, restore } from "./dsp.js";
const K0 = 288000, P0 = 48128;
export const KEEP = K0, PRE = P0, POST = 12800, XF = 1024; // 6 sn parça, 1 sn sol bağlam, çapraz geçiş
// ort: onnxruntime modülü, session: yüklü model. Parçalara bölüp işler, çıkışı [L,R] döndürür.
export async function processAll(ort, session, L, R, codec, onProgress, isCancelled, gain = 1, opts = {}) {
  const KEEP = opts.keep || K0, PRE = opts.pre || P0;
  const T = L.length;
  if (T < 8192) throw new Error("Dosya çok kısa.");
  const outL = new Float32Array(T), outR = new Float32Array(T);
  const nseg = Math.ceil(T / KEEP), t0 = Date.now();
  for (let s = 0; s < nseg; s++) {
    if (isCancelled && isCancelled()) return null;
    const k0 = s * KEEP, k1 = Math.min(T, k0 + KEEP);
    const a = Math.max(0, k0 - PRE), b = Math.min(T, k1 + POST);
    const sl = stft(L.subarray(a, b)), sr = stft(R.subarray(a, b));
    const out = await session.run({
      spec: new ort.Tensor("float32", packInput(sl, sr), [1, 4, 512, sl.N]),
      codec: new ort.Tensor("int64", BigInt64Array.from([BigInt(codec)]), [1]),
    });
    const [yl, yr] = restore(sl, sr, out.res.data, b - a, gain);
    const lo = Math.max(0, k0 - XF), hi = Math.min(T, k1 + XF);
    for (let i = lo; i < hi; i++) {
      let w = 1;
      if (s > 0 && i < k0 + XF) w = (i - (k0 - XF)) / (2 * XF);
      if (s < nseg - 1 && i > k1 - XF) w = Math.min(w, 1 - (i - (k1 - XF)) / (2 * XF));
      outL[i] += w * yl[i - a]; outR[i] += w * yr[i - a];
    }
    const el = (Date.now() - t0) / 1000, done = (s + 1) / nseg;
    if (onProgress) await onProgress({ done, elapsed: el, eta: el / done - el, speed: k1 / 48000 / el });
  }
  return [outL, outR];
}
