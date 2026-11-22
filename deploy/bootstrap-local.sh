#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
umask 077

if ! docker compose version >/dev/null || ! docker info >/dev/null 2>&1; then
  echo "需要 Docker Compose v2 和 Docker 访问权限。可用 sudo 运行此脚本。" >&2
  exit 1
fi

if [[ ! -e production.env ]]; then
  PORT_PASSWORD="$(openssl rand -hex 24)"
  SIGNING_KEY="$(openssl rand -hex 32)"
  printf '%s\n' 'JINGXU_PUBLIC_HOST=localhost' 'JINGXU_HTTP_BIND=127.0.0.1:80' \
    'JINGXU_HTTPS_BIND=127.0.0.1:443' "POSTGRES_PASSWORD=$PORT_PASSWORD" \
    "JINGXU_DOWNLOAD_KEY=$SIGNING_KEY" > production.env
fi
for setting in JINGXU_PUBLIC_HOST=localhost JINGXU_HTTP_BIND=127.0.0.1:80 JINGXU_HTTPS_BIND=127.0.0.1:443; do
  if ! grep -Fxq "$setting" production.env; then
    echo "现有 production.env 不是本机验证配置，已保留原配置。" >&2
    exit 1
  fi
done
if [[ ! -e service.env ]]; then
  printf 'JINGXU_WORKSPACE_CODE=%s\n' "$(openssl rand -hex 18)" > service.env
fi
mkdir -p -m 755 published

export COMPOSE_PARALLEL_LIMIT=1
export JINGXU_PUBLIC_HOST=localhost JINGXU_HTTP_BIND=127.0.0.1:80 JINGXU_HTTPS_BIND=127.0.0.1:443
compose=(docker compose --env-file production.env -f compose.yml)
if [[ -n ${JINGXU_BUILD_CA_FILE:-} ]]; then compose+=(-f build-ca.compose.yml); fi
"${compose[@]}" up -d --build

ca_file="$(mktemp)"
trap 'rm -f "$ca_file"' EXIT
for _ in {1..45}; do
  if "${compose[@]}" exec -T caddy cat /data/caddy/pki/authorities/local/root.crt > "$ca_file" 2>/dev/null &&
    curl --noproxy '*' --resolve localhost:443:127.0.0.1 --max-time 4 --cacert "$ca_file" -fsS \
      https://localhost/api/health; then
    printf '\n镜序已通过服务器本机健康检查。\n'
    "${compose[@]}" ps
    exit 0
  fi
  sleep 2
done
"${compose[@]}" ps
echo "镜序本机健康检查尚未通过。" >&2
exit 1
