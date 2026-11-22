#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
umask 077

domain="${1:-}"
ip="${2:-}"
if [[ ! "$domain" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ||
      ! "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ || ! -f production.env ]]; then
  echo '用法: sudo bash deploy/enable-domain.sh 网站域名 服务器公网IPv4' >&2
  exit 1
fi

resolved="$(timeout 10 getent ahostsv4 "$domain" | awk '{print $1}' | sort -u || true)"
if [[ "$resolved" != "$ip" ]]; then
  echo "DNS 尚未稳定指向 $ip，服务器配置未修改。" >&2
  printf '服务器查到的 IPv4：%s\n' "${resolved:-无}" >&2
  exit 1
fi

previous="$(mktemp)"
candidate="$(mktemp .production-env.XXXXXX)"
trap 'rm -f "$previous" "$candidate"' EXIT
cp -p production.env "$previous"
awk -v host="$domain" '
  /^JINGXU_PUBLIC_HOST=/ { next }
  /^JINGXU_HTTP_BIND=/ { next }
  /^JINGXU_HTTPS_BIND=/ { next }
  { print }
  END { print "JINGXU_PUBLIC_HOST=" host }
' production.env > "$candidate"

compose=(docker compose --env-file production.env -f compose.yml)
# The env file is authoritative for the launch domain and port bindings.
unset JINGXU_PUBLIC_HOST JINGXU_HTTP_BIND JINGXU_HTTPS_BIND
mv "$candidate" production.env
if ! "${compose[@]}" up -d --no-build; then
  cp -p "$previous" production.env
  "${compose[@]}" up -d --no-build || true
  echo '公网配置启动失败，已恢复上一份配置。' >&2
  exit 1
fi

for _ in {1..12}; do
  if curl --noproxy '*' --resolve "$domain:443:127.0.0.1" --max-time 4 -fsS "https://$domain/api/health" 2>/dev/null; then
    printf '\nHTTPS 健康检查通过：https://%s\n' "$domain"
    exit 0
  fi
  sleep 5
done
echo "公网配置已启用，HTTPS 健康检查尚未通过，请查看 Caddy 日志。" >&2
"${compose[@]}" logs --tail=15 caddy
exit 1
