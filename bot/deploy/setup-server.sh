#!/usr/bin/env bash
# One-time setup on the Oracle Cloud server (Ubuntu). Run it on the server, from the bot folder:
#   bash ~/jvo-bot/deploy/setup-server.sh
# It installs Node.js (from nodejs.org, checksum-checked), adds a 2 GB swap file (the free server
# only has 1 GB of memory), and installs the "jvo-bot" service so the bot starts by itself when
# the server boots and restarts if it crashes. Safe to run again.
set -euo pipefail

BOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_MAJOR=24

echo "== Node.js $NODE_MAJOR =="
if ! command -v node >/dev/null || [[ "$(node -v)" != v$NODE_MAJOR.* ]]; then
  case "$(uname -m)" in
    x86_64) ARCH=x64 ;;
    aarch64) ARCH=arm64 ;;
    *) echo "Unknown processor type $(uname -m)"; exit 1 ;;
  esac
  BASE="https://nodejs.org/dist/latest-v$NODE_MAJOR.x"
  TMP="$(mktemp -d)"
  curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/SHASUMS256.txt"
  FILE="$(grep -o "node-v[0-9.]*-linux-$ARCH.tar.xz" "$TMP/SHASUMS256.txt" | head -1)"
  curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE"
  (cd "$TMP" && grep " $FILE\$" SHASUMS256.txt | sha256sum -c -)
  sudo tar -xJf "$TMP/$FILE" -C /usr/local --strip-components=1
  rm -rf "$TMP"
fi
echo "node $(node -v), npm $(npm -v)"

echo "== Swap file =="
if ! sudo swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
free -h | head -3

echo "== Bot packages =="
cd "$BOT_DIR"
npm ci --omit=dev --no-audit --no-fund

echo "== Settings file =="
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Made $BOT_DIR/.env from the example. Fill it in: nano $BOT_DIR/.env"
fi
chmod 600 .env

echo "== Service =="
sudo tee /etc/systemd/system/jvo-bot.service >/dev/null <<EOF
[Unit]
Description=I<3JVO pickup bot (Discord)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$BOT_DIR
ExecStart=/usr/local/bin/node --env-file-if-exists=.env src/index.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable jvo-bot >/dev/null

echo
echo "Done. Next:"
echo "  1. nano $BOT_DIR/.env        (fill in the settings, then Ctrl+O, Enter, Ctrl+X)"
echo "  2. sudo systemctl restart jvo-bot"
echo "  3. journalctl -u jvo-bot -f  (watch the log; Ctrl+C to stop watching)"
