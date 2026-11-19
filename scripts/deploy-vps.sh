#!/usr/bin/env bash
set -euo pipefail

# Runs on the VPS (invoked by .github/workflows/deploy.yml over SSH) after the
# checkout has been fast-forwarded. Rebuilds the standalone artifact, applies
# PostgreSQL migrations, reloads PM2 and waits for /api/ready.
#
# PREVIOUS_COMMIT: commit that was live before the pull; dependencies are
# reinstalled only when package-lock.json changed since then.

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

pm2_app="${PM2_APP:-ibex-web-app}"
node_version="${DEPLOY_NODE_VERSION:-22}"

exec 9>"${root_dir}/.deploy.lock"
if ! flock -n 9; then
  echo "Another deployment is already running." >&2
  exit 75
fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm use --silent "$node_version"
echo "[deploy] node $(node -v), npm $(npm -v)"

if [[ ! -f .env.vps ]]; then
  echo "[deploy] .env.vps is missing; refusing to deploy." >&2
  exit 78
fi

current_commit="$(git rev-parse HEAD)"
previous_commit="${PREVIOUS_COMMIT:-$current_commit}"
echo "[deploy] ${previous_commit:0:7} -> ${current_commit:0:7}"

if [[ ! -d node_modules ]] || ! git diff --quiet "$previous_commit" "$current_commit" -- package-lock.json; then
  echo "[deploy] installing dependencies"
  npm ci
fi

echo "[deploy] building VPS artifact"
npm run build:vps

echo "[deploy] applying PostgreSQL migrations"
node --env-file=.env.vps scripts/migrate-postgres.mjs

echo "[deploy] reloading ${pm2_app}"
if [[ -f ecosystem.config.cjs ]]; then
  pm2 startOrReload ecosystem.config.cjs --only "$pm2_app" --update-env
else
  pm2 reload "$pm2_app" --update-env
fi
pm2 save >/dev/null

port="$(grep -E '^PORT=' .env.vps | tail -n1 | cut -d= -f2)"
port="${port:-3000}"
for attempt in $(seq 1 30); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${port}/api/ready"; then
    echo "[deploy] ready after ${attempt} check(s): ${current_commit:0:7} is live"
    exit 0
  fi
  sleep 2
done

echo "[deploy] /api/ready did not respond on port ${port}" >&2
pm2 logs "$pm2_app" --lines 50 --nostream >&2 || true
exit 1
