$ErrorActionPreference = "Stop"

$outputPath = Join-Path $PSScriptRoot "shop-review-data.csv"
$url = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRy-PgUzwkSJEPM7qGAou8yec7HoLZ3N31rTmtyzK6CIl5U0VQqjFh-nD9kfy8MlNGY2LyUSKUdYNYD/pub?gid=0&single=true&output=csv&cacheBust=$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"

Write-Host "Downloading latest shop review CSV..."
$response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 60

if (-not $response.Content -or $response.Content.Trim().Length -eq 0) {
  throw "Google Sheets returned an empty response."
}

Set-Content -LiteralPath $outputPath -Value $response.Content -Encoding UTF8
Write-Host "Updated $outputPath"
