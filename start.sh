#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js belum terpasang. Unduh di https://nodejs.org"; exit 1; }
(sleep 1; (open http://localhost:3000 || xdg-open http://localhost:3000) >/dev/null 2>&1) &
node server.js
