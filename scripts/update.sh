#!/bin/sh
set -eu

cd "$(dirname "$0")/.."

if [ ! -f data/sponsor.db ]; then
  echo "data/sponsor.db bulunamadı; güncelleme durduruldu." >&2
  exit 1
fi

echo "Güncelleme öncesi SQLite yedeği alınıyor..."
docker compose exec -T app node dist/server/backup.js

echo "Yeni imaj kurulup uygulama yeniden başlatılıyor..."
docker compose up -d --build
docker compose ps
