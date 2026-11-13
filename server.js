'use strict';
// Server lokal tanpa dependensi. Jalankan: node server.js  (butuh Node.js 18+)
const http = require('http');
const fs = require('fs');
const path = require('path');
const { analyze } = require('./lib/analysis');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const TFS = ['15m', '1h', '4h', '1d'];
// Saat dipasang online (bukan 127.0.0.1), pengaturan dikunci: API key hanya dari variabel TWELVEDATA_KEY.
const LOCKED = HOST !== '127.0.0.1' && HOST !== 'localhost';

// ---------- Konfigurasi ----------
let config = { tdKey: '', custom: [] };
try { config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) }; } catch {}
if (process.env.TWELVEDATA_KEY) config.tdKey = process.env.TWELVEDATA_KEY;
const saveConfig = () => fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));

// sources dicoba berurutan; `proxy` berarti instrumen pengganti yang harganya mengikuti aslinya.
const DEFAULTS = [
  { id: 'xauusd', name: 'XAU/USD', desc: 'Emas', type: 'metal', cur: ['USD'],
    sources: [{ p: 'td', s: 'XAU/USD' }, { p: 'binance', s: 'PAXGUSDT', proxy: 'PAXG/USDT (token emas, harganya mengikuti XAU/USD)' }] },
  { id: 'btcusd', name: 'BTC/USD', desc: 'Bitcoin', type: 'crypto', cur: ['USD'],
    sources: [{ p: 'binance', s: 'BTCUSDT' }, { p: 'td', s: 'BTC/USD' }] },
  { id: 'ethusd', name: 'ETH/USD', desc: 'Ethereum', type: 'crypto', cur: ['USD'],
    sources: [{ p: 'binance', s: 'ETHUSDT' }, { p: 'td', s: 'ETH/USD' }] },
  { id: 'solusd', name: 'SOL/USD', desc: 'Solana', type: 'crypto', cur: ['USD'],
    sources: [{ p: 'binance', s: 'SOLUSDT' }, { p: 'td', s: 'SOL/USD' }] },
  { id: 'eurusd', name: 'EUR/USD', desc: 'Euro / Dolar AS', type: 'forex', cur: ['EUR', 'USD'], sources: [{ p: 'td', s: 'EUR/USD' }] },
  { id: 'gbpusd', name: 'GBP/USD', desc: 'Pound / Dolar AS', type: 'forex', cur: ['GBP', 'USD'], sources: [{ p: 'td', s: 'GBP/USD' }] },
  { id: 'usdjpy', name: 'USD/JPY', desc: 'Dolar AS / Yen', type: 'forex', cur: ['USD', 'JPY'], sources: [{ p: 'td', s: 'USD/JPY' }] },
  { id: 'aapl', name: 'AAPL', desc: 'Apple', type: 'stock', cur: ['USD'], sources: [{ p: 'td', s: 'AAPL' }] },
  { id: 'nvda', name: 'NVDA', desc: 'Nvidia', type: 'stock', cur: ['USD'], sources: [{ p: 'td', s: 'NVDA' }] },
  { id: 'tsla', name: 'TSLA', desc: 'Tesla', type: 'stock', cur: ['USD'], sources: [{ p: 'td', s: 'TSLA' }] },
];
const instruments = () => [...DEFAULTS, ...config.custom];

function decimals(inst, price) {
  if (inst.type === 'stock') return 2;
  if (inst.type === 'forex') return price > 20 ? 3 : 5;
  return price >= 100 ? 2 : price >= 1 ? 4 : 6;
}

// ---------- Pengambilan data ----------
async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`Jawaban tidak terbaca dari ${new URL(url).host} (HTTP ${res.status}).`); }
  return { status: res.status, body };
}

async function binanceCandles(symbol, tf) {
  const { status, body } = await getJson(`https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${tf}&limit=1000`);
  if (status !== 200 || !Array.isArray(body)) throw new Error(body && body.msg ? `Binance: ${body.msg}` : `Binance menjawab HTTP ${status}.`);
  return body.map((k) => ({ t: k[0] / 1000, o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }));
}

// Twelve Data paket gratis: 8 permintaan per menit. Antre agar tidak melewati batas.
const tdCalls = [];
let tdChain = Promise.resolve();
function tdSlot() {
  const run = async () => {
    for (;;) {
      const now = Date.now();
      while (tdCalls.length && now - tdCalls[0] > 61000) tdCalls.shift();
      if (tdCalls.length < 7) { tdCalls.push(now); return; }
      await new Promise((r) => setTimeout(r, 61000 - (now - tdCalls[0])));
    }
  };
  tdChain = tdChain.then(run, run);
  return tdChain;
}
const TD_TF = { '15m': '15min', '1h': '1h', '4h': '4h', '1d': '1day' };
async function tdCandles(symbol, tf) {
  if (!config.tdKey) throw new Error('Butuh API key Twelve Data (gratis). Isi lewat tombol Pengaturan.');
  await tdSlot();
  const { body } = await getJson(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=${TD_TF[tf]}&outputsize=800&timezone=UTC&apikey=${encodeURIComponent(config.tdKey)}`);
  if (body.status !== 'ok' || !Array.isArray(body.values)) throw new Error(`Twelve Data: ${body.message || 'data tidak tersedia.'}`);
  return body.values.map((v) => ({
    t: Date.parse((v.datetime.length > 10 ? v.datetime.replace(' ', 'T') : v.datetime + 'T00:00:00') + 'Z') / 1000,
    o: +v.open, h: +v.high, l: +v.low, c: +v.close, v: +(v.volume || 0),
  })).reverse();
}

const TTL = { binance: { '15m': 30, '1h': 45, '4h': 120, '1d': 300 }, td: { '15m': 180, '1h': 300, '4h': 900, '1d': 1800 } };
const cache = new Map();
function cached(key, ttlSec, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < ttlSec * 1000) return hit.promise;
  const promise = fn();
  cache.set(key, { ts: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

async function loadCandles(inst, tf) {
  let firstError = null;
  for (const src of inst.sources) {
    if (src.p === 'td' && !config.tdKey && inst.sources.length > 1) continue;
    try {
      const candles = await cached(`${src.p}:${src.s}:${tf}`, TTL[src.p][tf], () => (src.p === 'binance' ? binanceCandles(src.s, tf) : tdCandles(src.s, tf)));
      return { candles, source: src };
    } catch (e) { firstError = firstError || e; }
  }
  throw firstError || new Error('Tidak ada sumber data untuk instrumen ini.');
}

// ---------- Berita Forex Factory ----------
const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const FF_CACHE = path.join(__dirname, '.ff-cache.json');
let ff = { ts: 0, events: [], error: null };
try { ff = { ...ff, ...JSON.parse(fs.readFileSync(FF_CACHE, 'utf8')) }; } catch {}
let ffPending = null;
async function loadNews() {
  if (Date.now() - ff.ts < 30 * 60 * 1000 && ff.events.length) return ff;
  if (ffPending) return ffPending;
  ffPending = (async () => {
    try {
      const { status, body } = await getJson(FF_URL);
      if (status !== 200 || !Array.isArray(body)) throw new Error(`Forex Factory menjawab HTTP ${status}.`);
      ff = {
        ts: Date.now(), error: null,
        events: body.map((e) => ({ title: e.title, cur: e.country, t: Date.parse(e.date), impact: e.impact, forecast: e.forecast || '', previous: e.previous || '' }))
          .filter((e) => !Number.isNaN(e.t)).sort((a, b) => a.t - b.t),
      };
      fs.writeFile(FF_CACHE, JSON.stringify(ff), () => {});
    } catch (e) {
      ff = { ...ff, error: `Kalender Forex Factory gagal dimuat: ${e.message}` };
    }
    ffPending = null;
    return ff;
  })();
  return ffPending;
}

function newsFor(inst, events) {
  const now = Date.now();
  const relevant = events.filter((e) => inst.cur.includes(e.cur) && (e.impact === 'High' || e.impact === 'Medium') && e.t > now - 3600e3 && e.t < now + 24 * 3600e3);
  const danger = relevant.find((e) => e.impact === 'High' && e.t > now - 30 * 60e3 && e.t < now + 4 * 3600e3) || null;
  return { relevant, danger };
}

// ---------- API ----------
async function apiAnalyze(q) {
  const inst = instruments().find((i) => i.id === q.get('id'));
  if (!inst) throw new Error('Instrumen tidak ditemukan.');
  const tf = TFS.includes(q.get('tf')) ? q.get('tf') : '1h';
  const [{ candles, source }, news] = await Promise.all([loadCandles(inst, tf), loadNews()]);
  const a = analyze(candles, tf);
  const { relevant, danger } = newsFor(inst, news.events);
  if (danger) a.confidence = Math.max(0, a.confidence - 20);
  const dayAgo = candles[candles.length - 1].t - 86400;
  const ref = [...candles].reverse().find((k) => k.t <= dayAgo) || candles[0];
  const out = {
    id: inst.id, name: inst.name, desc: inst.desc, tf,
    source: source.p === 'binance' ? 'Binance' : 'Twelve Data', proxy: source.proxy || null,
    dec: decimals(inst, a.price),
    change24h: ((a.price - ref.c) / ref.c) * 100,
    updated: Date.now(),
    news: { relevant, danger, error: news.error },
    ...a,
  };
  if (q.get('lite')) { delete out.series; return out; }
  const N = 400, from = Math.max(0, candles.length - N);
  out.candles = candles.slice(from);
  out.series = { ema20: a.series.ema20.slice(from), ema50: a.series.ema50.slice(from), ema200: a.series.ema200.slice(from) };
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (d) => { s += d; if (s.length > 1e5) reject(new Error('Terlalu besar.')); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('JSON tidak valid.')); } });
  });
}

function addCustom(b) {
  const raw = String(b.symbol || '').trim().toUpperCase();
  const type = ['crypto', 'stock', 'forex'].includes(b.type) ? b.type : 'stock';
  if (!/^[A-Z0-9./:-]{1,20}$/.test(raw)) throw new Error('Simbol tidak valid.');
  const id = 'c-' + raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (instruments().some((i) => i.id === id)) throw new Error('Simbol sudah ada di daftar.');
  let inst;
  if (type === 'crypto') {
    const s = raw.replace(/[^A-Z0-9]/g, '');
    inst = { id, name: s, desc: 'Kripto', type, cur: ['USD'], sources: [{ p: 'binance', s }] };
  } else if (type === 'forex') {
    const s = raw.includes('/') ? raw : raw.slice(0, 3) + '/' + raw.slice(3);
    inst = { id, name: s, desc: 'Forex', type, cur: s.split('/'), sources: [{ p: 'td', s }] };
  } else inst = { id, name: raw, desc: 'Saham', type, cur: ['USD'], sources: [{ p: 'td', s: raw }] };
  inst.custom = true;
  config.custom.push(inst);
  saveConfig();
  return inst;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/instruments' && req.method === 'GET') {
      return send(res, 200, { hasKey: !!config.tdKey, locked: LOCKED, items: instruments().map((i) => ({ id: i.id, name: i.name, desc: i.desc, type: i.type, custom: !!i.custom, needsKey: i.sources.every((s) => s.p === 'td') })) });
    }
    if (LOCKED && req.method !== 'GET') return send(res, 403, { error: 'Pengaturan dikunci pada versi online. Ubah lewat variabel TWELVEDATA_KEY di layanan hosting.' });
    if (url.pathname === '/api/instruments' && req.method === 'POST') return send(res, 200, addCustom(await readBody(req)));
    if (url.pathname === '/api/instruments' && req.method === 'DELETE') {
      config.custom = config.custom.filter((i) => i.id !== url.searchParams.get('id'));
      saveConfig();
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/analyze') return send(res, 200, await apiAnalyze(url.searchParams));
    if (url.pathname === '/api/news') { const n = await loadNews(); return send(res, 200, { events: n.events, error: n.error, updated: n.ts }); }
    if (url.pathname === '/api/config' && req.method === 'POST') {
      const b = await readBody(req);
      config.tdKey = String(b.tdKey || '').trim().slice(0, 100);
      saveConfig();
      cache.clear();
      return send(res, 200, { hasKey: !!config.tdKey });
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Tidak ditemukan.' });

    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Tidak ditemukan'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    send(res, 500, { error: e.message || String(e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Arah Pasar berjalan di http://localhost:${PORT}\n  Tekan Ctrl+C untuk berhenti.\n`);
});
