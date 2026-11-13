'use strict';
// Analisa teknikal murni (tanpa dependensi). Semua fungsi menerima candle
// berurutan dari yang terlama: { t (detik UTC), o, h, l, c, v }.

function ema(values, period) {
  const out = new Array(values.length).fill(null);
  if (values.length < period) return out;
  const k = 2 / (period + 1);
  let prev = 0;
  for (let i = 0; i < period; i++) prev += values[i];
  prev /= period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

function macd(closes, fast = 12, slow = 26, signal = 9) {
  const ef = ema(closes, fast), es = ema(closes, slow);
  const line = closes.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
  const start = line.findIndex((v) => v != null);
  const sig = new Array(closes.length).fill(null);
  if (start >= 0) {
    const s = ema(line.slice(start), signal);
    for (let i = 0; i < s.length; i++) sig[start + i] = s[i];
  }
  const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
  return { line, signal: sig, hist };
}

// ATR dan ADX dengan perataan Wilder.
function atrAdx(c, period = 14) {
  const n = c.length;
  const atr = new Array(n).fill(null), adx = new Array(n).fill(null);
  if (n < period * 2 + 1) return { atr, adx };
  const tr = [0], pdm = [0], ndm = [0];
  for (let i = 1; i < n; i++) {
    const up = c[i].h - c[i - 1].h, dn = c[i - 1].l - c[i].l;
    tr.push(Math.max(c[i].h - c[i].l, Math.abs(c[i].h - c[i - 1].c), Math.abs(c[i].l - c[i - 1].c)));
    pdm.push(up > dn && up > 0 ? up : 0);
    ndm.push(dn > up && dn > 0 ? dn : 0);
  }
  let sTr = 0, sP = 0, sN = 0;
  for (let i = 1; i <= period; i++) { sTr += tr[i]; sP += pdm[i]; sN += ndm[i]; }
  atr[period] = sTr / period;
  const dx = new Array(n).fill(null);
  const calcDx = () => {
    const pdi = sTr ? (100 * sP) / sTr : 0, ndi = sTr ? (100 * sN) / sTr : 0;
    return pdi + ndi ? (100 * Math.abs(pdi - ndi)) / (pdi + ndi) : 0;
  };
  dx[period] = calcDx();
  for (let i = period + 1; i < n; i++) {
    sTr = sTr - sTr / period + tr[i];
    sP = sP - sP / period + pdm[i];
    sN = sN - sN / period + ndm[i];
    atr[i] = sTr / period;
    dx[i] = calcDx();
  }
  let a = 0;
  for (let i = period; i < period * 2; i++) a += dx[i];
  a /= period;
  adx[period * 2 - 1] = a;
  for (let i = period * 2; i < n; i++) {
    a = (a * (period - 1) + dx[i]) / period;
    adx[i] = a;
  }
  return { atr, adx };
}

// Titik balik (swing high / swing low) dengan jendela kiri-kanan.
function pivots(c, left = 4, right = 4) {
  const highs = [], lows = [];
  for (let i = left; i < c.length - right; i++) {
    let isH = true, isL = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (c[j].h >= c[i].h) isH = false;
      if (c[j].l <= c[i].l) isL = false;
      if (!isH && !isL) break;
    }
    if (isH) highs.push({ i, t: c[i].t, p: c[i].h });
    if (isL) lows.push({ i, t: c[i].t, p: c[i].l });
  }
  return { highs, lows };
}

// Kelompokkan titik balik yang berdekatan menjadi level support/resistance.
function levels(piv, atr, fromIndex) {
  const pts = [...piv.highs, ...piv.lows].filter((p) => p.i >= fromIndex).map((p) => p.p).sort((a, b) => a - b);
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && p - last.p <= atr * 0.6) {
      last.p = (last.p * last.n + p) / (last.n + 1);
      last.n++;
    } else out.push({ p, n: 1 });
  }
  return out;
}

function aggregate(c, bucketOf) {
  const out = [];
  let cur = null, key = null;
  for (const k of c) {
    const b = bucketOf(k.t);
    if (b !== key) {
      if (cur) out.push(cur);
      key = b;
      cur = { t: k.t, o: k.o, h: k.h, l: k.l, c: k.c, v: k.v || 0 };
    } else {
      cur.h = Math.max(cur.h, k.h);
      cur.l = Math.min(cur.l, k.l);
      cur.c = k.c;
      cur.v += k.v || 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const HTF = {
  '15m': { label: '1 jam', bucket: (t) => Math.floor(t / 3600) },
  '1h': { label: '4 jam', bucket: (t) => Math.floor(t / 14400) },
  '4h': { label: 'harian', bucket: (t) => Math.floor(t / 86400) },
  '1d': { label: 'mingguan', bucket: (t) => Math.floor((t / 86400 + 3) / 7) },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const last = (arr) => arr[arr.length - 1];

function analyze(candles, tf) {
  const n = candles.length;
  if (n < 120) throw new Error('Data harga belum cukup untuk dianalisa (butuh minimal 120 candle).');
  const closes = candles.map((k) => k.c);
  const price = closes[n - 1];
  const e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200);
  const r = rsi(closes, 14);
  const m = macd(closes);
  const { atr, adx } = atrAdx(candles, 14);
  const A = last(atr), rsiNow = last(r), adxNow = last(adx);
  const piv = pivots(candles, 4, 4);
  const factors = [];

  // 1. Tren: posisi harga terhadap EMA 20/50/200.
  {
    const long = last(e200) ?? last(e50);
    const longName = last(e200) != null ? 'EMA 200' : 'EMA 50';
    let v = 0;
    v += price > long ? 0.4 : -0.4;
    v += last(e50) > long ? 0.3 : last(e50) < long ? -0.3 : 0;
    v += price > last(e20) ? 0.3 : -0.3;
    const txt = v >= 0.7 ? `Harga di atas EMA 20, EMA 50, dan ${longName}: tren naik rapi.`
      : v <= -0.7 ? `Harga di bawah EMA 20, EMA 50, dan ${longName}: tren turun rapi.`
      : price > long ? `Harga masih di atas ${longName}, tetapi susunan EMA belum searah.`
      : `Harga di bawah ${longName}, tetapi susunan EMA belum searah.`;
    factors.push({ key: 'trend', name: 'Tren (EMA)', weight: 25, value: v, text: txt });
  }

  // 2. Tren timeframe lebih besar.
  let htfValue = 0;
  {
    const h = aggregate(candles, HTF[tf].bucket);
    const hc = h.map((k) => k.c);
    const h20 = ema(hc, 20), h50 = ema(hc, 50);
    let txt = `Data timeframe ${HTF[tf].label} belum cukup.`;
    if (last(h20) != null) {
      const slow = last(h50) ?? last(h20);
      const prev20 = h20[h20.length - 4] ?? last(h20);
      htfValue += last(hc) > slow ? 0.4 : -0.4;
      htfValue += last(h20) > slow ? 0.3 : last(h20) < slow ? -0.3 : 0;
      htfValue += last(h20) > prev20 ? 0.3 : -0.3;
      txt = htfValue >= 0.4 ? `Timeframe ${HTF[tf].label} juga sedang naik.`
        : htfValue <= -0.4 ? `Timeframe ${HTF[tf].label} juga sedang turun.`
        : `Timeframe ${HTF[tf].label} belum punya arah jelas.`;
    }
    factors.push({ key: 'htf', name: `Tren ${HTF[tf].label}`, weight: 25, value: htfValue, text: txt });
  }

  // 3. Momentum MACD.
  {
    const h = last(m.hist), hPrev = m.hist[n - 4] ?? h;
    let v = (h > 0 ? 0.6 : -0.6) + (h > hPrev ? 0.4 : -0.4);
    const txt = h > 0
      ? (h > hPrev ? 'MACD positif dan menguat.' : 'MACD positif tetapi mulai melemah.')
      : (h < hPrev ? 'MACD negatif dan makin lemah.' : 'MACD negatif tetapi mulai pulih.');
    factors.push({ key: 'macd', name: 'Momentum (MACD)', weight: 15, value: v, text: txt });
  }

  // 4. RSI.
  {
    let v = clamp((rsiNow - 50) / 20, -1, 1), txt;
    if (rsiNow >= 70) { v = 0.2; txt = `RSI ${rsiNow.toFixed(0)}: jenuh beli, rawan koreksi.`; }
    else if (rsiNow <= 30) { v = -0.2; txt = `RSI ${rsiNow.toFixed(0)}: jenuh jual, rawan pantulan.`; }
    else txt = `RSI ${rsiNow.toFixed(0)}: ${rsiNow > 55 ? 'pembeli lebih kuat.' : rsiNow < 45 ? 'penjual lebih kuat.' : 'seimbang.'}`;
    factors.push({ key: 'rsi', name: 'RSI 14', weight: 15, value: v, text: txt });
  }

  // 5. Struktur harga: higher high / higher low.
  {
    let v = 0, txt = 'Struktur puncak dan lembah belum terbentuk jelas.';
    const H = piv.highs.slice(-2), L = piv.lows.slice(-2);
    if (H.length === 2 && L.length === 2) {
      const hh = H[1].p > H[0].p, hl = L[1].p > L[0].p;
      v = (hh ? 0.5 : -0.5) + (hl ? 0.5 : -0.5);
      txt = hh && hl ? 'Puncak dan lembah makin tinggi (higher high, higher low).'
        : !hh && !hl ? 'Puncak dan lembah makin rendah (lower high, lower low).'
        : 'Puncak dan lembah tidak searah: harga sedang konsolidasi.';
    }
    factors.push({ key: 'structure', name: 'Struktur harga', weight: 20, value: v, text: txt });
  }

  let score = factors.reduce((s, f) => s + f.weight * f.value, 0);
  const sideways = adxNow != null && adxNow < 18;
  if (sideways) score *= 0.7;
  score = Math.round(clamp(score, -100, 100));

  const bias = score >= 50 ? 'BULLISH KUAT' : score >= 20 ? 'BULLISH'
    : score <= -50 ? 'BEARISH KUAT' : score <= -20 ? 'BEARISH' : 'SIDEWAYS';

  // Support dan resistance terdekat.
  const lv = levels(piv, A, Math.max(0, n - 250));
  const supports = lv.filter((x) => x.p < price - A * 0.3).map((x) => x.p);
  const resistances = lv.filter((x) => x.p > price + A * 0.3).map((x) => x.p);
  const support = supports.length ? last(supports) : null;
  const resistance = resistances.length ? resistances[0] : null;

  // Sinyal dan level.
  let action = 'TUNGGU';
  if (score >= 30 && htfValue >= 0) action = 'BUY';
  else if (score <= -30 && htfValue <= 0) action = 'SELL';

  let plan = null;
  if (action !== 'TUNGGU') {
    const dir = action === 'BUY' ? 1 : -1;
    let risk = 1.5 * A, slBasis = '1,5 × ATR';
    const swing = action === 'BUY' ? last(piv.lows.filter((p) => p.p < price)) : last(piv.highs.filter((p) => p.p > price));
    if (swing) {
      const d = Math.abs(price - swing.p) + 0.25 * A;
      if (d >= A && d <= 3 * A) { risk = d; slBasis = action === 'BUY' ? 'di bawah lembah terakhir' : 'di atas puncak terakhir'; }
    }
    const barrier = action === 'BUY' ? resistance : support;
    plan = {
      entry: price,
      sl: price - dir * risk,
      tp1: price + dir * risk,
      tp2: price + dir * risk * 2,
      tp3: price + dir * risk * 3,
      risk, slBasis,
      barrier,
      barrierBeforeTp1: barrier != null && Math.abs(barrier - price) < risk,
    };
  }

  let whyWait = null;
  if (action === 'TUNGGU') {
    whyWait = Math.abs(score) < 30
      ? 'Arah pasar belum cukup kuat. Lebih aman menunggu harga menembus salah satu level di bawah.'
      : `Timeframe ${HTF[tf].label} berlawanan dengan arah timeframe ini. Tunggu keduanya searah.`;
  }

  const cautions = [];
  if (action === 'SELL' && rsiNow <= 30) cautions.push('RSI sudah jenuh jual. Harga rawan memantul naik dulu; lebih aman menunggu pantulan sebelum SELL.');
  if (action === 'BUY' && rsiNow >= 70) cautions.push('RSI sudah jenuh beli. Harga rawan koreksi dulu; lebih aman menunggu koreksi sebelum BUY.');
  if (sideways) cautions.push(`ADX ${adxNow.toFixed(0)}: tren lemah, pasar cenderung bergerak menyamping.`);
  if (plan && plan.barrierBeforeTp1) cautions.push(`Ada ${action === 'BUY' ? 'resistance' : 'support'} sebelum TP1. Pertimbangkan ambil untung lebih dekat.`);

  return {
    price, score, bias, action, plan, whyWait, cautions,
    confidence: Math.min(95, Math.abs(score)),
    sideways, htfLabel: HTF[tf].label,
    indicators: { rsi: rsiNow, adx: adxNow, atr: A, ema20: last(e20), ema50: last(e50), ema200: last(e200), macdHist: last(m.hist) },
    support, resistance,
    factors,
    series: { ema20: e20, ema50: e50, ema200: e200 },
  };
}

module.exports = { analyze, ema, rsi, macd, atrAdx, pivots, aggregate };
