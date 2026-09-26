# Builds and launches Sprint Viewer from source, without producing an installer.
# Use this to try the app on a machine that has Node installed.

. (Join-Path $PSScriptRoot 'common.ps1')

$root = Get-ProjectRoot
Assert-Node
Install-Dependencies -Root $root

Push-Location $root
try {
    Write-Host 'Building...' -ForegroundColor Cyan
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'The build failed. The output above says why.' }

    Write-Host 'Starting Sprint Viewer...' -ForegroundColor Green
    & npx electron-vite preview
}
finally { Pop-Location }
