import * as ort from "./ort/ort.wasm.min.mjs";
import { avgSpectrumDb } from "./dsp.js";
import { processAll } from "./engine.js";

ort.env.wasm.wasmPaths = new URL("./ort/", import.meta.url).href;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

let session = null, cancelled = false;

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      session = await ort.InferenceSession.create(new Uint8Array(m.bytes), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      postMessage({ type: "ready", threads: ort.env.wasm.numThreads });
    } else if (m.type === "run") { cancelled = false; await run(m); }
    else if (m.type === "cancel") { cancelled = true; }
    else if (m.type === "wav") { postMessage({ type: "wav", buf: wav16(m.L, m.R) }, []); }
  } catch (err) { postMessage({ type: "error", message: String((err && err.message) || err) }); }
};

async function run({ L, R, codec, gain }) {
  const t0 = performance.now();
  const res = await processAll(ort, session, L, R, codec,
    async (p) => { postMessage({ type: "progress", ...p }); await new Promise((r) => setTimeout(r, 0)); },
    () => cancelled, gain || 1);
  if (!res) { postMessage({ type: "cancelled" }); return; }
  const [outL, outR] = res;
  const mid = (x, y) => { const m = new Float32Array(x.length); for (let i = 0; i < m.length; i++) m[i] = 0.5 * (x[i] + y[i]); return m; };
  const specIn = avgSpectrumDb(mid(L, R)), specOut = avgSpectrumDb(mid(outL, outR));
  postMessage({ type: "done", L: outL, R: outR, specIn, specOut, seconds: (performance.now() - t0) / 1000 }, [outL.buffer, outR.buffer]);
}

function wav16(L, R) {
  const n = L.length, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 4, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 2, true); v.setUint32(24, 48000, true); v.setUint32(28, 48000 * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, n * 4, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    v.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true); o += 2;
    v.setInt16(o, Math.max(-1, Math.min(1, R[i])) * 32767, true); o += 2;
  }
  return buf;
}
