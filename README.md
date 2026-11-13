# Arah Pasar

Aplikasi analisa pasar: arah bullish/bearish, saran BUY/SELL, level entry, stop loss, dan TP,
ditambah kalender berita Forex Factory.

## Menjalankan

1. Pasang Node.js 18 atau lebih baru dari https://nodejs.org
2. Windows: klik dua kali `start.bat`. Mac/Linux: jalankan `./start.sh`
3. Browser terbuka di http://localhost:3000

## Sumber data

- Kripto (BTC, ETH, SOL, dll): Binance, tanpa API key.
- XAU/USD, forex, saham AS: Twelve Data, butuh API key gratis. Tanpa key, emas memakai PAXG/USDT sebagai pengganti.
- Saham Indonesia (927 emiten bisa dicari): Twelve Data paket Pro (berbayar). Di paket gratis hanya PGAS yang terbuka.
- Berita: kalender mingguan Forex Factory.

Paket gratis Twelve Data dibatasi 8 permintaan per menit dan 800 per hari.
Simbol yang Anda tambahkan disimpan di browser, jadi daftarnya berbeda di tiap perangkat.

## Cara sinyal dihitung

Skor -100 sampai +100 dari lima faktor: tren EMA 20/50/200 (25), tren timeframe lebih besar (25),
struktur puncak-lembah (20), MACD (15), RSI (15). BUY jika skor >= 30 dan timeframe besar searah,
SELL jika <= -30. Stop loss 2 x ATR atau di balik swing terakhir; TP 1/2/3 pada 1x, 2x, 3x jarak stop loss.

Ini alat bantu, bukan nasihat keuangan.

## Memasang online (Vercel, gratis tanpa kartu)

1. Di vercel.com masuk dengan akun GitHub, klik **Add New > Project**, pilih repo ini, lalu **Deploy**.
2. Untuk XAU/USD asli, forex, dan saham: di Settings > Environment Variables tambahkan `TWELVEDATA_KEY`, lalu Redeploy.

Pada versi online, tombol Pengaturan dan tambah simbol dinonaktifkan supaya orang lain tidak bisa mengubahnya.
