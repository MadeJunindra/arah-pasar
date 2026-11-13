@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js belum terpasang. Unduh di https://nodejs.org lalu jalankan file ini lagi. & pause & exit /b)
start "" http://localhost:3000
node server.js
pause
