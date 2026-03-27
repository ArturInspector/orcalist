#!/usr/bin/env bash
# Запуск стека через PM2 (нужны: venv, npm deps в token-service, глобально pm2 или npx pm2)
set -euo pipefail
cd "$(dirname "$0")"
exec pm2 start ecosystem.config.js
