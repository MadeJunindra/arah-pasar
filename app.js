'use strict';

const STORE_KEY = 'keuangan.v1';          // transaksi
const ACC_KEY = 'keuangan.accounts.v1';   // rekening
const COLORS = ['#7c3aed', '#2563eb', '#ea580c', '#0d9488', '#ca8a04', '#db2777', '#4b5563'];

const CATEGORIES = {
  out: [
    ['makan', '🍜', 'Makan & Minum'],
    ['transport', '🛵', 'Transportasi'],
    ['belanja', '🛒', 'Belanja'],
    ['tagihan', '💡', 'Tagihan'],
    ['pulsa', '📱', 'Pulsa & Internet'],
    ['kesehatan', '💊', 'Kesehatan'],
    ['hiburan', '🎬', 'Hiburan'],
    ['pendidikan', '📚', 'Pendidikan'],
    ['darurat', '🚨', 'Keperluan Darurat'],
    ['lainnya-out', '📦', 'Lainnya'],
  ],
  // Sumber pemasukan: [id, ikon, nama, rekening tujuan default]. Bisa diubah pengguna.
  in: [
    ['gaji', '💼', 'Gaji', 'payroll'],
    ['sampingan', '💻', 'Kerja Sampingan'],
    ['usaha', '🏪', 'Usaha'],
    ['bonus', '🎁', 'Bonus / Hadiah'],
    ['bunga', '🏦', 'Bunga Bank'],
    ['lainnya-in', '💰', 'Lainnya'],
  ],
};
const SRC_KEY = 'keuangan.sources.v1';
{ const saved = loadJSON(SRC_KEY); if (Array.isArray(saved) && saved.length) CATEGORIES.in = saved; }
let CAT_MAP;
function rebuildCatMap() {
  CAT_MAP = Object.fromEntries(
    [...CATEGORIES.out, ...CATEGORIES.in].map(([id, icon, name, account]) => [id, { icon, name, account }]));
}
rebuildCatMap();

const DEFAULT_ACCOUNTS = [
  { id: 'payroll', name: 'Payroll', bank: 'Bank Ganesha', purpose: 'Tempat gaji masuk', payroll: true, color: COLORS[0] },
  { id: 'darurat', name: 'Dana Darurat', bank: 'BCA', purpose: 'Hanya dipakai saat darurat', color: COLORS[1] },
  { id: 'tahunan', name: 'Tabungan 1 Tahun', bank: 'BRI', purpose: 'Untuk kebutuhan 1 tahun ke depan', color: COLORS[2] },
  { id: 'belanja', name: 'Belanja Bulanan', bank: 'BNI', purpose: 'Kebutuhan belanja sebulan', color: COLORS[3] },
  { id: 'bebas', name: 'Serba Guna', bank: 'Bank Mandiri', purpose: 'Untuk apa saja', color: COLORS[4] },
].map((a) => ({ initial: 0, target: 0, monthly: 0, payroll: false, ...a }));

const $ = (s) => document.querySelector(s);
const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
const fmt = (n) => rupiah.format(n).replace(/\s/g, '');
const monthFmt = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' });
const dayFmt = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long' });
const uid = () => crypto.randomUUID?.() || String(Date.now() + Math.random());
const num = (s) => Number(String(s).replace(/\D/g, '')) || 0;
const money = (n) => (n ? Number(n).toLocaleString('id-ID') : '');

let accounts = loadJSON(ACC_KEY) || structuredClone(DEFAULT_ACCOUNTS);
let txs = loadJSON(STORE_KEY) || [];
migrate();
let view = new Date(); view.setDate(1);
let filterAcc = 'all';
let editingId = null;
let editingAccId = null;

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(txs));
    localStorage.setItem(ACC_KEY, JSON.stringify(accounts));
    localStorage.setItem(SRC_KEY, JSON.stringify(CATEGORIES.in));
  } catch { toast('Gagal menyimpan data'); }
}
// Transaksi dari versi lama belum punya rekening: masukkan ke rekening payroll.
function migrate() {
  if (!accounts.length) accounts = structuredClone(DEFAULT_ACCOUNTS);
  const fallback = payrollAcc().id;
  let changed = false;
  txs.forEach((t) => { if (!t.account || !accById(t.account)) { t.account = fallback; changed = true; } });
  if (changed || !localStorage.getItem(ACC_KEY)) save();
}
function accById(id) { return accounts.find((a) => a.id === id); }
function payrollAcc() { return accounts.find((a) => a.payroll) || accounts[0]; }

function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function monthKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400);
}

// Saldo setiap rekening = saldo awal + masuk − keluar ± transfer
function balances() {
  const bal = Object.fromEntries(accounts.map((a) => [a.id, a.initial || 0]));
  for (const t of txs) {
    if (t.type === 'in') bal[t.account] += t.amount;
    else if (t.type === 'out') bal[t.account] -= t.amount;
    else if (t.type === 'transfer') { bal[t.account] -= t.amount; bal[t.to] += t.amount; }
  }
  return bal;
}
// Uang yang masuk ke rekening pada bulan tertentu (gaji/transfer masuk)
function depositsInMonth(accId, key) {
  return txs.filter((t) => t.date.startsWith(key) &&
    ((t.type === 'transfer' && t.to === accId) || (t.type === 'in' && t.account === accId)))
    .reduce((a, t) => a + t.amount, 0);
}

// ---------- Animasi & efek ----------
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Angka "berjalan" dari nilai lama ke nilai baru
function setMoney(el, value) {
  const from = Number(el.dataset.v ?? 0);
  el.dataset.v = value;
  cancelAnimationFrame(el._raf);
  if (reduceMotion || from === value) { el.textContent = fmt(value); return; }
  const start = performance.now(), dur = 800;
  const step = (now) => {
    const k = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - k, 4);
    el.textContent = fmt(Math.round(from + (value - from) * e));
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}
function confetti(n = 70) {
  if (reduceMotion) return;
  const box = document.createElement('div'); box.className = 'confetti';
  const colors = ['#c9a24a', '#e2c171', '#1a7a64', '#3cc7a6', '#fb8a5c', '#7c3aed', '#2563eb'];
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.setProperty('--x', (Math.random() * 160 - 80) + 'px');
    p.style.setProperty('--r', (Math.random() * 900 - 450) + 'deg');
    p.style.setProperty('--d', (1.4 + Math.random() * 1.4) + 's');
    p.style.animationDelay = Math.random() * .25 + 's';
    if (i % 3 === 0) { p.style.borderRadius = '50%'; p.style.width = p.style.height = '8px'; }
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 3200);
}
const buzz = () => navigator.vibrate?.(12);
// Singkatan: 1.500.000 -> "1,5 jt"
function fmtShort(n) {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  const f = (v) => v.toLocaleString('id-ID', { maximumFractionDigits: 1 });
  if (a >= 1e9) return `${s}${f(a / 1e9)} M`;
  if (a >= 1e6) return `${s}${f(a / 1e6)} jt`;
  if (a >= 1e3) return `${s}${f(a / 1e3)} rb`;
  return `${s}${a}`;
}
function initials(a) {
  const words = (a.bank || a.name).replace(/^bank\s+/i, '').trim().split(/\s+/);
  if (words[0].length <= 4 && words.length === 1) return words[0].toUpperCase();
  return (words.length > 1 ? words.map((w) => w[0]).join('') : words[0].slice(0, 3)).slice(0, 3).toUpperCase();
}

// ---------- Render ----------
let animateList = true, freshId = null, reached = null;

function render() { renderSummary(); renderList(); }

function renderSummary() {
  const key = monthKey(view);
  const bal = balances();

  // Rekening
  setMoney($('#totalBalance'), Object.values(bal).reduce((a, b) => a + b, 0));
  const nowReached = new Set(accounts.filter((a) => a.target && bal[a.id] >= a.target).map((a) => a.id));
  if (reached) {
    const hit = accounts.find((a) => nowReached.has(a.id) && !reached.has(a.id));
    if (hit) { confetti(110); setTimeout(() => toast(`🎉 Target "${hit.name}" tercapai!`), 300); }
  }
  reached = nowReached;

  const narrow = accounts.filter((a) => !a.payroll).length;
  $('#accounts').innerHTML = accounts.map((a, i) => {
    const b = bal[a.id];
    const pct = a.target ? Math.min(100, Math.max(0, Math.round((b / a.target) * 100))) : 0;
    const dep = depositsInMonth(a.id, key);
    const isLastOdd = !a.payroll && narrow % 2 === 1 && i === accounts.length - 1;
    const wide = a.payroll || isLastOdd;
    return `<button class="acc ${wide ? 'wide' : ''}" data-acc="${a.id}" style="--c:${a.color}">
      <div class="acc-head">
        <span class="acc-chip">${esc(initials(a))}</span>
        <span class="acc-title"><span class="acc-name">${esc(a.name)}</span><span class="acc-bank">${esc(a.bank || '—')}</span></span>
        ${a.payroll ? '<span class="badge">Payroll</span>' : ''}
      </div>
      <span class="acc-bal ${b < 0 ? 'neg' : ''}">${fmt(b)}</span>
      ${wide && a.purpose ? `<div class="acc-purpose">${esc(a.purpose)}</div>` : ''}
      ${a.target ? `<div class="bar"><i style="width:${pct}%"></i></div>
        <div class="acc-meta"><span class="${pct >= 100 ? 'ok' : ''}">${pct >= 100 ? 'Tercapai 🎉' : `${pct}% target`}</span><span>${fmtShort(a.target)}</span></div>` : ''}
      ${a.monthly ? `<div class="acc-meta"><span>Setoran</span><span class="${dep >= a.monthly ? 'ok' : ''}">${fmtShort(dep)} / ${fmtShort(a.monthly)}${dep >= a.monthly ? ' ✓' : ''}</span></div>` : ''}
    </button>`;
  }).join('');

  // Ringkasan bulan (transfer tidak dihitung)
  $('#monthLabel').textContent = monthFmt.format(view);
  const monthTx = txs.filter((t) => t.date.startsWith(key));
  const totalIn = monthTx.filter((t) => t.type === 'in').reduce((a, t) => a + t.amount, 0);
  const totalOut = monthTx.filter((t) => t.type === 'out').reduce((a, t) => a + t.amount, 0);
  setMoney($('#totalIn'), totalIn);
  setMoney($('#totalOut'), totalOut);
  setMoney($('#net'), totalIn - totalOut);
  $('#net').style.color = totalIn - totalOut < 0 ? 'var(--out)' : '';
  // Kartu utama selalu menampilkan bulan berjalan
  const nowKey = monthKey(new Date());
  const nowTx = txs.filter((t) => t.date.startsWith(nowKey));
  setMoney($('#heroIn'), nowTx.filter((t) => t.type === 'in').reduce((a, t) => a + t.amount, 0));
  setMoney($('#heroOut'), nowTx.filter((t) => t.type === 'out').reduce((a, t) => a + t.amount, 0));

  const byCat = {};
  monthTx.filter((t) => t.type === 'out').forEach((t) => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  $('#breakdown').innerHTML = rows.length
    ? rows.map(([c, v]) => {
        const cat = CAT_MAP[c] || { icon: '•', name: c };
        const pct = Math.round((v / totalOut) * 100);
        return `<div class="bar-row">
          <div class="bar-label"><span><span class="emo">${cat.icon}</span>${esc(cat.name)}</span><span>${fmt(v)} · ${pct}%</span></div>
          <div class="bar"><i style="width:${pct}%"></i></div></div>`;
      }).join('')
    : '<p class="muted small" style="margin:0">Belum ada pengeluaran bulan ini.</p>';

  // Pemasukan per sumber (semua sumber ditampilkan, ketuk untuk mengubah)
  const bySrc = {};
  monthTx.filter((t) => t.type === 'in').forEach((t) => { bySrc[t.category] = (bySrc[t.category] || 0) + t.amount; });
  const srcIds = [...CATEGORIES.in.map((c) => c[0]), ...Object.keys(bySrc).filter((id) => !CATEGORIES.in.some((c) => c[0] === id))];
  srcIds.sort((a, b) => (bySrc[b] || 0) - (bySrc[a] || 0));
  $('#sources').innerHTML = srcIds.map((id) => {
    const cat = CAT_MAP[id] || { icon: '•', name: id };
    const v = bySrc[id] || 0;
    const pct = totalIn ? Math.round((v / totalIn) * 100) : 0;
    const acc = cat.account && accById(cat.account);
    return `<button class="src ${v ? '' : 'idle'}" data-src="${esc(id)}">
      <div class="bar-label"><span><span class="emo">${cat.icon}</span>${esc(cat.name)}${acc ? ` <small class="muted">→ ${esc(acc.name)}</small>` : ''}</span>
      <span>${v ? `${fmt(v)} · ${pct}%` : '–'}</span></div>
      <div class="bar in"><i style="width:${pct}%"></i></div></button>`;
  }).join('');
}

function renderList() {
  const key = monthKey(view);
  if (filterAcc !== 'all' && !accById(filterAcc)) filterAcc = 'all';
  $('#chips').innerHTML = [['all', 'Semua'], ...accounts.map((a) => [a.id, a.name])]
    .map(([id, name]) => `<button role="tab" data-filter="${id}" aria-selected="${id === filterAcc}">${esc(name)}</button>`).join('');

  const q = $('#search').value.trim().toLowerCase();
  const shown = txs.filter((t) => t.date.startsWith(key))
    .filter((t) => filterAcc === 'all' || t.account === filterAcc || t.to === filterAcc)
    .filter((t) => !q || txText(t).toLowerCase().includes(q))
    .sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);

  let html = '', lastDay = '', i = 0;
  for (const t of shown) {
    if (t.date !== lastDay) {
      lastDay = t.date;
      html += `<li class="day" style="--i:${i++}">${dayFmt.format(new Date(t.date + 'T00:00'))}</li>`;
    }
    html += txRow(t).replace('<li class="tx', `<li style="--i:${i++}" class="tx${t.id === freshId ? ' fresh' : ''}`);
  }
  const list = $('#list');
  list.classList.toggle('stagger', animateList);
  list.innerHTML = html;
  animateList = false; freshId = null;
  $('#empty').hidden = shown.length > 0;
  $('#emptyText').textContent = q ? 'Tidak ada yang cocok.' : 'Belum ada transaksi bulan ini.';
}

function txText(t) {
  const acc = accById(t.account)?.name || '';
  if (t.type === 'transfer') return `Transfer ${acc} ${accById(t.to)?.name || ''} ${t.note}`;
  return `${CAT_MAP[t.category]?.name || ''} ${acc} ${t.note}`;
}
function txRow(t) {
  const acc = accById(t.account) || { name: '?', color: '#999' };
  const tag = (a) => `<span class="acc-tag"><i class="dot" style="--c:${a.color}"></i>${esc(a.name)}</span>`;
  let icon, title, sub, sign, cls = t.type;
  if (t.type === 'transfer') {
    const to = accById(t.to) || { name: '?', color: '#999' };
    icon = '🔁'; title = `Ke ${esc(to.name)}`;
    sub = `dari ${tag(acc)}`;
    // Saat difilter per rekening, tunjukkan arah uangnya
    if (filterAcc === t.to) { sign = '+'; cls = 'in'; }
    else if (filterAcc === t.account) { sign = '−'; cls = 'out'; }
    else sign = '';
  } else {
    const cat = CAT_MAP[t.category] || { icon: '•', name: t.category };
    icon = cat.icon; title = esc(cat.name); sub = tag(acc);
    sign = t.type === 'in' ? '+' : '−';
  }
  if (t.note) sub += ` · ${esc(t.note)}`;
  return `<li class="tx" data-id="${t.id}" tabindex="0">
    <span class="ico">${icon}</span>
    <span class="info"><b>${title}</b><small>${sub}</small></span>
    <span class="amt ${cls}">${sign}${fmt(t.amount)}</span></li>`;
}

// ---------- Form transaksi ----------
function accOptions(sel, selected, exclude) {
  sel.innerHTML = accounts.filter((a) => a.id !== exclude)
    .map((a) => `<option value="${a.id}" ${a.id === selected ? 'selected' : ''}>${esc(a.name)}${a.bank ? ` (${esc(a.bank)})` : ''}</option>`).join('');
}
function currentType() { return document.querySelector('input[name="type"]:checked').value; }
function applyType(type, tx) {
  const isTr = type === 'transfer';
  $('#categoryWrap').hidden = isTr;
  $('#toWrap').hidden = !isTr;
  $('#accountLabel').textContent = type === 'in' ? 'Masuk ke rekening' : 'Dari rekening';
  $('#categoryLabel').textContent = type === 'in' ? 'Sumber pemasukan' : 'Kategori';
  if (!isTr) fillCategory(type, tx?.category);
  const last = loadJSON('keuangan.last') || {};
  const srcAcc = type === 'in' && !tx ? CAT_MAP[$('#category').value]?.account : null;
  const from = tx?.account || (srcAcc && accById(srcAcc) ? srcAcc : null) || (filterAcc !== 'all' ? filterAcc : null) ||
    last[type] || (type === 'out' ? (accById('belanja') || accounts[0]).id : payrollAcc().id);
  accOptions($('#account'), accById(from) ? from : accounts[0].id);
  if (isTr) {
    const to = tx?.to || accounts.find((a) => a.id !== $('#account').value)?.id;
    accOptions($('#toAccount'), to);
  }
}
function fillCategory(type, selected) {
  $('#category').innerHTML = CATEGORIES[type]
    .map(([id, icon, name]) => `<option value="${id}" ${id === selected ? 'selected' : ''}>${icon} ${esc(name)}</option>`).join('') +
    (type === 'in' ? '<option value="__new">➕ Tambah sumber baru…</option>' : '');
}
let lastCategory = null;
$('#category').addEventListener('focus', () => { lastCategory = $('#category').value; });
$('#category').addEventListener('change', () => {
  const v = $('#category').value;
  if (v === '__new') { $('#category').value = lastCategory || CATEGORIES.in[0][0]; openSrcForm(null, true); return; }
  lastCategory = v;
  // Sumber punya rekening tujuan default -> pilih otomatis
  const acc = CAT_MAP[v]?.account;
  if (currentType() === 'in' && acc && accById(acc)) $('#account').value = acc;
});

function openForm(tx, preset) {
  editingId = tx ? tx.id : null;
  const type = tx ? tx.type : (preset || 'out');
  $('#formTitle').textContent = tx ? 'Ubah transaksi' : 'Tambah transaksi';
  document.querySelector(`input[name="type"][value="${type}"]`).checked = true;
  applyType(type, tx);
  $('#amount').value = tx ? money(tx.amount) : '';
  $('#date').value = tx ? tx.date : (monthKey(view) === monthKey(new Date()) ? todayISO() : `${monthKey(view)}-01`);
  $('#note').value = tx ? tx.note : '';
  $('#deleteBtn').hidden = !tx;
  $('#dialog').showModal();
  if (!tx) setTimeout(() => $('#amount').focus(), 50);
}

document.querySelectorAll('input[name="type"]').forEach((r) =>
  r.addEventListener('change', () => applyType(r.value)));

// Format angka ribuan otomatis di semua kolom uang
document.addEventListener('input', (e) => {
  if (e.target.id === 'amount' || e.target.classList.contains('money')) {
    e.target.value = money(num(e.target.value));
    if (e.target.closest('#splitRows')) updateSplitTotal();
  }
});

$('#form').addEventListener('submit', (e) => {
  const amount = num($('#amount').value);
  const type = currentType();
  if (!amount) { e.preventDefault(); toast('Isi jumlahnya dulu'); $('#amount').focus(); return; }
  if (type === 'transfer' && $('#account').value === $('#toAccount').value) {
    e.preventDefault(); toast('Rekening asal dan tujuan harus berbeda'); return;
  }
  const data = {
    type, amount,
    account: $('#account').value,
    date: $('#date').value,
    note: $('#note').value.trim(),
  };
  if (type === 'transfer') { data.to = $('#toAccount').value; data.category = null; }
  else { data.category = $('#category').value; delete data.to; }

  if (editingId) {
    const t = txs.find((x) => x.id === editingId);
    delete t.to; Object.assign(t, data);
    toast('Transaksi diperbarui');
  } else {
    const id = uid(); freshId = id;
    txs.push({ id, created: Date.now(), ...data });
    toast(type === 'in' ? '💰 Pemasukan dicatat' : type === 'transfer' ? '🔁 Transfer dicatat' : 'Pengeluaran dicatat');
    if (type === 'in') confetti(40);
    buzz();
  }
  const last = loadJSON('keuangan.last') || {}; last[type] = data.account;
  try { localStorage.setItem('keuangan.last', JSON.stringify(last)); } catch {}
  save();
  const d = new Date(data.date + 'T00:00'); view = new Date(d.getFullYear(), d.getMonth(), 1);
  render();
});

$('#deleteBtn').addEventListener('click', () => {
  if (!confirm('Hapus transaksi ini?')) return;
  txs = txs.filter((t) => t.id !== editingId);
  save(); render(); $('#dialog').close(); toast('Transaksi dihapus');
});
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

$('#addBtn').addEventListener('click', () => openForm());
$('#list').addEventListener('click', (e) => {
  const li = e.target.closest('.tx'); if (li) openForm(txs.find((t) => t.id === li.dataset.id));
});
$('#list').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.closest('.tx')?.click(); });
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-filter]'); if (b) { filterAcc = b.dataset.filter; animateList = true; renderList(); }
});

$('#prevMonth').addEventListener('click', () => { view.setMonth(view.getMonth() - 1); animateList = true; render(); });
$('#nextMonth').addEventListener('click', () => { view.setMonth(view.getMonth() + 1); animateList = true; render(); });
$('#search').addEventListener('input', renderList);
document.querySelectorAll('[data-quick]').forEach((b) => b.addEventListener('click', () => openForm(null, b.dataset.quick)));

// Sapaan sesuai waktu
{ const h = new Date().getHours();
  $('#greeting').textContent = h < 11 ? 'Selamat pagi ☀️' : h < 15 ? 'Selamat siang 🌤️' : h < 19 ? 'Selamat sore 🌇' : 'Selamat malam 🌙'; }
// Nama pengguna: ditanya sekali saat pertama buka, bisa diubah dengan mengetuk nama
const NAME_KEY = 'keuangan.name';
function getName() { try { return localStorage.getItem(NAME_KEY); } catch { return null; } }
function showName() {
  const n = getName();
  $('#userName').textContent = n || 'Keuangan';
  document.title = n ? `Keuangan ${n}` : 'Catatan Keuangan';
}
function openNameForm(first) {
  const n = getName();
  $('#nameTitle').textContent = first ? 'Selamat datang!' : 'Ubah nama';
  $('#nameHint').hidden = !first;
  $('.welcome-art').hidden = !first;
  $('#nameSubmit').textContent = first ? 'Mulai' : 'Simpan';
  $('#nameSkip').textContent = first ? 'Lewati' : 'Batal';
  $('#nameInput').value = n || '';
  $('#nameDialog').showModal();
  setTimeout(() => $('#nameInput').focus(), 300);
}
$('#nameBtn').addEventListener('click', () => openNameForm(false));
$('#nameSkip').addEventListener('click', () => {
  // "Lewati" tetap dicatat supaya tidak ditanya lagi; nama bisa diisi nanti dengan mengetuk judul
  if (getName() === null) { try { localStorage.setItem(NAME_KEY, ''); } catch {} }
  $('#nameDialog').close();
});
$('#nameForm').addEventListener('submit', () => {
  const n = $('#nameInput').value.trim().replace(/\s+/g, ' ');
  try { localStorage.setItem(NAME_KEY, n); } catch {}
  showName();
  if (n) { toast(`Hai, ${n}! 👋`); confetti(40); }
});
showName();
if (getName() === null) setTimeout(() => openNameForm(true), 700);

// Garis bawah header saat halaman digulir
addEventListener('scroll', () => $('.topbar').classList.toggle('scrolled', scrollY > 8), { passive: true });
// Mode privasi: sembunyikan semua nominal
function applyPrivacy(on) {
  document.body.classList.toggle('private', on);
  $('#privacyBtn').setAttribute('aria-pressed', on);
  $('#privacyBtn').setAttribute('aria-label', on ? 'Tampilkan nominal' : 'Sembunyikan nominal');
  $('#privacyBtn use').setAttribute('href', on ? '#i-eye-off' : '#i-eye');
}
applyPrivacy(localStorage.getItem('keuangan.private') === '1');
$('#privacyBtn').addEventListener('click', () => {
  const on = !document.body.classList.contains('private');
  applyPrivacy(on); buzz();
  try { localStorage.setItem('keuangan.private', on ? '1' : '0'); } catch {}
});
// Ketuk area gelap di luar sheet untuk menutup
document.querySelectorAll('dialog.sheet').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

// ---------- Form rekening ----------
let pickedColor = COLORS[0];
function renderColors() {
  $('#accColors').innerHTML = COLORS.map((c) =>
    `<button type="button" style="--c:${c}" data-color="${c}" aria-label="Warna ${c}" aria-pressed="${c === pickedColor}"></button>`).join('');
}
$('#accColors').addEventListener('click', (e) => {
  const b = e.target.closest('[data-color]'); if (b) { pickedColor = b.dataset.color; renderColors(); }
});
function openAccForm(acc) {
  editingAccId = acc ? acc.id : null;
  $('#accTitle').textContent = acc ? 'Ubah rekening' : 'Tambah rekening';
  $('#accName').value = acc?.name || '';
  $('#accBank').value = acc?.bank || '';
  $('#accPurpose').value = acc?.purpose || '';
  $('#accInitial').value = money(acc?.initial);
  $('#accTarget').value = money(acc?.target);
  $('#accMonthly').value = money(acc?.monthly);
  $('#accPayroll').checked = !!acc?.payroll;
  pickedColor = acc?.color || COLORS[accounts.length % COLORS.length];
  renderColors();
  $('#accDeleteBtn').hidden = !acc || accounts.length <= 1;
  $('#accDialog').showModal();
}
$('#addAccountBtn').addEventListener('click', () => openAccForm());
$('#accounts').addEventListener('click', (e) => {
  const b = e.target.closest('[data-acc]'); if (b) openAccForm(accById(b.dataset.acc));
});
$('#accForm').addEventListener('submit', (e) => {
  const name = $('#accName').value.trim();
  if (!name) { e.preventDefault(); toast('Isi nama rekening'); return; }
  const data = {
    name, bank: $('#accBank').value.trim(), purpose: $('#accPurpose').value.trim(),
    initial: num($('#accInitial').value), target: num($('#accTarget').value),
    monthly: num($('#accMonthly').value), payroll: $('#accPayroll').checked, color: pickedColor,
  };
  if (data.payroll) accounts.forEach((a) => { a.payroll = false; });
  if (editingAccId) Object.assign(accById(editingAccId), data);
  else accounts.push({ id: uid(), ...data });
  save(); render(); toast('Rekening disimpan');
});
$('#accDeleteBtn').addEventListener('click', () => {
  const used = txs.filter((t) => t.account === editingAccId || t.to === editingAccId).length;
  if (used) { alert(`Rekening ini masih dipakai di ${used} transaksi. Hapus atau pindahkan transaksinya dulu.`); return; }
  if (!confirm('Hapus rekening ini?')) return;
  accounts = accounts.filter((a) => a.id !== editingAccId);
  if (!accounts.some((a) => a.payroll)) accounts[0].payroll = true;
  save(); render(); $('#accDialog').close(); toast('Rekening dihapus');
});

// ---------- Sumber pemasukan ----------
let editingSrcId = null, srcFromTxForm = false;
function openSrcForm(id, fromTx = false) {
  editingSrcId = id; srcFromTxForm = fromTx;
  const src = id && CATEGORIES.in.find((c) => c[0] === id);
  $('#srcTitle').textContent = src ? 'Ubah sumber pemasukan' : 'Tambah sumber pemasukan';
  $('#srcName').value = src ? src[2] : '';
  $('#srcIcon').value = src ? src[1] : '💵';
  $('#srcAccount').innerHTML = '<option value="">— tidak ada —</option>' + accounts
    .map((a) => `<option value="${a.id}" ${src && src[3] === a.id ? 'selected' : ''}>${esc(a.name)}${a.bank ? ` (${esc(a.bank)})` : ''}</option>`).join('');
  $('#srcDeleteBtn').hidden = !src || CATEGORIES.in.length <= 1;
  $('#srcDialog').showModal();
  $('#srcName').focus();
}
$('#addSourceBtn').addEventListener('click', () => openSrcForm(null));
$('#sources').addEventListener('click', (e) => {
  const b = e.target.closest('[data-src]');
  if (b && CATEGORIES.in.some((c) => c[0] === b.dataset.src)) openSrcForm(b.dataset.src);
});
$('#srcIcons').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (b) $('#srcIcon').value = b.textContent;
});
$('#srcForm').addEventListener('submit', (e) => {
  const name = $('#srcName').value.trim();
  if (!name) { e.preventDefault(); toast('Isi nama sumber'); return; }
  const icon = [...($('#srcIcon').value.trim() || '💵')].slice(0, 2).join('');
  const account = $('#srcAccount').value || undefined;
  let id = editingSrcId, moved = 0;
  if (id) {
    const i = CATEGORIES.in.findIndex((c) => c[0] === id);
    const oldAccount = CATEGORIES.in[i][3];
    CATEGORIES.in[i] = [id, icon, name, account];
    // Rekening default diganti: tawarkan memindahkan pemasukan lama dari sumber ini juga
    const past = txs.filter((t) => t.type === 'in' && t.category === id && account && t.account !== account);
    if (account !== oldAccount && past.length && accById(account) &&
        confirm(`Pindahkan juga ${past.length} pemasukan "${name}" yang sudah tercatat ke rekening ${accById(account).name}?\n\nPilih "Batal" kalau hanya pemasukan berikutnya yang masuk ke rekening ini.`)) {
      past.forEach((t) => { t.account = account; });
      moved = past.length;
    }
  } else {
    id = uid();
    // Sisipkan sebelum "Lainnya" supaya "Lainnya" tetap di bawah
    const i = CATEGORIES.in.findIndex((c) => c[0] === 'lainnya-in');
    CATEGORIES.in.splice(i < 0 ? CATEGORIES.in.length : i, 0, [id, icon, name, account]);
  }
  CATEGORIES.in = CATEGORIES.in.map((c) => (c[3] ? c : c.slice(0, 3)));
  rebuildCatMap(); save(); render();
  toast(moved ? `Sumber disimpan, ${moved} pemasukan dipindahkan` : 'Sumber pemasukan disimpan');
  if (srcFromTxForm && $('#dialog').open) {
    fillCategory('in', id);
    if (account && accById(account)) $('#account').value = account;
  }
});
$('#srcDeleteBtn').addEventListener('click', () => {
  const used = txs.filter((t) => t.type === 'in' && t.category === editingSrcId);
  const rest = CATEGORIES.in.filter((c) => c[0] !== editingSrcId);
  // Transaksi yang memakai sumber ini dipindah ke "Lainnya" (atau sumber pertama yang tersisa)
  const target = rest.find((c) => c[0] === 'lainnya-in') || rest[0];
  const msg = used.length
    ? `Sumber ini dipakai di ${used.length} pemasukan.\n\nPemasukan tersebut TIDAK ikut terhapus, tapi dipindahkan ke sumber "${target[2]}". Saldo tidak berubah.\n\nLanjut hapus?`
    : 'Hapus sumber pemasukan ini?';
  if (!confirm(msg)) return;
  used.forEach((t) => { t.category = target[0]; });
  CATEGORIES.in = rest;
  rebuildCatMap(); save(); render(); $('#srcDialog').close();
  toast(used.length ? `Sumber dihapus, ${used.length} pemasukan dipindah ke "${target[2]}"` : 'Sumber dihapus');
});

// ---------- Bagi gaji ----------
function renderSplit() {
  const from = $('#splitFrom').value;
  const key = monthKey(new Date($('#splitDate').value + 'T00:00'));
  $('#splitAvail').textContent = `Saldo saat ini: ${fmt(balances()[from])}`;
  $('#splitRows').innerHTML = accounts.filter((a) => a.id !== from).map((a) => {
    // Kurangi setoran yang sudah masuk bulan ini supaya tidak dobel
    const left = Math.max(0, (a.monthly || 0) - depositsInMonth(a.id, key));
    return `<label class="split-row"><span>${esc(a.name)}<small>${esc(a.bank || '')}${a.monthly ? ` · rutin ${fmt(a.monthly)}` : ''}</small></span>
      <input class="money" inputmode="numeric" data-to="${a.id}" value="${money(left)}" placeholder="0"></label>`;
  }).join('');
  updateSplitTotal();
}
function updateSplitTotal() {
  const total = [...document.querySelectorAll('#splitRows input')].reduce((s, i) => s + num(i.value), 0);
  $('#splitTotal').textContent = fmt(total);
}
$('#splitBtn').addEventListener('click', () => {
  accOptions($('#splitFrom'), payrollAcc().id);
  $('#splitDate').value = todayISO();
  renderSplit();
  $('#splitDialog').showModal();
});
$('#splitFrom').addEventListener('change', renderSplit);
$('#splitDate').addEventListener('change', renderSplit);
$('#splitForm').addEventListener('submit', (e) => {
  const from = $('#splitFrom').value, date = $('#splitDate').value;
  const items = [...document.querySelectorAll('#splitRows input')]
    .map((i) => ({ to: i.dataset.to, amount: num(i.value) })).filter((x) => x.amount > 0);
  if (!items.length) { e.preventDefault(); toast('Isi minimal satu jumlah'); return; }
  const total = items.reduce((s, x) => s + x.amount, 0);
  if (total > balances()[from] && !confirm(`Total ${fmt(total)} lebih besar dari saldo rekening asal. Tetap simpan?`)) {
    e.preventDefault(); return;
  }
  const now = Date.now();
  items.forEach((x, i) => txs.push({
    id: uid(), created: now + i, type: 'transfer', account: from, to: x.to,
    amount: x.amount, category: null, date, note: 'Bagi gaji',
  }));
  save();
  const d = new Date(date + 'T00:00'); view = new Date(d.getFullYear(), d.getMonth(), 1);
  render(); confetti(60); buzz(); toast(`✨ ${items.length} transfer dicatat`);
});

// ---------- Ekspor / Impor ----------
function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#exportBtn').addEventListener('click', () =>
  download(`keuangan-${todayISO()}.json`, JSON.stringify({ version: 3, accounts, sources: CATEGORIES.in, txs }, null, 2), 'application/json'));
$('#exportCsvBtn').addEventListener('click', () => {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const JENIS = { in: 'Pemasukan', out: 'Pengeluaran', transfer: 'Transfer' };
  const lines = [['Tanggal', 'Jenis', 'Rekening', 'Ke Rekening', 'Kategori', 'Jumlah', 'Catatan'].join(',')];
  [...txs].sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => lines.push([
    t.date, JENIS[t.type], q(accById(t.account)?.name), q(t.to ? accById(t.to)?.name : ''),
    q(t.category ? CAT_MAP[t.category]?.name || t.category : ''), t.amount, q(t.note),
  ].join(',')));
  download(`keuangan-${todayISO()}.csv`, '﻿' + lines.join('\n'), 'text/csv');
});
$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const inTx = Array.isArray(data) ? data : data.txs;        // format lama = array
    if (!Array.isArray(inTx)) throw 0;
    let accAdded = 0;
    if (Array.isArray(data.accounts)) {
      data.accounts.filter((a) => a && a.id && a.name && !accById(a.id)).forEach((a) => {
        accounts.push({ initial: 0, target: 0, monthly: 0, color: COLORS[0], ...a, payroll: false }); accAdded++;
      });
    }
    if (Array.isArray(data.sources)) {
      data.sources.filter((c) => Array.isArray(c) && c[0] && c[2] && !CATEGORIES.in.some((x) => x[0] === c[0]))
        .forEach((c) => CATEGORIES.in.push(c.slice(0, 4)));
      rebuildCatMap();
    }
    const valid = inTx.filter((t) => t && t.id && ['in', 'out', 'transfer'].includes(t.type) &&
      Number.isFinite(t.amount) && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && (t.type !== 'transfer' || accById(t.to)));
    const ids = new Set(txs.map((t) => t.id));
    const added = valid.filter((t) => !ids.has(t.id)).map((t) => ({ note: '', created: Date.now(), ...t }));
    txs.push(...added); migrate(); save(); render();
    toast(`${added.length} transaksi${accAdded ? ` & ${accAdded} rekening` : ''} diimpor`);
  } catch { toast('File tidak valid'); }
  e.target.value = '';
});

// ---------- PWA ----------
const APP_VERSION = '7 · 14 Nov 2026';
$('#appVersion').textContent = APP_VERSION;
let swReg = null;
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  const checkUpdate = () => swReg?.update().catch(() => {});
  // updateViaCache 'none': saat cek versi baru, sw.js selalu diambil dari server
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    swReg = reg;
    checkUpdate();
  }).catch(() => {});
  // iOS sering "menidurkan" aplikasi: cek lagi setiap kali aplikasi kembali dibuka,
  // saat internet tersambung lagi, dan tiap 30 menit selama aplikasi terbuka.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
  addEventListener('online', checkUpdate);
  setInterval(checkUpdate, 30 * 60 * 1000);
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) $('#updateBar').hidden = false; });
}
$('#updateBtn').addEventListener('click', () => location.reload());
// Tombol manual: paksa cek dan muat ulang
$('#checkUpdateBtn').addEventListener('click', async () => {
  if (!navigator.onLine) { toast('Tidak ada internet'); return; }
  toast('Memeriksa pembaruan…');
  try { await swReg?.update(); } catch {}
  setTimeout(() => location.reload(), 800);
});
let installPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); installPrompt = e; $('#installBtn').hidden = false;
});
$('#installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt(); await installPrompt.userChoice;
  installPrompt = null; $('#installBtn').hidden = true;
});
window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('Aplikasi terpasang'); });

render();
