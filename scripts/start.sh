#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

if [[ ${1:-} == --live ]]; then
  python -m api.config
fi

api_port="${JINGXU_API_PORT:-8000}"
web_port="${JINGXU_WEB_PORT:-3000}"
export API_ORIGIN="http://127.0.0.1:$api_port"
export NEXT_TELEMETRY_DISABLED=1
pids=()
cleanup() {
  if (( ${#pids[@]} )); then
    kill "${pids[@]}" 2>/dev/null || true
    wait "${pids[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

npm --prefix web run build
python -m uvicorn api.main:app --host 127.0.0.1 --port "$api_port" &
api_pid=$!
pids+=("$api_pid")
ready=0
for _ in {1..40}; do
  if curl -fsS --max-time 1 "$API_ORIGIN/openapi.json" >/dev/null 2>&1; then
    ready=1
    break
  fi
  kill -0 "$api_pid" 2>/dev/null || break
  sleep .25
done
if (( ! ready )); then
  echo "镜序 API 启动失败" >&2
  exit 1
fi

python -m api.worker &
pids+=("$!")
node web/node_modules/next/dist/bin/next start web --hostname 0.0.0.0 --port "$web_port" &
pids+=("$!")
printf "镜序官网  http://localhost:%s/\n镜序工作台  http://localhost:%s/workbench\n" "$web_port" "$web_port"
wait -n "${pids[@]}"
