// STFT/iSTFT + güç yasası sıkıştırma (egitim koduyla birebir: n_fft 1024, hop 256, p 0.3, center/reflect)
export const NFFT = 1024, HOP = 256, NBIN = 513, FQ = 512, PW = 0.3;
const win = new Float32Array(NFFT);
for (let i = 0; i < NFFT; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NFFT); // periyodik hann
const rev = new Uint16Array(NFFT);
for (let i = 0, j = 0; i < NFFT; i++) { rev[i] = j; let b = NFFT >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; }
const cs = new Float64Array(NFFT / 2), sn = new Float64Array(NFFT / 2);
for (let i = 0; i < NFFT / 2; i++) { cs[i] = Math.cos((-2 * Math.PI * i) / NFFT); sn[i] = Math.sin((-2 * Math.PI * i) / NFFT); }
function fft(re, im) {
  for (let i = 0; i < NFFT; i++) { const j = rev[i]; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= NFFT; len <<= 1) {
    const half = len >> 1, step = NFFT / len;
    for (let i = 0; i < NFFT; i += len) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const a = i + k, b = a + half, wr = cs[w], wi = sn[w];
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}
export const numFrames = (T) => 1 + Math.floor(T / HOP);
// x: Float32Array(T) -> {re,im}: Float32Array(NBIN*N) düzeni [f*N+n]
export function stft(x) {
  const T = x.length, N = numFrames(T), H = NFFT / 2;
  const pad = new Float32Array(T + NFFT);
  pad.set(x, H);
  for (let i = 0; i < H; i++) { pad[H - 1 - i] = x[Math.min(T - 1, i + 1)]; pad[H + T + i] = x[Math.max(0, T - 2 - i)]; }
  const R = new Float32Array(NBIN * N), I = new Float32Array(NBIN * N);
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
  for (let n = 0; n < N; n++) {
    const o = n * HOP;
    for (let i = 0; i < NFFT; i++) { re[i] = pad[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let f = 0; f < NBIN; f++) { R[f * N + n] = re[f]; I[f * N + n] = im[f]; }
  }
  return { re: R, im: I, N };
}
// sıkıştır + modele giriş paketi: [4,512,N] (kanal: L re, L im, R re, R im)
export function packInput(specL, specR) {
  const N = specL.N, out = new Float32Array(4 * FQ * N);
  const put = (spec, c) => {
    for (let f = 0; f < FQ; f++) for (let n = 0; n < N; n++) {
      const k = f * N + n, a = spec.re[k], b = spec.im[k];
      const m = Math.max(Math.hypot(a, b), 1e-8), s = Math.pow(m, PW) / m;
      out[((c * 2) * FQ + f) * N + n] = a * s; out[((c * 2 + 1) * FQ + f) * N + n] = b * s;
    }
  };
  put(specL, 0); put(specR, 1);
  return out;
}
// giriş + kalıntı -> ters sıkıştır -> iSTFT. Bin 512 kalıntısız kalır (egitimdeki gibi)
export function restore(specL, specR, res, T, g = 1) {
  const N = specL.N, outs = [];
  [specL, specR].forEach((spec, c) => {
    const R = new Float32Array(NBIN * N), I = new Float32Array(NBIN * N);
    for (let f = 0; f < NBIN; f++) for (let n = 0; n < N; n++) {
      const k = f * N + n, a = spec.re[k], b = spec.im[k];
      const m0 = Math.max(Math.hypot(a, b), 1e-8), s0 = Math.pow(m0, PW) / m0;
      let yr = a * s0, yi = b * s0;
      if (f < FQ) { yr += g * res[((c * 2) * FQ + f) * N + n]; yi += g * res[((c * 2 + 1) * FQ + f) * N + n]; }
      const m = Math.max(Math.hypot(yr, yi), 1e-8), s = Math.pow(m, 1 / PW) / m;
      R[k] = yr * s; I[k] = yi * s;
    }
    outs.push(istft({ re: R, im: I, N }, T));
  });
  return outs;
}
export function istft(S, T) {
  const N = S.N, H = NFFT / 2, L = (N - 1) * HOP + NFFT;
  const ola = new Float64Array(L), ws = new Float64Array(L);
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
  for (let n = 0; n < N; n++) {
    for (let f = 0; f < NBIN; f++) { re[f] = S.re[f * N + n]; im[f] = -S.im[f * N + n]; } // eşlenik (ters FFT hilesi)
    for (let f = 1; f < NFFT / 2; f++) { re[NFFT - f] = re[f]; im[NFFT - f] = -im[f]; }
    fft(re, im);
    const o = n * HOP;
    for (let i = 0; i < NFFT; i++) { ola[o + i] += (re[i] / NFFT) * win[i]; ws[o + i] += win[i] * win[i]; }
  }
  const y = new Float32Array(T);
  for (let i = 0; i < T; i++) { const w = ws[i + H]; y[i] = w > 1e-11 ? ola[i + H] / w : 0; }
  return y;
}
// Ortalama spektrum (dB), nb çubuk. Ekranda orijinal/işlenmiş karşılaştırması için.
export function avgSpectrumDb(x, nb = 96) {
  const T = x.length, re = new Float64Array(NFFT), im = new Float64Array(NFFT), p = new Float64Array(NBIN);
  const frames = Math.max(1, Math.min(400, Math.floor((T - NFFT) / HOP)));
  const stepS = Math.max(HOP, Math.floor((T - NFFT) / frames));
  let cnt = 0;
  for (let o = 0; o + NFFT <= T && cnt < frames; o += stepS, cnt++) {
    for (let i = 0; i < NFFT; i++) { re[i] = x[o + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let f = 0; f < NBIN; f++) p[f] += re[f] * re[f] + im[f] * im[f];
  }
  const out = new Array(nb), per = FQ / nb;
  for (let b = 0; b < nb; b++) {
    let s = 0, c = 0; for (let f = Math.floor(b * per); f < Math.floor((b + 1) * per); f++) { s += p[f]; c++; }
    out[b] = Math.round(10 * Math.log10(s / Math.max(c, 1) / Math.max(cnt, 1) / NFFT + 1e-12) * 10) / 10;
  }
  return out;
}
