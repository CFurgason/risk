$ErrorActionPreference = "Stop"

$port = 8765
$url = "http://localhost:$port/index.html"

Set-Location -LiteralPath $PSScriptRoot
Start-Process $url

if (Get-Command py -ErrorAction SilentlyContinue) {
  py -m http.server $port
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
  python -m http.server $port
} else {
  throw "Python is required to serve the dashboard locally. Install Python or host this folder with another local web server."
}
