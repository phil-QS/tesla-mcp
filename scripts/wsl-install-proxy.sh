#!/usr/bin/env bash
# Install Go (user-local) + tesla-http-proxy in WSL. No sudo required.
set -euo pipefail

GO_VERSION="${GO_VERSION:-1.23.4}"
GO_TAR="go${GO_VERSION}.linux-amd64.tar.gz"
GO_DIR="$HOME/.local/go"
GO_BIN="$GO_DIR/bin/go"
PROXY_BIN="$HOME/go/bin/tesla-http-proxy"

if [[ ! -x "$GO_BIN" ]]; then
  echo "Installing Go ${GO_VERSION} to ${GO_DIR}..."
  mkdir -p "$HOME/.local"
  tmp=$(mktemp -d)
  cd "$tmp"
  curl -fsSL "https://go.dev/dl/${GO_TAR}" -o "$GO_TAR"
  rm -rf "$GO_DIR"
  tar -C "$HOME/.local" -xzf "$GO_TAR"
  cd "$HOME"
  rm -rf "$tmp"
fi

export PATH="$GO_DIR/bin:$HOME/go/bin:$PATH"
cd "$HOME"

if [[ ! -x "$PROXY_BIN" ]]; then
  echo "Building tesla-http-proxy from source..."
  build_dir="$HOME/.local/src/vehicle-command"
  if [[ ! -d "$build_dir/.git" ]]; then
    rm -rf "$build_dir"
    git clone --depth 1 --branch v0.4.1 https://github.com/teslamotors/vehicle-command.git "$build_dir"
  fi
  cd "$build_dir"
  go build -o "$PROXY_BIN" ./cmd/tesla-http-proxy
  cd "$HOME"
fi

echo "OK: $PROXY_BIN"
"$PROXY_BIN" -h 2>&1 | head -3 || true
