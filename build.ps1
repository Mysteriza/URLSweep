# build.ps1
# Script to package the URLSweep extension into a clean ZIP file for GitHub Releases

$ExtensionName = "URLSweep"
$SourceDir = $PSScriptRoot
$OutputDir = Join-Path $PSScriptRoot "dist"
$ZipFile = Join-Path $OutputDir "$ExtensionName.zip"

Write-Host "Building $ExtensionName..."

# Create dist directory if it doesn't exist
if (-not (Test-Path $OutputDir)) {
    New-Item -ItemType Directory $OutputDir | Out-Null
}

# Remove old zip if exists
if (Test-Path $ZipFile) {
    Remove-Item $ZipFile -Force
}

# Items to include in the release zip
$Includes = @(
    "icons",
    "options",
    "popup",
    "background.js",
    "content.js",
    "manifest.json",
    "README.md"
)

# Create a temporary directory to gather files
$TempDir = Join-Path $OutputDir "temp_build"
if (Test-Path $TempDir) {
    Remove-Item $TempDir -Recurse -Force
}
New-Item -ItemType Directory $TempDir | Out-Null

Write-Host "Copying files..."
foreach ($item in $Includes) {
    $itemPath = Join-Path $SourceDir $item
    if (Test-Path $itemPath) {
        Copy-Item -Path $itemPath -Destination $TempDir -Recurse -Force
    }
}

Write-Host "Compressing to ZIP..."
Compress-Archive -Path "$TempDir\*" -DestinationPath $ZipFile -Force

# Cleanup temp folder
Remove-Item $TempDir -Recurse -Force

Write-Host "Build complete! The release file is ready at: $ZipFile" -ForegroundColor Green
