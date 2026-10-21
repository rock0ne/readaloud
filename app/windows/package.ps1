<#
  Makes the Windows download (ADR-29): release\ReadAloud-windows-<version>.zip with the built
  app, ReadAloud.cmd, serve.ps1, README.txt and the licences. Run "pnpm build" first, without
  --base: this copy is served from http://127.0.0.1:4173/.
#>
param(
  [string]$Dist = (Join-Path $PSScriptRoot '..\dist'),
  [string]$Out = (Join-Path $PSScriptRoot '..\release')
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$index = Join-Path $Dist 'index.html'
if (-not (Test-Path -LiteralPath $index)) { throw "There is no build in $Dist. Run pnpm build first." }
# A GitHub Pages build (--base /<repo>/) would not load from the root of 127.0.0.1:4173.
if ((Get-Content -LiteralPath $index -Raw) -notmatch 'src="/assets/') {
  throw "$Dist was built for another address (--base). Run pnpm build without --base first."
}

$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json).version
$name = "ReadAloud-windows-$version"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path -LiteralPath $Out).Path
$stage = Join-Path $Out $name
$zip = "$stage.zip"
foreach ($old in @($stage, $zip)) {
  if (Test-Path -LiteralPath $old) { Remove-Item -LiteralPath $old -Recurse -Force }
}

New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item -LiteralPath $Dist -Destination (Join-Path $stage 'app') -Recurse
foreach ($file in @('ReadAloud.cmd', 'serve.ps1', 'README.txt')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $stage
}
Copy-Item -LiteralPath (Join-Path $repo 'LICENSE') -Destination (Join-Path $stage 'LICENSE.txt')
Copy-Item -LiteralPath (Join-Path $repo 'THIRD-PARTY-NOTICES.md') -Destination (Join-Path $stage 'THIRD-PARTY-NOTICES.txt')

Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip, [IO.Compression.CompressionLevel]::Optimal, $true)
Remove-Item -LiteralPath $stage -Recurse -Force

$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$size = [math]::Round((Get-Item -LiteralPath $zip).Length / 1MB, 1)
Write-Host "$zip ($size MB)"
Write-Host "SHA-256 $hash"
