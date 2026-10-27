const IS_EXT = location.protocol === "chrome-extension:";
const MODEL_URL = IS_EXT ? "https://drive.google.com/uc?export=download&id=1yntxu19wKO2xclb_mWVAWxn7x6qnKRjO" : new URL("./model/bwe_core.onnx", location.href).href;
const MODEL_SIZE = 2896578;
const SR = 48000;
const $ = (id) => document.getElementById(id);
const worker = new Worker("worker.js", { type: "module" });

let modelReady = false, srcL = null, srcR = null, name = "muzik";
let outL = null, outR = null, bufO = null, bufP = null;
let cutL = null, cutR = null, anO = null, anP = null, avgA = null, avgB = null, raf = 0, ctx = null, srcO = null, srcP = null, gO = null, gP = null, mode = "p", playing = false, t0 = 0, offset = 0, busy = false;

const fmt = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
const setErr = (t) => { $("err").textContent = t || ""; };
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function refresh() { $("go").disabled = !(modelReady && srcL) || busy; }

// ---------- model ----------
async function loadModel() {
  try {
    let ab = null;
    const cache = await caches.open("bwe-model-v1");
    const hit = await cache.match(MODEL_URL);
    if (hit) { ab = await hit.arrayBuffer(); if (ab.byteLength !== MODEL_SIZE) ab = null; }
    if (!ab) {
      $("mstat").textContent = "Model indiriliyor (2,8 MB, bir kereye mahsus)…";
      const res = await fetch(MODEL_URL);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rd = res.body.getReader(), parts = []; let got = 0;
      for (;;) {
        const { done, value } = await rd.read(); if (done) break;
        parts.push(value); got += value.length;
        $("mbar").style.width = Math.min(100, (got / MODEL_SIZE) * 100) + "%";
      }
      ab = new Uint8Array(got); let o = 0; for (const p of parts) { ab.set(p, o); o += p.length; }
      ab = ab.buffer;
      if (ab.byteLength !== MODEL_SIZE) throw new Error("Model boyutu beklenenden farklı (" + ab.byteLength + ")");
      await cache.put(MODEL_URL, new Response(ab.slice(0)));
    }
    startWorker(ab);
  } catch (e) {
    $("mstat").textContent = "Model otomatik indirilemedi (" + e.message + "). Model dosyasını (bwe_core.onnx) elle seç.";
    $("mfile").classList.remove("hide");
  }
}
function startWorker(ab) { $("mstat").textContent = "Model yükleniyor…"; worker.postMessage({ type: "init", bytes: ab }, [ab]); }
$("mfile").onclick = () => $("mpick").click();
$("mpick").onchange = async (e) => { const f = e.target.files[0]; if (f) startWorker(await f.arrayBuffer()); };

// ---------- dosya ----------
async function loadFile(f) {
  stopPlay(); $("res").classList.add("hide"); outL = outR = bufO = bufP = null; setErr(""); srcL = srcR = null; refresh();
  $("fname").textContent = f.name + " · okunuyor…";
  try {
    const ac = new AudioContext({ sampleRate: SR });
    const dec = await ac.decodeAudioData(await f.arrayBuffer());
    ac.close();
    srcL = dec.getChannelData(0).slice(); srcR = (dec.numberOfChannels > 1 ? dec.getChannelData(1) : dec.getChannelData(0)).slice();
    name = f.name.replace(/\.[^.]+$/, "");
    $("st0").value = 0; $("len0").value = Math.floor(srcL.length / SR);
    $("fname").textContent = f.name + " · " + fmt(srcL.length / SR) + (dec.numberOfChannels === 1 ? " · mono" : "");
  } catch (e) { setErr("Dosya çözülemedi: " + e.message); $("fname").textContent = "Dosya seçilmedi"; }
  refresh();
}
$("pick").onclick = () => $("fpick").click();
$("fpick").onchange = (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); };
const drop = $("drop");
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => { if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

// ---------- işleme ----------
$("go").onclick = () => {
  setErr(""); busy = true; refresh(); stopPlay(); $("res").classList.add("hide");
  $("stop").classList.remove("hide"); $("pbar").style.width = "0%"; $("pstat").textContent = "Başlıyor…";
  const d = srcL.length / SR, st = Math.min(Math.max(0, Number($("st0").value) || 0), Math.max(0, d - 5));
  const ln = Math.min(Math.max(5, Number($("len0").value) || d), d - st);
  cutL = srcL.slice(Math.floor(st * SR), Math.floor((st + ln) * SR)); cutR = srcR.slice(Math.floor(st * SR), Math.floor((st + ln) * SR));
  $("st0").value = Math.floor(st); $("len0").value = Math.floor(ln);
  worker.postMessage({ type: "run", L: cutL.slice(), R: cutR.slice(), codec: Number($("codec").value), gain: Number($("gain").value) });
};
$("r30").onclick = () => { if (!srcL) return; const d = srcL.length / SR; const st = Math.min(Number($("st0").value) || 0, Math.max(0, d - 30)); $("st0").value = Math.floor(st); $("len0").value = Math.floor(Math.min(30, d - st)); };
$("rall").onclick = () => { if (!srcL) return; $("st0").value = 0; $("len0").value = Math.floor(srcL.length / SR); };
$("gain").oninput = () => { $("gv").textContent = "×" + Number($("gain").value).toFixed(2).replace(".", ","); };
$("stop").onclick = () => worker.postMessage({ type: "cancel" });

worker.onmessage = (e) => {
  const m = e.data;
  if (m.type === "ready") { modelReady = true; $("mstat").textContent = "Model hazır."; $("mbar").style.width = "100%"; refresh(); }
  else if (m.type === "progress") {
    $("pbar").style.width = (m.done * 100).toFixed(1) + "%";
    $("pstat").textContent = `%${Math.round(m.done * 100)} · kalan ${fmt(m.eta)} · ${m.speed.toFixed(1).replace(".", ",")}× gerçek zaman`.replace("×", "×");
  } else if (m.type === "done") {
    busy = false; $("stop").classList.add("hide");
    $("pbar").style.width = "100%"; $("pstat").textContent = `Bitti · ${fmt(m.seconds)} sürdü`;
    outL = m.L; outR = m.R; showResult(m.specIn, m.specOut);
    refresh();
  } else if (m.type === "cancelled") { busy = false; $("stop").classList.add("hide"); $("pstat").textContent = "İptal edildi."; $("pbar").style.width = "0%"; refresh(); }
  else if (m.type === "wav") {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([m.buf], { type: "audio/wav" }));
    a.download = name + "-iyilestirilmis.wav"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    $("dl").disabled = false; $("dl").textContent = "WAV indir";
  } else if (m.type === "error") { busy = false; $("stop").classList.add("hide"); setErr("Hata: " + m.message); refresh(); $("dl").disabled = false; $("dl").textContent = "WAV indir"; }
};

// ---------- oynatma (A/B kesintisiz: iki kaynak aynı anda, biri sessiz) ----------
function makeBuf(c, L, R) { const b = c.createBuffer(2, L.length, SR); b.copyToChannel(L, 0); b.copyToChannel(R, 1); return b; }
function showResult(specIn, specOut) {
  if (!ctx) ctx = new AudioContext({ sampleRate: SR });
  bufO = makeBuf(ctx, cutL, cutR); bufP = makeBuf(ctx, outL, outR);
  offset = 0; setMode("p"); $("seek").value = 0; $("tcur").textContent = "0:00"; $("ttot").textContent = fmt(bufO.duration);
  $("res").classList.remove("hide"); $("play").textContent = "Çal";
  avgA = specIn; avgB = specOut; drawSpec(specIn, specOut);
  showNums(specIn, specOut);
}
function showNums(a, b) {
  const avg = (x, i0, i1) => { let s = 0; for (let i = i0; i < i1; i++) s += x[i]; return s / (i1 - i0); };
  const bands = [["0–12 kHz", 0, 48], ["12–16 kHz", 48, 64], ["16–20 kHz", 64, 80], ["20–24 kHz", 80, 96]];
  let num = 0, den = 0; for (let i = 0; i < cutL.length; i += 4) { const d = outL[i] - cutL[i]; num += d * d; den += cutL[i] * cutL[i]; }
  const rms = Math.sqrt(num / Math.max(den, 1e-12)) * 100;
  const f = (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1).replace(".", ",");
  const el = $("nums"); el.textContent = "";
  const t = document.createElement("table"); t.className = "nt";
  const hd = t.insertRow(); for (const c of ["Bant", "Orijinal (dB)", "İyileştirilmiş (dB)", "Değişim (dB)"]) { const th = document.createElement("th"); th.textContent = c; hd.appendChild(th); }
  for (const [n, i0, i1] of bands) {
    const x = avg(a, i0, i1), y = avg(b, i0, i1), r = t.insertRow();
    for (const c of [n, x.toFixed(1).replace(".", ","), y.toFixed(1).replace(".", ","), f(y - x)]) r.insertCell().textContent = c;
  }
  el.appendChild(t);
  const p = document.createElement("p"); p.className = "txt";
  p.textContent = "Dalga biçimi değişimi: %" + rms.toFixed(1).replace(".", ",") + " (orijinale göre). 16 kHz üstü çoğu insan kulağı için zor duyulur; asıl fark orada.";
  el.appendChild(p);
}
function pos() { return playing ? Math.min(bufO.duration, ctx.currentTime - t0) : offset; }
function startAt(off) {
  killSrc();
  srcO = ctx.createBufferSource(); srcP = ctx.createBufferSource(); srcO.buffer = bufO; srcP.buffer = bufP;
  gO = ctx.createGain(); gP = ctx.createGain();
  gO.gain.value = mode === "o" ? 1 : 0; gP.gain.value = mode === "p" ? 1 : 0;
  anO = ctx.createAnalyser(); anP = ctx.createAnalyser(); anO.fftSize = anP.fftSize = 2048; anO.smoothingTimeConstant = anP.smoothingTimeConstant = 0.8;
  enh = enhChain(ctx, srcP);
  srcO.connect(anO); enh.out.connect(anP); srcO.connect(gO).connect(ctx.destination); enh.out.connect(gP).connect(ctx.destination);
  srcO.onended = () => { if (playing && pos() >= bufO.duration - 0.05) { stopPlay(); offset = 0; $("seek").value = 0; $("tcur").textContent = "0:00"; } };
  ctx.resume(); srcO.start(0, off); srcP.start(0, off); t0 = ctx.currentTime - off; playing = true; $("play").textContent = "Duraklat"; if (!raf) raf = requestAnimationFrame(loop);
}
// ---------- Enhancer: stereo genişlik + sıcaklık + hava (WebAudio zinciri) ----------
const enP = () => $("en").checked ? { w: Number($("en_w").value), warm: Number($("en_m").value), air: Number($("en_a").value), on: true } : { w: 1, warm: 0, air: 0, on: false };
function enhChain(c, input) {
  const p = enP(), sp = c.createChannelSplitter(2), mg = c.createChannelMerger(2), G = (v) => { const g = c.createGain(); g.gain.value = v; return g; };
  const lm = G(0.5), rm = G(0.5), ls = G(0.5), rs = G(-0.5), mid = G(1), side = G(1), sw = G(p.w), ns = G(-1), L = G(1), R = G(1), out = G(p.on ? 0.89 : 1);
  input.connect(sp); sp.connect(lm, 0); sp.connect(rm, 1); sp.connect(ls, 0); sp.connect(rs, 1);
  lm.connect(mid); rm.connect(mid); ls.connect(side); rs.connect(side); side.connect(sw); sw.connect(ns);
  mid.connect(L); sw.connect(L); mid.connect(R); ns.connect(R); L.connect(mg, 0, 0); R.connect(mg, 0, 1);
  const lo = c.createBiquadFilter(); lo.type = "lowshelf"; lo.frequency.value = 200; lo.gain.value = p.warm;
  const hi = c.createBiquadFilter(); hi.type = "highshelf"; hi.frequency.value = 10000; hi.gain.value = p.air;
  mg.connect(lo); lo.connect(hi); hi.connect(out);
  return { out, sw, lo, hi, gain: out };
}
let enh = null;
function enhUpdate() {
  const p = enP(); $("en_wv").textContent = "×" + p.w.toFixed(2).replace(".", ","); $("en_mv").textContent = (Number($("en_m").value) >= 0 ? "+" : "−") + Math.abs(Number($("en_m").value)).toFixed(1).replace(".", ",") + " dB"; $("en_av").textContent = "+" + Number($("en_a").value).toFixed(1).replace(".", ",") + " dB";
  if (!enh || !ctx) return; const t = ctx.currentTime;
  enh.sw.gain.setTargetAtTime(p.w, t, 0.02); enh.lo.gain.setTargetAtTime(p.warm, t, 0.02); enh.hi.gain.setTargetAtTime(p.air, t, 0.02); enh.gain.gain.setTargetAtTime(p.on ? 0.89 : 1, t, 0.02);
}
["en", "en_w", "en_m", "en_a"].forEach((id) => $(id).addEventListener("input", enhUpdate));
function bandsOf(an) {
  const f = new Float32Array(an.frequencyBinCount); an.getFloatFrequencyData(f);
  const nb = 96, per = f.length / nb, out = new Array(nb);
  for (let b = 0; b < nb; b++) { let m = -200; for (let i = Math.floor(b * per); i < Math.floor((b + 1) * per); i++) if (f[i] > m) m = f[i]; out[b] = m; }
  return out;
}
function loop() { raf = 0; if (!playing || !anO) return; drawSpec(bandsOf(anO), bandsOf(anP), true); raf = requestAnimationFrame(loop); }
function killSrc() { for (const s of [srcO, srcP]) { if (s) { s.onended = null; try { s.stop(); } catch (_) {} s.disconnect(); } } srcO = srcP = null; }
function stopPlay() { if (playing) offset = pos(); playing = false; killSrc(); anO = anP = null; if (avgA) drawSpec(avgA, avgB); if ($("play")) $("play").textContent = "Çal"; }
function setMode(m) {
  mode = m; $("bo").classList.toggle("on", m === "o"); $("bp").classList.toggle("on", m === "p");
  if (playing) { const t = ctx.currentTime; gO.gain.setTargetAtTime(m === "o" ? 1 : 0, t, 0.008); gP.gain.setTargetAtTime(m === "p" ? 1 : 0, t, 0.008); }
}
$("play").onclick = () => { if (!bufO) return; if (playing) stopPlay(); else startAt(offset >= bufO.duration - 0.1 ? 0 : offset); };
$("bo").onclick = () => setMode("o"); $("bp").onclick = () => setMode("p");
$("seek").oninput = (e) => { if (!bufO) return; offset = (e.target.value / 1000) * bufO.duration; $("tcur").textContent = fmt(offset); if (playing) startAt(offset); };
setInterval(() => { if (!playing || !bufO) return; const p = pos(); $("seek").value = (p / bufO.duration) * 1000; $("tcur").textContent = fmt(p); }, 250);
$("dl").onclick = () => { $("dl").disabled = true; $("dl").textContent = "Hazırlanıyor…"; (async () => {
  let L = outL, R = outR;
  if ($("en").checked) {
    const oc = new OfflineAudioContext(2, outL.length, SR), s = oc.createBufferSource(); s.buffer = makeBuf(oc, outL, outR);
    enhChain(oc, s).out.connect(oc.destination); s.start(); const r = await oc.startRendering(); L = r.getChannelData(0); R = r.getChannelData(1);
  }
  worker.postMessage({ type: "wav", L: L.slice(), R: R.slice() });
})(); };

// ---------- ortalama spektrum grafiği ----------
function drawSpec(a, b, live) {
  const cv = $("cv"), g = cv.getContext("2d"), W = cv.width, H = cv.height, padB = 36, padT = 10;
  g.clearRect(0, 0, W, H);
  const top = live ? -10 : Math.max(...a, ...b) + 5, bot = top - 90, X = (i, n) => (i / (n - 1)) * (W - 1), Y = (v) => padT + (1 - Math.max(0, Math.min(1, (v - bot) / (top - bot)))) * (H - padT - padB);
  g.strokeStyle = css("--ln"); g.fillStyle = css("--mut"); g.font = "22px system-ui"; g.lineWidth = 1;
  for (const f of [0, 4, 8, 12, 16, 20, 24]) { const x = (f / 24) * (W - 1); g.beginPath(); g.moveTo(x, padT); g.lineTo(x, H - padB); g.stroke(); g.fillText(f === 24 ? "24k" : String(f), Math.min(x + 4, W - 46), H - 10); }
  g.setLineDash([8, 6]); g.strokeStyle = css("--fg"); g.beginPath(); g.moveTo(W / 2, padT); g.lineTo(W / 2, H - padB); g.stroke(); g.setLineDash([]);
  const line = (arr, col) => { g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); arr.forEach((v, i) => { const x = X(i, arr.length), y = Y(v); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); };
  line(a, css("--in")); line(b, css("--ac"));
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {});

loadModel();
