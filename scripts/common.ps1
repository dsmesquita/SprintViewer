# Shared checks for the helper scripts. Dot-sourced, not run directly.

$ErrorActionPreference = 'Stop'

function Get-ProjectRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}

function Assert-Node {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) {
        Write-Host ''
        Write-Host 'Node.js is not installed on this machine.' -ForegroundColor Red
        Write-Host 'Install the LTS build from https://nodejs.org and run this script again.'
        Write-Host 'Only the person building needs it — the finished installer does not.'
        Write-Host ''
        exit 1
    }

    $version = (& node -v).TrimStart('v')
    $major = [int]($version.Split('.')[0])
    if ($major -lt 18) {
        Write-Host "Node $version is too old; this project needs 18 or newer." -ForegroundColor Red
        exit 1
    }
    Write-Host "Node $version" -ForegroundColor DarkGray
}

function Install-Dependencies {
    param([string]$Root)

    if (Test-Path (Join-Path $Root 'node_modules')) {
        Write-Host 'Dependencies already installed.' -ForegroundColor DarkGray
        return
    }

    Write-Host 'Installing dependencies (a few minutes the first time)...' -ForegroundColor Cyan
    Push-Location $Root
    try {
        # `npm ci` needs the lockfile; fall back to `npm install` if it is missing.
        if (Test-Path (Join-Path $Root 'package-lock.json')) { & npm ci --no-audit --no-fund }
        else { & npm install --no-audit --no-fund }
        if ($LASTEXITCODE -ne 0) { throw 'npm failed to install the dependencies.' }
    }
    finally { Pop-Location }
}
