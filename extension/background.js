// Offscreen belgesini yönetir; popup'tan gelen mesajları ona iletir.
async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument();
  if (!has) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
      justification: "Sekme sesini yakalayıp işlenmiş haliyle geri çalmak için."
    });
  }
}
chrome.runtime.onMessage.addListener((msg, _s, send) => {
  if (msg.target !== "bg") return;
  (async () => {
    if (msg.type === "start") {
      await ensureOffscreen();
      chrome.runtime.sendMessage({ target: "off", type: "start", streamId: msg.streamId, mode: msg.mode, codec: msg.codec });
    } else if (msg.type === "stop") {
      chrome.runtime.sendMessage({ target: "off", type: "stop" });
      if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
    }
    send({ ok: true });
  })();
  return true;
});
