#!/usr/bin/env bash
# setup-server.sh — ставит сервер «Медвежьего угла» на чистый Ubuntu 24.04 одной командой:
#   curl -fsSL https://raw.githubusercontent.com/SE3YAA/medvezhiy-ugol/main/setup-server.sh | sudo bash
#
# Что делает:
#   1. ставит Docker;
#   2. скачивает Supabase (база PostgreSQL, вход пользователей, хранилище фото, панель управления);
#   3. генерирует пароли и ключи (свои для этого сервера, нигде больше их нет);
#   4. запускает всё и применяет схему базы schema.sql из репозитория;
#   5. включает HTTPS через Caddy на бесплатном адресе вида api.1-2-3-4.sslip.io;
#   6. печатает адрес сервера и ключи и сохраняет их в /root/medvezhiy-keys.txt.
# Запускать можно повторно: уже сделанные шаги пропускаются, ключи не перегенерируются.
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/SE3YAA/medvezhiy-ugol/main"
SITE="https://se3yaa.github.io/medvezhiy-ugol/"
DIR=/opt/medvezhiy

say() { printf '\n\033[1;36m%s\033[0m\n' "$*"; }
[ "$(id -u)" = 0 ] || { echo "Запустите через sudo: ... | sudo bash"; exit 1; }

IP=$(curl -fsS4 --max-time 10 https://api.ipify.org || curl -fsS4 --max-time 10 https://ifconfig.me)
DOMAIN="api.$(echo "$IP" | tr . -).sslip.io"
mkdir -p "$DIR" && cd "$DIR"

say "1/6 Ставлю Docker"
export DEBIAN_FRONTEND=noninteractive
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl git python3 docker.io docker-compose-v2
fi
# Зеркала на случай, если Docker Hub недоступен из России
if [ ! -f /etc/docker/daemon.json ]; then
  mkdir -p /etc/docker
  echo '{"registry-mirrors":["https://mirror.gcr.io","https://dockerhub.timeweb.cloud"]}' > /etc/docker/daemon.json
fi
systemctl enable --now docker
systemctl restart docker

say "2/6 Скачиваю Supabase"
[ -d supabase ] || git clone --depth 1 https://github.com/supabase/supabase
mkdir -p project
cp -r supabase/docker/. project/
[ -f project/.env ] || cp supabase/docker/.env.example project/.env
cd project

say "3/6 Генерирую пароли и ключи"
if ! grep -q '^# medvezhiy-configured' .env; then
python3 - "$DOMAIN" "$SITE" <<'PY'
import sys, secrets, hmac, hashlib, base64, json, time, re
dom, site = sys.argv[1], sys.argv[2]
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode()
jwt_secret = secrets.token_hex(32)
def jwt(role):
    now = int(time.time())
    h = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    p = b64(json.dumps({"role": role, "iss": "supabase", "iat": now, "exp": now + 10 * 365 * 86400}).encode())
    s = b64(hmac.new(jwt_secret.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())
    return f"{h}.{p}.{s}"
required = {
    "POSTGRES_PASSWORD": secrets.token_hex(16),
    "JWT_SECRET": jwt_secret,
    "ANON_KEY": jwt("anon"),
    "SERVICE_ROLE_KEY": jwt("service_role"),
    "DASHBOARD_USERNAME": "admin",
    "DASHBOARD_PASSWORD": "mu" + secrets.token_hex(8),
    "SITE_URL": site,
    "ADDITIONAL_REDIRECT_URLS": site,
    "API_EXTERNAL_URL": "https://" + dom,
    "SUPABASE_PUBLIC_URL": "https://" + dom,
    "ENABLE_EMAIL_AUTOCONFIRM": "true",
}
optional = {
    "SECRET_KEY_BASE": secrets.token_hex(32),
    "VAULT_ENC_KEY": secrets.token_hex(16),
    "PG_META_CRYPTO_KEY": secrets.token_hex(16),
    "LOGFLARE_PUBLIC_ACCESS_TOKEN": secrets.token_hex(24),
    "LOGFLARE_PRIVATE_ACCESS_TOKEN": secrets.token_hex(24),
}
env = open('.env').read()
for k, v in {**required, **optional}.items():
    if re.search(rf'^{k}=', env, re.M):
        env = re.sub(rf'^{k}=.*$', lambda m: f'{k}={v}', env, flags=re.M)
    elif k in required:
        env += f'\n{k}={v}'
env += '\n# medvezhiy-configured\n'
open('.env', 'w').write(env)
PY
fi
chmod 600 .env
get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2-; }

say "4/6 Запускаю базу (первый раз скачивание займёт 5–10 минут)"
docker compose pull -q
docker compose up -d
printf 'Жду, пока база проснётся'
for i in $(seq 1 90); do
  docker exec supabase-db pg_isready -U postgres -h localhost >/dev/null 2>&1 && break
  printf '.'; sleep 4
done
echo
sleep 10

if docker exec supabase-db psql -U postgres -d postgres -tAc "select to_regclass('public.properties')" | grep -q properties; then
  echo "Схема уже применена, пропускаю"
else
  curl -fsSL "$REPO_RAW/schema.sql" -o /tmp/medvezhiy-schema.sql
  docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U postgres -d postgres < /tmp/medvezhiy-schema.sql
  echo "Схема базы применена"
fi

say "5/6 Включаю HTTPS для $DOMAIN"
command -v caddy >/dev/null || apt-get install -y caddy
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	reverse_proxy localhost:8000
}
EOF
systemctl enable --now caddy
systemctl restart caddy

say "6/6 Готово"
cat > /root/medvezhiy-keys.txt <<EOF
Адрес сервера (Project URL):  https://$DOMAIN
Ключ anon public:             $(get ANON_KEY)

Панель управления:            https://$DOMAIN
  логин:                      $(get DASHBOARD_USERNAME)
  пароль:                     $(get DASHBOARD_PASSWORD)

Секретные ключи лежат в $DIR/project/.env и НИКОМУ не отправляются:
SERVICE_ROLE_KEY, JWT_SECRET, POSTGRES_PASSWORD.
EOF
chmod 600 /root/medvezhiy-keys.txt
cat /root/medvezhiy-keys.txt
echo
echo "Отправьте в чат только адрес сервера и ключ anon public."
echo "Посмотреть ещё раз: sudo cat /root/medvezhiy-keys.txt"
