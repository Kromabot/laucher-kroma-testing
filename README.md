# KromaBot / Launcher Bot

Monorepo para o KromaBot:

- `apps/web`: frontend React/Vite.
- `apps/api`: API Node/Express com Discord OAuth2, Stripe, Prisma e PostgreSQL.
- `apps/bot`: worker Discord.

## Produção

Domínio esperado:

```env
WEB_APP_URL=https://www.kromabot.com
API_BASE_URL=https://www.kromabot.com/api
VITE_API_URL=/api
DISCORD_REDIRECT_URI=https://www.kromabot.com/api/auth/callback
```

A API monta as rotas públicas com prefixo `/api`:

- `GET /api/health`
- `GET /api/auth/login`
- `GET /api/auth/callback`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/bot/stats`
- `GET /api/guilds`
- `GET /api/configs/:guildId`
- `GET /api/plans`
- `POST /api/billing/guilds/:guildId/checkout`
- `POST /api/billing/webhook`
- `POST /api/interactions`

`/health` continua disponível como compatibilidade, mas Nginx e healthchecks devem usar `/api/health`.

## Environment

Copiar um dos exemplos e preencher segredos reais:

```bash
cp .env.example .env
cp .env.production.example .env.production
```

Variáveis obrigatórias em produção:

```env
NODE_ENV=production
PORT=3001
WEB_APP_URL=https://www.kromabot.com
API_BASE_URL=https://www.kromabot.com/api
VITE_API_URL=/api
BOT_API_KEY=replace_with_a_long_random_secret_at_least_32_chars
DATABASE_URL=postgresql://launcherbot:replace_password@127.0.0.1:5432/launcher_bot
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_PUBLIC_KEY=your_discord_application_public_key
DISCORD_REDIRECT_URI=https://www.kromabot.com/api/auth/callback
DISCORD_BOT_TOKEN=your_discord_bot_token
STRIPE_SECRET_KEY=sk_live_your_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
STRIPE_PREMIUM_PRICE_ID=price_your_premium_price_id
STRIPE_PUBLISHABLE_KEY=pk_live_your_key
```

`BOT_API_KEY` deve ter pelo menos 32 caracteres:

```bash
openssl rand -hex 32
```

## Desenvolvimento

```bash
npm ci
npm run dev:api
npm run dev:web
npm run dev:bot
```

O frontend chama sempre `/api` por `VITE_API_URL`. Em desenvolvimento, o Vite faz proxy de `/api` para `http://127.0.0.1:3001`.

## PostgreSQL e Prisma

Criar base de dados:

```bash
sudo -u postgres psql
```

```sql
CREATE USER launcherbot WITH PASSWORD 'replace_password';
CREATE DATABASE launcher_bot OWNER launcherbot;
\q
```

Aplicar schema e gerar Prisma Client:

```bash
npx prisma db push --schema apps/api/prisma/schema.prisma
npx prisma generate --schema apps/api/prisma/schema.prisma
```

Scripts equivalentes:

```bash
npm --workspace apps/api run prisma:push
npm --workspace apps/api run prisma:generate
```

Em deploy com migrations:

```bash
npm --workspace apps/api run prisma:deploy
```

## Build

```bash
npm run build --workspaces
```

Para produção, o web deve ser compilado com:

```bash
VITE_API_URL=/api npm --workspace apps/web run build
```

## Deploy VPS Ubuntu com systemd

Pré-requisitos:

```bash
sudo apt update
sudo apt install -y rsync nginx postgresql postgresql-contrib
```

Instalar Node.js 20+ e depois:

```bash
sudo bash deploy/ubuntu/install.sh
```

Editar env:

```bash
sudo nano /etc/launcher-bot/launcher-bot.env
```

Reexecutar instalador:

```bash
sudo bash deploy/ubuntu/install.sh
```

Serviços:

```bash
sudo systemctl status launcher-bot-api launcher-bot
sudo journalctl -u launcher-bot-api -u launcher-bot -f
sudo systemctl restart launcher-bot-api launcher-bot
```

A API faz bind em `127.0.0.1:3001` quando `NODE_ENV=production` no deploy systemd. O Docker Compose define `API_BIND_HOST=0.0.0.0` apenas para permitir tráfego interno da rede Docker.

## Nginx

Copiar exemplo:

```bash
sudo cp /opt/launcher-bot/deploy/ubuntu/nginx.conf.example /etc/nginx/sites-available/kromabot
sudo ln -sf /etc/nginx/sites-available/kromabot /etc/nginx/sites-enabled/kromabot
sudo nginx -t
sudo systemctl reload nginx
```

Ponto importante: `proxy_pass` não remove `/api`:

```nginx
location /api/ {
    proxy_pass http://127.0.0.1:3001;
}
```

## SSL e Cloudflare

Com Cloudflare:

- DNS `A` para `www.kromabot.com` apontado para a VPS.
- SSL/TLS em `Full (strict)` depois de instalar certificado válido na VPS.
- Proxy laranja pode ficar ativo depois de validar Nginx e Certbot.
- Não criar regra que remova `/api`.
- Webhook Stripe: `https://www.kromabot.com/api/billing/webhook`.
- Discord interactions endpoint: `https://www.kromabot.com/api/interactions`.

Certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d www.kromabot.com -d kromabot.com
sudo nginx -t
sudo systemctl reload nginx
```

## Docker opcional

Copiar env:

```bash
cp .env.production.example .env.production
```

Subir:

```bash
docker compose up -d --build
```

### Ambientes separados: teste e produção

Este repositório já tem dois stacks de Docker Compose separados:

- `docker-compose.test.yml` para o ambiente de teste
- `docker-compose.prod.yml` para o ambiente de produção

Para o ambiente de teste, use:

```bash
cp .env.test.example .env.test
# editar .env.test com valores de teste reais

docker compose -f docker-compose.test.yml -p laucherbot-test up -d --build
```

O ambiente de teste expõe:

- `http://127.0.0.1:3002` para a API no host
- `http://127.0.0.1:8081` para a Web no host

Para o ambiente de produção, use:

```bash
cp .env.production.example .env.production
# editar .env.production com valores de produção reais

docker compose -f docker-compose.prod.yml -p laucherbot-prod up -d --build
```

Se quiseres manter os dois ambientes no mesmo host, os stacks estão separados por nome de projeto (`-p`) e por portas diferentes.

Aplicar Prisma:

```bash
docker compose run --rm api npm --workspace apps/api run prisma:push
docker compose run --rm api npm --workspace apps/api run prisma:generate
```

Serviços Docker:

- `postgres`: PostgreSQL com volume persistente.
- `api`: Express API.
- `bot`: Discord bot worker.
- `web`: build Vite servido por Nginx.

Para VPS com Nginx no host, encaminhar `/api` para `127.0.0.1:3001` e o frontend Docker para `127.0.0.1:8080`, ou usar o deploy systemd recomendado.

## Troubleshooting

Ver API:

```bash
curl -i https://www.kromabot.com/api/health
```

Se Discord OAuth falhar:

- Confirmar `DISCORD_REDIRECT_URI=https://www.kromabot.com/api/auth/callback`.
- Confirmar a mesma URL no Discord Developer Portal.
- Confirmar cookies com `SESSION_COOKIE_SECURE=true`.

Se Discord interactions falhar:

- Confirmar `DISCORD_PUBLIC_KEY`.
- Confirmar URL `https://www.kromabot.com/api/interactions`.
- Confirmar que Nginx mantém o prefixo `/api`.

Se a dashboard não chamar a API:

- Confirmar build com `VITE_API_URL=/api`.
- Confirmar Nginx `location /api/`.

Se Prisma falhar:

- Confirmar `DATABASE_URL`.
- Correr `npx prisma db push --schema apps/api/prisma/schema.prisma`.
