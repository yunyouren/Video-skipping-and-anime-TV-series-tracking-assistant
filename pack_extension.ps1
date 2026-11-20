# Run relative to the script, including when launched from another folder.
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$manifest = Get-Content -Raw -LiteralPath 'manifest.json' | ConvertFrom-Json
$zipFile = Join-Path $PSScriptRoot "Video-skipping-and-anime-TV-series-tracking-assistant-v$($manifest.version).zip"

# Files to include
$filesToZip = @(
    "manifest.json",
    "background.js",
    "tracker-core.js",
    "browser-sync.js",
    "content.js",
    "popup.html",
    "popup.js",
    "options.html",
    "options.js",
    "icon.png",
    "README.md",
    "PRIVACY.md",
    "_locales",
    "releases"
)

# Check if files exist
foreach ($file in $filesToZip) {
    if (-not (Test-Path $file)) {
        Write-Error "File missing: $file"
        exit 1
    }
}

# Remove old zip if exists
if (Test-Path $zipFile) {
    Remove-Item -LiteralPath $zipFile
}

# Create zip file
Compress-Archive -Path $filesToZip -DestinationPath $zipFile

Write-Host "Done! File created: $zipFile"
Write-Host "You can upload this file to the Chrome Web Store Dashboard."
