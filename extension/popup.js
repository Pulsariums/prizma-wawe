const $ = (id) => document.getElementById(id);
$("studio").onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL("studio.html") }); window.close(); };
const run = $("run"), ab = $("ab"), st = $("st"), dot = $("dot"), stt = $("stt"), info = $("info"), cv = $("cv");
let on = false, bypass = false;
const modeSel = $("mode"), codecSel = $("codec");
const syncSel = () => { $("cw").hidden = $("gw").hidden = modeSel.value !== "new"; modeSel.disabled = codecSel.disabled = on; };
modeSel.onchange = () => { try { localStorage.mode = modeSel.value; } catch {} syncSel(); };
codecSel.onchange = () => { try { localStorage.codec = codecSel.value; } catch {} };
const gainSel = $("gain");
gainSel.oninput = () => { $("gv").textContent = "×" + Number(gainSel.value).toFixed(2).replace(".", ","); try { localStorage.gain = gainSel.value; } catch {} chrome.runtime.sendMessage({ target: "off", type: "gain", value: Number(gainSel.value) }).catch(() => {}); };
try { if (localStorage.gain) { gainSel.value = localStorage.gain; $("gv").textContent = "×" + Number(gainSel.value).toFixed(2).replace(".", ","); } } catch {}
try { if (localStorage.mode) modeSel.value = localStorage.mode; if (localStorage.codec) codecSel.value = localStorage.codec; } catch {}

function ui() {
  dot.classList.toggle("on", on);
  stt.textContent = !on ? "Kapalı (ses işlenmiyor)" : bypass ? "Açık: şu an ORİJİNAL ses çalıyor" : "Açık: işlenmiş ses çalıyor";
  run.textContent = on ? "Durdur" : "Bu sekmede başlat";
  run.classList.toggle("on", on);
  ab.disabled = !on; syncSel();
  ab.classList.toggle("on", bypass);
  ab.textContent = bypass ? "İşlenmiş sese geç" : "Orijinal sese geç";
  if (!on) { info.textContent = "Kapalıyken veri yok."; draw(null, null); }
}

const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function draw(a, b) {
  const g = cv.getContext("2d"), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  g.strokeStyle = css("--ln"); g.lineWidth = 1;
  for (const f of [0, 4, 8, 12, 16, 20, 24]) { const x = (f / 24) * (W - 1); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  g.fillStyle = css("--mut"); g.font = "18px system-ui";
  for (const f of [0, 4, 8, 12, 16, 20, 24]) { const x = (f / 24) * (W - 1); g.fillText(f === 0 ? "0" : f === 24 ? "24k" : String(f), Math.min(x + 3, W - 40), H - 5); }
  g.setLineDash([6, 5]); g.strokeStyle = css("--fg");
  g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke(); g.setLineDash([]);
  const line = (arr, col) => {
    if (!arr) return;
    g.strokeStyle = col; g.lineWidth = 3; g.beginPath();
    arr.forEach((v, i) => { const x = (i / (arr.length - 1)) * (W - 1), y = H - Math.max(0, Math.min(1, (v + 110) / 110)) * (H - 22) - 20; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
  };
  line(a, css("--in")); line(b, css("--ac"));
}

run.onclick = async () => {
  if (!on) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
      await chrome.runtime.sendMessage({ target: "bg", type: "start", streamId, tabId: tab.id, mode: modeSel.value, codec: Number(codecSel.value) }); chrome.runtime.sendMessage({ target: "off", type: "gain", value: Number(gainSel.value) });
      on = true; bypass = false; st.textContent = "Başlıyor...";
    } catch (e) { st.textContent = "Hata: " + e.message; }
  } else {
    await chrome.runtime.sendMessage({ target: "bg", type: "stop" });
    on = false; bypass = false; st.textContent = "";
  }
  ui();
};
ab.onclick = () => { bypass = !bypass; chrome.runtime.sendMessage({ target: "off", type: "bypass", value: bypass }); ui(); };

const khz = (h) => (h / 1000).toFixed(1).replace(".", ",") + " kHz";
chrome.runtime.onMessage.addListener((m) => {
  if (m.target !== "popup") return;
  if (m.type === "stats") {
    st.textContent = m.mode === "new" ? `İşlem yükü: %${(m.rtf * 100).toFixed(0)} (100'ün altı yetişir)\nGecikme: ~${Math.round(m.latency / 1000)} sn (ses ve görüntü kayar)` : `İşlem yükü: %${(m.rtf * 100).toFixed(0)} (100'ün altı gerçek zaman)\nEk gecikme: ~${m.latency} ms`;
  } else if (m.type === "spec") {
    draw(m.input, m.output);
    info.innerHTML = `Örnekleme: 48 kHz (değişmez, veri akışı aynı)<br>Giriş bandı: <b>~${khz(m.cutIn)}</b> sınırına kadar<br>Çıkış bandı: <b>~${khz(m.cutOut)}</b> sınırına kadar<br>${modeSel.value === "new" ? "Yeni model tüm bandı işler" : "12 kHz altı: değiştirilmez"}`;
  } else if (m.type === "error") { on = false; ui(); st.textContent = "Hata: " + m.message; }
});

// popup yeniden açılınca gerçek durumu offscreen'den al
chrome.runtime.sendMessage({ target: "off", type: "getState" }).then((r) => {
  if (r) { on = r.running; bypass = r.bypass; if (r.running && r.mode) { modeSel.value = r.mode; codecSel.value = String(r.codec || 0); } }
  ui();
}).catch(() => { on = false; ui(); });
ui();
