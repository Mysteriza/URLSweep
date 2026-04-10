# build.ps1
# Script to package the URLSweep extension into a clean ZIP file for GitHub Releases
# Automatically increments the patch version in manifest.json

$ExtensionName = "URLSweep"
$SourceDir = $PSScriptRoot
$OutputDir = Join-Path $PSScriptRoot "dist"
$ZipFile = Join-Path $OutputDir "$ExtensionName.zip"
$ManifestPath = Join-Path $SourceDir "manifest.json"

Write-Host "Building $ExtensionName..."

# Auto-increment version in manifest.json
if (Test-Path $ManifestPath) {
    $ManifestContent = Get-Content $ManifestPath -Raw
    $VersionMatch = [regex]::Match($ManifestContent, '"version"\s*:\s*"(\d+)\.(\d+)\.(\d+)"')
    
    if ($VersionMatch.Success) {
        $Major = [int]$VersionMatch.Groups[1].Value
        $Minor = [int]$VersionMatch.Groups[2].Value
        $Patch = [int]$VersionMatch.Groups[3].Value
        
        $NewPatch = $Patch + 1
        $NewVersion = "$Major.$Minor.$NewPatch"
        
        $ManifestContent = $ManifestContent -replace '"version"\s*:\s*"\d+\.\d+\.\d+"', "`"version`": `"$NewVersion`""
        $ManifestContent | Out-File $ManifestPath -Encoding UTF8 -NoNewline
        
        Write-Host "Version bumped: $Major.$Minor.$Patch -> $NewVersion" -ForegroundColor Cyan
    }
    else {
        Write-Host "Warning: Could not parse version from manifest.json" -ForegroundColor Yellow
    }
}

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
