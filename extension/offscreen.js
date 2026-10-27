import * as ort from "./ort/ort.wasm.min.mjs";
import { StreamProc, CH } from "./stream.js";
const LKEEP = 96000, LPRE = 24064;   // canlı mod: 2 sn parça
const MODEL_URL = "https://drive.google.com/uc?export=download&id=1yntxu19wKO2xclb_mWVAWxn7x6qnKRjO";
const MODEL_SIZE = 2896578;

const N = 2400;          // 50 ms @ 48 kHz
const C = 1024;          // bağlam (her iki yanda)
const SR = 48000;

ort.env.wasm.wasmPaths = chrome.runtime.getURL("ort/");
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

// ---- spektrum analizi (giriş vs çıkış) ----
const FN = 4096, NB = 96;
const hann = new Float32Array(FN).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FN));
const inBuf = new Float32Array(FN), outBuf = new Float32Array(FN);
let inP = null, outP = null, chunkCount = 0;
function pushBuf(buf, x) { buf.copyWithin(0, x.length); buf.set(x.subarray(Math.max(0, x.length - FN)), FN - Math.min(x.length, FN)); }
function fftPower(buf) {
  const re = new Float32Array(FN), im = new Float32Array(FN);
  for (let i = 0; i < FN; i++) re[i] = buf[i] * hann[i];
  for (let i = 1, j = 0; i < FN; i++) { let b = FN >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; } }
  for (let len = 2; len <= FN; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < FN; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  const p = new Float32Array(FN / 2);
  for (let i = 0; i < FN / 2; i++) p[i] = (re[i] * re[i] + im[i] * im[i]) / FN;
  return p;
}
function ema(prev, cur) { if (!prev) return cur; for (let i = 0; i < cur.length; i++) prev[i] = prev[i] * 0.8 + cur[i] * 0.2; return prev; }
function toDb(p) { const d = new Float32Array(p.length); for (let i = 0; i < p.length; i++) d[i] = 10 * Math.log10(p[i] + 1e-12); return d; }
function cutoffHz(db) {
  let peak = -200; for (let i = 0; i < db.length; i++) if (db[i] > peak) peak = db[i];
  const k = 8; // 8 binlik hareketli ortalama
  for (let i = db.length - 1; i >= k; i--) {
    let s = 0; for (let j = 0; j < k; j++) s += db[i - j];
    if (s / k > peak - 60) return Math.round((i * SR) / FN);
  }
  return 0;
}
function bars(db) {
  const per = Math.floor(db.length / NB), out = [];
  for (let b = 0; b < NB; b++) { let m = -200; for (let i = b * per; i < (b + 1) * per; i++) if (db[i] > m) m = db[i]; out.push(Math.round(m)); }
  return out;
}
function analyze(rawL, outL) {
  pushBuf(inBuf, rawL); pushBuf(outBuf, outL);
  if (++chunkCount % 5) return;
  inP = ema(inP, fftPower(inBuf)); outP = ema(outP, fftPower(outBuf));
  const di = toDb(inP), dout = toDb(outP);
  chrome.runtime.sendMessage({ target: "popup", type: "spec", input: bars(di), output: bars(dout), cutIn: cutoffHz(di), cutOut: cutoffHz(dout) }).catch(() => {});
}

let gainV = 1, mode = "old", codecId = 0, session2 = null, sp = null, busy2 = false, holdTimer = 0, firstEmit = false, rtf2 = 0;
async function loadModel2() {
  if (session2) return;
  let ab = null;
  const cache = await caches.open("bwe-model-v1");
  const hit = await cache.match(MODEL_URL);
  if (hit) { ab = await hit.arrayBuffer(); if (ab.byteLength !== MODEL_SIZE) ab = null; }
  if (!ab) {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error("Model indirilemedi (HTTP " + res.status + "). Önce Dosya modunu bir kez aç.");
    ab = await res.arrayBuffer();
    if (ab.byteLength !== MODEL_SIZE) throw new Error("Model boyutu hatalı");
    await cache.put(MODEL_URL, new Response(ab.slice(0)));
  }
  session2 = await ort.InferenceSession.create(new Uint8Array(ab), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
}
async function pump2() {
  if (busy2) return; busy2 = true;
  try {
    while (running && mode === "new" && sp && sp.ready()) {
      const slow = sp.backlog() > 6 * LKEEP;      // 12 sn'den fazla birikirse ham sesi geçir
      const o = await sp.step(ort, slow ? null : session2, codecId, gainV);
      if (!running) break;
      for (let off = 0; off + CH <= o.L.length; off += CH) { try { analyze(o.rawL.subarray(off, off + CH), o.L.subarray(off, off + CH)); } catch {} }
      if (!slow) rtf2 = rtf2 ? rtf2 * 0.7 + (o.ms / 2000) * 0.3 : o.ms / 2000;
      playNode.port.postMessage([o.L, o.R, o.rawL, o.rawR], [o.L.buffer, o.R.buffer, o.rawL.buffer, o.rawR.buffer]);
      if (!firstEmit) { firstEmit = true; holdTimer = setTimeout(() => playNode?.port.postMessage({ hold: false }), 1500); }
      chrome.runtime.sendMessage({ target: "popup", type: "stats", rtf: rtf2, bypass, latency: Math.round(2000 + 270 + o.ms + 1500), mode: "new" }).catch(() => {});
    }
  } catch (e) { chrome.runtime.sendMessage({ target: "popup", type: "error", message: String(e) }).catch(() => {}); }
  busy2 = false;
}
let session = null, ctx = null, stream = null, capNode = null, playNode = null;
let bypass = false, running = false;
let hist = [new Float32Array(C), new Float32Array(C)];
let pending = null;
const queue = [];
let busy = false, rtfAvg = 0, lastStat = 0;

async function loadModel() {
  if (session) return;
  session = await ort.InferenceSession.create(chrome.runtime.getURL("model/c_dyn.onnx"), {
    executionProviders: ["wasm"], graphOptimizationLevel: "all"
  });
}

async function infer(win) {
  const out = await session.run({ x: new ort.Tensor("float32", win, [1, 1, win.length]) });
  return out.y.data;
}

async function processChunk(next) {
  // pending: işlenecek parça, next: ileriye bakış için sonraki parça
  const outCh = [];
  const t0 = performance.now();
  const overloaded = queue.length > 8;
  for (let c = 0; c < 2; c++) {
    if (bypass || overloaded) { outCh.push(pending[c]); continue; }
    const win = new Float32Array(N + 2 * C);
    win.set(hist[c], 0);
    win.set(pending[c], C);
    win.set(next[c].subarray(0, C), C + N);
    const y = await infer(win);
    outCh.push(Float32Array.from(y.subarray(C, C + N)));
  }
  const ms = performance.now() - t0;
  if (!bypass && !overloaded) rtfAvg = rtfAvg ? rtfAvg * 0.9 + (ms / 50) * 0.1 : ms / 50;
  try { analyze(pending[0], outCh[0]); } catch (e) { console.warn('analiz hatası', e); }   // aktarımdan (transfer) önce: sonra buffer'lar boşalır
  for (let c = 0; c < 2; c++) hist[c] = pending[c].slice(N - C);
  playNode.port.postMessage(outCh, outCh.map((a) => a.buffer));
  pending = next;
  const now = performance.now();
  if (now - lastStat > 1000) {
    lastStat = now;
    chrome.runtime.sendMessage({ target: "popup", type: "stats", rtf: rtfAvg, bypass, latency: Math.round(100 + rtfAvg * 50 + 100) }).catch(() => {});
  }
}

async function pump() {
  if (busy) return;
  busy = true;
  try {
    while (queue.length) {
      const next = queue.shift();
      if (!pending) { pending = next; continue; }
      await processChunk(next);
    }
  } catch (e) {
    chrome.runtime.sendMessage({ target: "popup", type: "error", message: String(e) }).catch(() => {});
  }
  busy = false;
}

async function start(streamId, m = "old", codec = 0) {
  if (running) return;
  mode = m; codecId = codec;
  if (mode === "new") await loadModel2(); else await loadModel();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } }
  });
  ctx = new AudioContext({ sampleRate: SR, latencyHint: "interactive" });
  await ctx.audioWorklet.addModule(chrome.runtime.getURL("capture.js"));
  await ctx.audioWorklet.addModule(chrome.runtime.getURL("play.js"));
  const src = ctx.createMediaStreamSource(stream);
  capNode = new AudioWorkletNode(ctx, "cap", { channelCount: 2, channelCountMode: "explicit", numberOfOutputs: 0 });
  playNode = new AudioWorkletNode(ctx, "play", { numberOfInputs: 0, outputChannelCount: [2] });
  playNode.connect(ctx.destination);
  capNode.port.onmessage = (e) => { if (mode === "new") { sp.push(e.data[0], e.data[1]); pump2(); } else { queue.push(e.data); pump(); } };
  src.connect(capNode);
  hist = [new Float32Array(C), new Float32Array(C)];
  pending = null; queue.length = 0; rtfAvg = 0;
  sp = new StreamProc({ keep: LKEEP, pre: LPRE }); firstEmit = false; rtf2 = 0; clearTimeout(holdTimer);
  if (mode === "new") playNode.port.postMessage({ hold: true });
  bypass = false;
  running = true;
}

async function stop() {
  running = false; clearTimeout(holdTimer); sp = null; inP = outP = null; queue.length = 0; pending = null;
  try { stream?.getTracks().forEach((t) => t.stop()); } catch {}
  try { await ctx?.close(); } catch {}
  stream = ctx = capNode = playNode = null;
}

chrome.runtime.onMessage.addListener((m, _s, send) => {
  if (m.target !== "off") return;
  if (m.type === "getState") { send({ running, bypass, rtf: rtfAvg, mode, codec: codecId }); return; }
  if (m.type === "start") start(m.streamId, m.mode, m.codec).catch((e) => { stop(); chrome.runtime.sendMessage({ target: "popup", type: "error", message: String(e) }).catch(() => {}); });
  else if (m.type === "stop") stop();
  else if (m.type === "gain") gainV = m.value;
  else if (m.type === "bypass") { bypass = m.value; playNode?.port.postMessage({ byp: bypass }); }
});
