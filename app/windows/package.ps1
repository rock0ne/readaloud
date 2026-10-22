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

# Entry names use "/", the zip format's separator (Windows PowerShell 5.1's CreateFromDirectory
# writes "\", which other unzip tools take as part of the file name), in a fixed order with one
# fixed date, so the same files always make the same zip.
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$base = (Get-Item -LiteralPath $stage).FullName
$files = @(Get-ChildItem -LiteralPath $base -Recurse -File)
$names = [string[]]@($files | ForEach-Object { "$name/" + $_.FullName.Substring($base.Length + 1).Replace('\', '/') })
$paths = [string[]]@($files | ForEach-Object { $_.FullName })
[Array]::Sort($names, $paths, [StringComparer]::Ordinal)
$stamp = New-Object DateTimeOffset 2026, 1, 1, 0, 0, 0, ([TimeSpan]::Zero)
$stream = [IO.File]::Open($zip, [IO.FileMode]::CreateNew)
try {
  $archive = New-Object IO.Compression.ZipArchive $stream, ([IO.Compression.ZipArchiveMode]::Create)
  try {
    for ($i = 0; $i -lt $names.Length; $i++) {
      $entry = $archive.CreateEntry($names[$i], [IO.Compression.CompressionLevel]::Optimal)
      $entry.LastWriteTime = $stamp
      $to = $entry.Open()
      try {
        $from = [IO.File]::OpenRead($paths[$i])
        try { $from.CopyTo($to) } finally { $from.Dispose() }
      } finally { $to.Dispose() }
    }
  } finally { $archive.Dispose() }
} finally { $stream.Dispose() }
Remove-Item -LiteralPath $stage -Recurse -Force

# Check what was written: every entry under the one folder, with "/" only.
$check = [IO.Compression.ZipFile]::OpenRead($zip)
try {
  $bad = @($check.Entries | Where-Object { $_.FullName.Contains('\') -or -not $_.FullName.StartsWith("$name/") })
  if ($bad.Count -or $check.Entries.Count -ne $names.Length) { throw "The zip's entry names are wrong: $($bad[0].FullName)" }
} finally { $check.Dispose() }

$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
$size = [math]::Round((Get-Item -LiteralPath $zip).Length / 1MB, 1)
Write-Host "$zip ($size MB)"
Write-Host "SHA-256 $hash"
