$ErrorActionPreference = "Stop"
Write-Host "Installing dependencies and bundled Chromium..."
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PWD "playwright-browsers"
npm install
npx playwright install chromium
Write-Host "Building Windows installer..."
npm run dist:win
Write-Host "DONE. Installer is in .\\dist\\"
