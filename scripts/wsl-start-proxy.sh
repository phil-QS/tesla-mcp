#!/usr/bin/env bash
# Start tesla-http-proxy in WSL (bind 0.0.0.0:4443 for Windows localhost access).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# When invoked from Windows path via wsl
if [[ "$ROOT" == *"\\"* ]] || [[ -d "/mnt/c/wqs/03_work/qiniu/mcp_market/tesla-mcp" ]]; then
  ROOT="/mnt/c/wqs/03_work/qiniu/mcp_market/tesla-mcp"
fi

export PATH="$HOME/.local/go/bin:$HOME/go/bin:$PATH"
PROXY_BIN="$HOME/go/bin/tesla-http-proxy"

if [[ ! -x "$PROXY_BIN" ]]; then
  echo "tesla-http-proxy not found. Run: npm run command-proxy:wsl-install"
  exit 1
fi

TLS_KEY="$ROOT/config/tls-key.pem"
TLS_CERT="$ROOT/config/tls-cert.pem"
FLEET_KEY="$ROOT/keys/private-key.pem"

for f in "$TLS_CERT" "$TLS_KEY" "$FLEET_KEY"; do
  if [[ ! -f "$f" ]]; then
    echo "Missing: $f"
    exit 1
  fi
done

echo "Starting tesla-http-proxy on https://0.0.0.0:4443"
echo "Windows: https://127.0.0.1:4443  |  Fleet key: $FLEET_KEY"
exec "$PROXY_BIN" \
  -tls-key "$TLS_KEY" \
  -cert "$TLS_CERT" \
  -key-file "$FLEET_KEY" \
  -host 0.0.0.0 \
  -port 4443 \
  -verbose
