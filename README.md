# Arah Pasar

Aplikasi analisa pasar: arah bullish/bearish, saran BUY/SELL, level entry, stop loss, dan TP,
ditambah kalender berita Forex Factory.

## Menjalankan

1. Pasang Node.js 18 atau lebih baru dari https://nodejs.org
2. Windows: klik dua kali `start.bat`. Mac/Linux: jalankan `./start.sh`
3. Browser terbuka di http://localhost:3000

## Sumber data

- Kripto (BTC, ETH, SOL, dll): Binance, tanpa API key.
- XAU/USD, forex, saham: Twelve Data, butuh API key gratis. Isi lewat tombol Pengaturan.
  Tanpa key, emas memakai PAXG/USDT sebagai pengganti.
- Berita: kalender mingguan Forex Factory.

Paket gratis Twelve Data dibatasi 8 permintaan per menit dan 800 per hari, dan umumnya hanya
mencakup saham AS (saham Indonesia seperti BBCA butuh paket berbayar).

## Cara sinyal dihitung

Skor -100 sampai +100 dari lima faktor: tren EMA 20/50/200 (25), tren timeframe lebih besar (25),
struktur puncak-lembah (20), MACD (15), RSI (15). BUY jika skor >= 30 dan timeframe besar searah,
SELL jika <= -30. Stop loss 1,5 x ATR atau di balik swing terakhir; TP 1/2/3 pada 1x, 2x, 3x jarak stop loss.

Ini alat bantu, bukan nasihat keuangan.
