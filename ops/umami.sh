#!/usr/bin/env bash
# Instala o Umami (MIT, medição sem cookies) no servidor do Caju Office, ao lado do n8n.
# - Não mexe no docker-compose.yml do n8n: usa um docker-compose.override.yml (o docker compose junta os dois).
# - Faz cópia de segurança do Caddyfile antes de acrescentar dados.agendacaju.com.
# - Gera as chaves secretas aqui no servidor (nunca saem dele).
# - Recarrega o Caddy sem reiniciar (o n8n não pára).
set -euo pipefail
cd /opt/caju-office
STAMP=$(date +%Y%m%d-%H%M%S)

if [ -f docker-compose.override.yml ]; then
  echo "Já existe docker-compose.override.yml — paro para não estragar nada."; exit 1
fi

cp Caddyfile "Caddyfile.bak-$STAMP"
cp .env ".env.bak-$STAMP"

grep -q '^UMAMI_DB_PASSWORD=' .env || echo "UMAMI_DB_PASSWORD=$(openssl rand -hex 24)" >> .env
grep -q '^UMAMI_APP_SECRET=' .env || echo "UMAMI_APP_SECRET=$(openssl rand -hex 32)" >> .env
grep -q '^UMAMI_2FA_KEY=' .env || echo "UMAMI_2FA_KEY=$(openssl rand -hex 32)" >> .env

cat > docker-compose.override.yml <<'YML'
services:
  umami-db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: umami
      POSTGRES_USER: umami
      POSTGRES_PASSWORD: ${UMAMI_DB_PASSWORD}
    volumes:
      - umami_db:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U umami -d umami"]
      interval: 5s
      timeout: 5s
      retries: 10

  umami:
    image: ghcr.io/umami-software/umami:latest
    restart: unless-stopped
    init: true
    environment:
      DATABASE_URL: postgresql://umami:${UMAMI_DB_PASSWORD}@umami-db:5432/umami
      APP_SECRET: ${UMAMI_APP_SECRET}
      TWO_FACTOR_ENCRYPTION_KEY: ${UMAMI_2FA_KEY}
    expose:
      - "3000"
    depends_on:
      umami-db:
        condition: service_healthy

volumes:
  umami_db:
YML

if ! grep -q 'dados.agendacaju.com' Caddyfile; then
  printf '\ndados.agendacaju.com {\n\treverse_proxy umami:3000\n}\n' >> Caddyfile
fi

docker compose config -q            # valida antes de arrancar
docker compose up -d umami-db umami
docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile

echo "A aguardar o Umami arrancar..."
for i in $(seq 1 30); do
  if docker compose exec -T umami wget -qO- http://localhost:3000/api/heartbeat >/dev/null 2>&1; then break; fi
  sleep 5
done

echo
docker compose ps
echo
echo "PRONTO. Abrir https://dados.agendacaju.com — login inicial: admin / umami — TROCAR LOGO A PALAVRA-PASSE."
echo "Cópias de segurança: Caddyfile.bak-$STAMP e .env.bak-$STAMP"
