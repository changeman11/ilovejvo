# Copies the bot to the Oracle server and restarts it. Run from the bot folder on your PC:
#   npm run upload -- -Server ubuntu@<server IP> -Key C:\Users\<you>\.ssh\jvo-bot.key
# The server and key are remembered (deploy/upload.local.json, not in git), so next time just:
#   npm run upload
# Your .env, data/ and node_modules are NOT copied; the server keeps its own .env.
param(
  [string]$Server = '',
  [string]$Key = ''
)
$ErrorActionPreference = 'Stop'
$botDir = Split-Path -Parent $PSScriptRoot
$saved = Join-Path $PSScriptRoot 'upload.local.json'

if (Test-Path $saved) {
  $s = Get-Content $saved -Raw | ConvertFrom-Json
  if (-not $Server) { $Server = $s.server }
  if (-not $Key) { $Key = $s.key }
}
if (-not $Server -or -not $Key) {
  Write-Host 'Usage: npm run upload -- -Server ubuntu@<server IP> -Key <path to the .key file>'
  exit 1
}
if (-not (Test-Path $Key)) { Write-Host "Can't find the key file: $Key"; exit 1 }
@{ server = $Server; key = $Key } | ConvertTo-Json | Out-File -Encoding utf8 $saved

$archive = Join-Path $env:TEMP 'jvo-bot.tgz'
Write-Host "Packing $botDir ..."
tar -czf $archive --exclude=node_modules --exclude=.env --exclude=data --exclude='deploy/upload.local.json' -C $botDir .
if ($LASTEXITCODE -ne 0) { throw 'Packing failed' }

Write-Host "Copying to $Server ..."
scp -i $Key $archive "${Server}:jvo-bot.tgz"
if ($LASTEXITCODE -ne 0) { throw 'Copy failed (check the server address and key)' }

Write-Host 'Unpacking and restarting ...'
$remote = 'mkdir -p ~/jvo-bot && tar -xzf ~/jvo-bot.tgz -C ~/jvo-bot && rm ~/jvo-bot.tgz && cd ~/jvo-bot && ' +
  'if command -v npm >/dev/null; then npm ci --omit=dev --no-audit --no-fund --loglevel=error; fi && ' +
  'if systemctl list-unit-files jvo-bot.service | grep -q jvo-bot; then sudo systemctl restart jvo-bot && echo "Bot restarted."; ' +
  'else echo "First time? Now run: ssh into the server, then: bash ~/jvo-bot/deploy/setup-server.sh"; fi'
ssh -i $Key $Server $remote
if ($LASTEXITCODE -ne 0) { throw 'Remote step failed' }
Remove-Item $archive
Write-Host 'Done. Watch the log with:'
Write-Host "  ssh -i `"$Key`" $Server journalctl -u jvo-bot -f"
