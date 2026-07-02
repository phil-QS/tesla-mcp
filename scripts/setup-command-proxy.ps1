# Setup Tesla Vehicle Command HTTP Proxy (TLS certs)
# Run: npm run command-proxy:setup

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
node scripts/generate-proxy-tls.mjs
