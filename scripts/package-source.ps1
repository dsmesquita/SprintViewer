# Zips the project for sending to another machine, without the parts that do not travel:
# node_modules (reinstalled there), and the build outputs.
#
# Nothing personal is included — settings and sprints live in %APPDATA%\SprintViewer, not
# in the project, so an encrypted token cannot leak out through this zip.

. (Join-Path $PSScriptRoot 'common.ps1')

$root = Get-ProjectRoot
$stamp = Get-Date -Format 'yyyy-MM-dd'
$destination = Join-Path ([Environment]::GetFolderPath('Desktop')) "SprintViewer-source-$stamp.zip"

$staging = Join-Path $env:TEMP ("sprintviewer-package-" + [guid]::NewGuid().ToString('N'))
$exclude = @('node_modules', 'out', 'release', '.git', 'dist')
$excludePattern = '\.tsbuildinfo$'

Write-Host 'Collecting files...' -ForegroundColor Cyan
New-Item -ItemType Directory -Path $staging -Force | Out-Null
try {
    Get-ChildItem -Path $root -Force |
        Where-Object { $exclude -notcontains $_.Name -and $_.Name -notmatch $excludePattern } |
        ForEach-Object { Copy-Item $_.FullName -Destination $staging -Recurse -Force }

    if (Test-Path $destination) { Remove-Item $destination -Force }
    Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $destination -CompressionLevel Optimal

    $mb = [math]::Round((Get-Item $destination).Length / 1MB, 1)
    Write-Host ''
    Write-Host "Wrote $destination ($mb MB)" -ForegroundColor Green
    Write-Host 'On the other machine: unzip it, then run scripts\run.cmd or scripts\build-installer.cmd.'
}
finally {
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}
