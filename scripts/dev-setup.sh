#!/usr/bin/env bash
# =============================================================================
# nearcade — local dev environment bootstrap
#
# 1. Starts the Docker Compose stack: the app itself plus mongo/redis/
#    meilisearch/minio, all on an internal-only Compose network. Only the
#    app's dev server (5173) is published to the host — the app talks to the
#    backing services via their service name (mongo, redis, meilisearch,
#    minio), never via localhost, so there is no way for this to collide with
#    an unrelated service already running on the host (e.g. a native mongod
#    on the standard port) the way host-published ports could.
# 2. Generates a local `.env` from `.env.example` with:
#      - a random SSC_SECRET
#      - a random AUTH_SECRET
#      - OSS_S3_BASE64 derived from the MinIO config
#      - internal service URIs (mongo/redis/meilisearch/minio)
# 3. Restores sanitized seed data into the local MongoDB (optional), run
#    inside the app container since MongoDB isn't reachable from the host.
#
# To inspect data directly from the host (mongosh, RedisInsight, MinIO
# console), uncomment the relevant `ports:` block in docker-compose.yml for
# that one service and re-run `docker compose up -d`.
#
# Usage:
#   ./scripts/dev-setup.sh            # start stack + generate .env
#   ./scripts/dev-setup.sh --seed     # also restore seed data (data/seed/*.json)
#
# Notes:
#   - Existing values in .env are preserved (only placeholders and empty
#     values are filled in).
#   - If .env does not exist, it is created from .env.example.
#   - --seed only restores data already present in data/seed/ (see
#     `pnpm seed:dump`, run separately against a source database).
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env"
EXAMPLE_FILE=".env.example"
SEED_FLAG=""

for arg in "$@"; do
  case "$arg" in
    --seed) SEED_FLAG="1" ;;
    *) echo "ERROR: unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# --- 0. Prerequisites --------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker is required but was not found on PATH." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: 'docker compose' (v2) is required but was not found." >&2
  exit 1
fi

# --- 1. Build .env (before starting the stack, since the app container reads
#        it via env_file on startup) -----------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  if [ ! -f "$EXAMPLE_FILE" ]; then
    echo "ERROR: $EXAMPLE_FILE not found." >&2
    exit 1
  fi
  echo "==> Creating $ENV_FILE from $EXAMPLE_FILE"
  cp "$EXAMPLE_FILE" "$ENV_FILE"
else
  echo "==> $ENV_FILE exists; filling in missing/placeholder values only"
fi

# Generate random secrets (hex strings).
SSC_SECRET_GEN="$(openssl rand -hex 24 2>/dev/null || node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
AUTH_SECRET_GEN="$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

# MinIO credentials — read from the environment with the same defaults as
# docker-compose.yml so OSS_S3_BASE64 always matches the running MinIO.
MINIO_ROOT_USER="${MINIO_ROOT_USER:-minioadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-minioadmin}"

# OSS_S3_BASE64: base64 of the JSON blob consumed by src/lib/oss/s3.ts. Uses
# the internal service name (minio) since the app reaches it over the Compose
# network, not via a host-published port.
OSS_JSON="{\"endpoint\":\"http://minio:9000\",\"region\":\"us-east-1\",\"bucket\":\"nearcade\",\"accessKeyId\":\"${MINIO_ROOT_USER}\",\"secretAccessKey\":\"${MINIO_ROOT_PASSWORD}\",\"bucketEndpoint\":false,\"forcePathStyle\":true}"
OSS_S3_BASE64_GEN="$(printf '%s' "$OSS_JSON" | base64 | tr -d '\n')"

# sed -i differs between GNU (Linux) and BSD (macOS) sed: BSD requires an
# explicit (possibly empty) backup-suffix argument after -i, and consumes the
# following token as that argument — so `sed -i -E '...'` silently misparses
# on macOS (treats -E as the suffix, runs in BRE mode, backup file `-E`).
sed_inplace() {
  if sed --version >/dev/null 2>&1; then
    sed -i -E "$1" "$2"
  else
    sed -i '' -E "$1" "$2"
  fi
}

# set_env KEY VALUE — set KEY to VALUE if the key is missing or a placeholder.
set_env() {
  local key="$1"
  local value="$2"
  if grep -qE "^[# ]*${key}[[:space:]]*=" "$ENV_FILE"; then
    # Extract current value (strip quotes and inline comments).
    local current
    current="$(grep -E "^[# ]*${key}[[:space:]]*=" "$ENV_FILE" | head -1 | sed -E 's/^[# ]*[^=]+=[[:space:]]*"?([^"]*)"?.*/\1/')"
    if [ -z "$current" ] || [ "$current" = "change-me" ]; then
      if grep -qE "^#?[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE"; then
        sed_inplace "s|^#?[[:space:]]*${key}[[:space:]]*=.*|${key} = \"${value}\"|" "$ENV_FILE"
      else
        echo "${key} = \"${value}\"" >> "$ENV_FILE"
      fi
      echo "    ${key} = <generated>"
    fi
  else
    echo "${key} = \"${value}\"" >> "$ENV_FILE"
    echo "    ${key} = <generated>"
  fi
}

echo "==> Filling in generated values in $ENV_FILE"
set_env "SSC_SECRET" "$SSC_SECRET_GEN"
set_env "AUTH_SECRET" "$AUTH_SECRET_GEN"
set_env "OSS_S3_BASE64" "$OSS_S3_BASE64_GEN"

# Internal service URIs (only set if missing — preserves any custom values).
# These use Compose service names, not localhost: the app only ever reaches
# these over the internal Compose network.
set_env "MONGODB_URI" "mongodb://mongo:27017/?dbName=nearcade"
set_env "REDIS_URI" "redis://redis:6379"
set_env "MEILISEARCH_HOST" "http://meilisearch:7700"
set_env "MEILISEARCH_API_KEY" "dev-master-key"
set_env "ALLOWED_ORIGINS" "http://localhost:5173"

# --- 2. Start the stack ------------------------------------------------------
echo "==> Starting Docker Compose stack (app, mongo, redis, meilisearch, minio)..."
docker compose up -d --build --wait

echo
echo "==> Done. The app is running at:"
echo "    http://localhost:5173"
echo
echo "    Backing services (mongo/redis/meilisearch/minio) are internal-only;"
echo "    see docker-compose.yml to uncomment ports for host-side inspection."
if [ -z "$SEED_FLAG" ]; then
  echo
  echo "    Tip: restore sample data with:  pnpm seed:restore"
  echo "    (this must run inside the app container: docker compose exec app pnpm seed:restore)"
fi

# --- 3. Seed restore (optional) ----------------------------------------------
if [ -n "$SEED_FLAG" ]; then
  echo
  echo "==> Restoring seed data..."
  docker compose exec -T app pnpm seed:restore
fi
