# Output filename
$zipFile = "Video-skipping-and-anime-TV-series-tracking-assistant-v3.0.zip"

# Files to include
$filesToZip = @(
    "manifest.json",
    "background.js",
    "content.js",
    "popup.html",
    "popup.js",
    "icon.png",
    "README.md"
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
    Remove-Item $zipFile
}

# Create zip file
Compress-Archive -Path $filesToZip -DestinationPath $zipFile

Write-Host "Done! File created: $zipFile"
Write-Host "You can upload this file to the Chrome Web Store Dashboard."
