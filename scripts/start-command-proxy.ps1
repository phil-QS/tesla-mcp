# Start Tesla Vehicle Command HTTP Proxy
# Run: npm run command-proxy  (WSL on Windows)  |  npm run command-proxy:wsl

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Test-Path "config\tls-cert.pem")) {
    & "$Root\scripts\setup-command-proxy.ps1"
}

$wsl = Get-Command wsl -ErrorAction SilentlyContinue
if ($wsl) {
    $proxyBin = wsl bash -lc "test -x ~/go/bin/tesla-http-proxy && echo yes" 2>$null
    if ($proxyBin -match "yes") {
        Write-Host "Starting tesla-http-proxy in WSL (keep this window open)..."
        wsl -d Ubuntu-24.04 bash -lc "sed -i 's/\r$//' /mnt/c/wqs/03_work/qiniu/mcp_market/tesla-mcp/scripts/wsl-start-proxy.sh 2>/dev/null; exec bash /mnt/c/wqs/03_work/qiniu/mcp_market/tesla-mcp/scripts/wsl-start-proxy.sh"
        exit $LASTEXITCODE
    }
    Write-Host "WSL found but proxy not built. Run: npm run command-proxy:wsl-install"
}

$tlsKey = Join-Path $Root "config\tls-key.pem"
$tlsCert = Join-Path $Root "config\tls-cert.pem"
$fleetKey = Join-Path $Root "keys\private-key.pem"
$proxyArgs = @("-tls-key", $tlsKey, "-cert", $tlsCert, "-key-file", $fleetKey, "-host", "127.0.0.1", "-port", "4443", "-verbose")

$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
    docker compose -f docker-compose.command-proxy.yml up
    exit $LASTEXITCODE
}

Write-Host "ERROR: Run npm run command-proxy:wsl-install first, then npm run command-proxy" -ForegroundColor Red
exit 1
