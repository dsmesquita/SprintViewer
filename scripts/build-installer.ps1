# Produces the Windows installer in release\.
#
# Works around a long-standing electron-builder problem on Windows: its code-signing
# toolchain archive contains macOS symlinks, and creating symlinks needs either Developer
# Mode or an elevated prompt. The extraction fails, the build stops, and the error names a
# .dylib, which is a confusing thing to read on Windows. If that happens we re-extract the
# archive ourselves — writing those entries as ordinary files, which Windows allows — and
# build again.

. (Join-Path $PSScriptRoot 'common.ps1')

$root = Get-ProjectRoot
Assert-Node
Install-Dependencies -Root $root

$cacheRoot = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'
# The directory electron-builder looks for. Bump this if a future version of the tool starts
# asking for a different one — the build log names the archive it is trying to extract.
$cacheDir = Join-Path $cacheRoot 'winCodeSign-2.6.0'

function Invoke-Builder {
    Push-Location $root
    try {
        # Out-Host, not a bare call: a PowerShell function returns everything written to the
        # output stream, so without this the build log would be captured as the return value
        # and the exit code would arrive as the last element of an array.
        & npm run dist | Out-Host
        return $LASTEXITCODE
    }
    finally { Pop-Location }
}

function Repair-SignToolCache {
    if (Test-Path $cacheDir) { return $false }

    $archive = Get-ChildItem -Path $cacheRoot -Filter '*.7z' -ErrorAction SilentlyContinue |
        Sort-Object Length -Descending | Select-Object -First 1
    if (-not $archive) { return $false }

    $sevenZip = Join-Path $root 'node_modules\7zip-bin\win\x64\7za.exe'
    if (-not (Test-Path $sevenZip)) { return $false }

    Write-Host 'Repairing the electron-builder signing cache...' -ForegroundColor Yellow
    # Without -snld, 7-Zip writes symlink entries as regular files instead of failing.
    & $sevenZip x -bd -y "-o$cacheDir" $archive.FullName | Out-Null

    # Leftover per-attempt temp directories, so the retry starts from a clean cache.
    Get-ChildItem -Path $cacheRoot -Directory |
        Where-Object { $_.Name -match '^\d+$' } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

    return (Test-Path (Join-Path $cacheDir 'windows-10'))
}

$code = Invoke-Builder
if ($code -ne 0) {
    if (Repair-SignToolCache) {
        Write-Host 'Cache repaired — building again.' -ForegroundColor Yellow
        $code = Invoke-Builder
    }
}

if ($code -ne 0) {
    Write-Host ''
    Write-Host 'The installer could not be built. The output above says why.' -ForegroundColor Red
    exit $code
}

$installer = Get-ChildItem -Path (Join-Path $root 'release') -Filter '*Setup*.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1

Write-Host ''
if ($installer) {
    $mb = [math]::Round($installer.Length / 1MB, 1)
    Write-Host "Installer ready: $($installer.FullName) ($mb MB)" -ForegroundColor Green
    Write-Host 'It installs per user, so it needs no administrator rights.'
    Write-Host 'It is unsigned, so Windows SmartScreen will ask for a confirmation on first run.'
}
else {
    Write-Host 'Build reported success but no installer was found in release\.' -ForegroundColor Yellow
}
