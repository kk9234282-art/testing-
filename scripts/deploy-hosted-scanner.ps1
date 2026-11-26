# Run in the existing linked backend directory. No environment variables are edited.
$ErrorActionPreference = 'Stop'
$ProjectLink = Join-Path (Get-Location).Path '.vercel\project.json'
if (-not (Test-Path -LiteralPath $ProjectLink)) {
    throw 'Open your existing linked backend folder first.'
}
$Link = Get-Content -LiteralPath $ProjectLink -Raw | ConvertFrom-Json
if (-not $Link.projectId -or -not $Link.orgId) {
    throw 'The existing Vercel project link is incomplete.'
}
if ($Link.projectName -and $Link.projectName -ne 'stock-scanner-backend') {
    throw "This folder links to '$($Link.projectName)', not stock-scanner-backend."
}
if ($env:VERCEL_PROJECT_ID -and $env:VERCEL_PROJECT_ID -ne $Link.projectId) {
    throw 'VERCEL_PROJECT_ID conflicts with the existing link.'
}
if ($env:VERCEL_ORG_ID -and $env:VERCEL_ORG_ID -ne $Link.orgId) {
    throw 'VERCEL_ORG_ID conflicts with the existing link.'
}

$Work = Join-Path $env:TEMP ('scanner-config-fix-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $Work | Out-Null
Invoke-WebRequest `
    -Uri 'https://github.com/kk9234282-art/testing-/archive/refs/heads/main.zip' `
    -OutFile "$Work\source.zip"
Expand-Archive -LiteralPath "$Work\source.zip" -DestinationPath "$Work\source"
$Repo = (Get-ChildItem "$Work\source" -Directory | Select-Object -First 1).FullName

Push-Location $Repo
try {
    node .\scripts\prepare-hosted-scanner.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Bundle generation failed.' }
} finally {
    Pop-Location
}

# Stage OUTSIDE the website checkout to prevent repository config discovery.
$Generated = Join-Path $Repo '.scanner-private\hosted-release'
$Release = Join-Path $Work 'backend'
if (Test-Path -LiteralPath $Release) { throw 'Expected a fresh backend staging directory.' }
Copy-Item -LiteralPath $Generated -Destination $Release -Recurse -Force
New-Item -ItemType Directory -Path "$Release\.vercel" | Out-Null
Copy-Item -LiteralPath $ProjectLink -Destination "$Release\.vercel\project.json"
$ConfigPath = Join-Path $Release 'vercel.json'

# Vercel MUST start with the backend as its real working directory.
Push-Location $Release
try {
    node "$Repo\scripts\check-hosted-config.mjs" "$Release"
    if ($LASTEXITCODE -ne 0) { throw 'Backend configuration validation failed.' }

    py -3.12 -m venv "$Release\.venv"
    if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
    $Python = Join-Path $Release '.venv\Scripts\python.exe'
    & $Python -m pip install -r "$Release\requirements.txt"
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    & $Python -I -B "$Release\verify_bundle.py"
    if ($LASTEXITCODE -ne 0) { throw 'Generated bundle verification failed.' }

    # Recheck after testing; .venv stays local and remains excluded.
    node "$Repo\scripts\check-hosted-config.mjs" "$Release"
    if ($LASTEXITCODE -ne 0) { throw 'Final configuration validation failed.' }
    if (-not (Test-Path -LiteralPath $Python)) { throw 'Local verification environment is missing.' }
    # Do not compare Windows short/long path strings; cwd and config are explicit below.

    Write-Host "Existing project ID: $($Link.projectId)"
    Write-Host "Backend config: $ConfigPath"
    npx.cmd vercel --prod --cwd "$Release" --local-config "$ConfigPath"
    if ($LASTEXITCODE -ne 0) { throw 'Vercel deployment failed.' }
} finally {
    Pop-Location
}
