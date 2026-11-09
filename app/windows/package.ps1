<#
  Makes the Windows download (ADR-29): release\ReadAloud-windows-<version>.zip with the built
  app, ReadAloud.cmd, serve.ps1, README.txt and the licences. Run "pnpm build" first, without
  --base: this copy is served from http://127.0.0.1:4173/.
#>
param(
  [string]$Dist = (Join-Path $PSScriptRoot '..\dist'),
  [string]$VoicePack = (Join-Path $PSScriptRoot '..\voice-pack'),
  [string]$Out = (Join-Path $PSScriptRoot '..\release'),
  [ValidateSet('PrivateFull', 'PublicWav')][string]$Edition = 'PrivateFull'
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
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Unsafe package version.' }
$buildInfo = Get-Content -LiteralPath (Join-Path $Dist 'build-info.json') -Raw | ConvertFrom-Json
$expectedEdition = if ($Edition -eq 'PublicWav') { 'public-wav' } else { 'private-full' }
if ($buildInfo.version -ne $version -or $buildInfo.edition -ne $expectedEdition -or
    ($Edition -eq 'PublicWav' -and $buildInfo.compressedExports -ne $false)) {
  throw 'Build version/edition does not match the requested package. Rebuild the correct edition.'
}
$name = "ReadAloud-windows-$version" + $(if ($Edition -eq 'PublicWav') { '-public-wav' } else { '' })
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$Out = (Resolve-Path -LiteralPath $Out).Path
$stage = Join-Path $Out $name
$zip = "$stage.zip"
foreach ($old in @($stage, $zip)) {
  if (Test-Path -LiteralPath $old) { throw "Refusing to overwrite an existing package/stage: $old. Choose a fresh output folder." }
}

New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item -LiteralPath $Dist -Destination (Join-Path $stage 'app') -Recurse
if (-not (Test-Path -LiteralPath (Join-Path $VoicePack 'manifest.json'))) {
  throw 'Offline Windows package needs the voice pack. Run node windows/stage-voices.mjs first.'
}
$voiceRoot = (Resolve-Path -LiteralPath $VoicePack).Path.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar
$voiceManifest = Get-Content -LiteralPath (Join-Path $VoicePack 'manifest.json') -Raw | ConvertFrom-Json
foreach ($entry in $voiceManifest.files) {
  $asset = [IO.Path]::GetFullPath((Join-Path $voiceRoot $entry.file))
  if (-not $asset.StartsWith($voiceRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Voice asset is outside the pack.' }
  if ((Get-Item -LiteralPath $asset).Length -ne $entry.bytes -or
      (Get-FileHash -LiteralPath $asset -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256) {
    throw "Voice asset verification failed: $($entry.file)"
  }
}
if (-not (Test-Path -LiteralPath (Join-Path $stage 'app\voice-pack\manifest.json'))) {
  Copy-Item -LiteralPath $VoicePack -Destination (Join-Path $stage 'app\voice-pack') -Recurse
}
foreach ($file in @('ReadAloud.cmd', 'serve.ps1', 'README.txt')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot $file) -Destination $stage
}
if ($Edition -eq 'PublicWav') {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'PUBLIC-README.txt') -Destination (Join-Path $stage 'README.txt')
}
Copy-Item -LiteralPath (Join-Path $repo 'README.md') -Destination (Join-Path $stage 'USER-GUIDE.md')
Set-Content -LiteralPath (Join-Path $stage 'VERSION.txt') -Value "ReadAloud $version - $expectedEdition edition" -Encoding ASCII
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
$resolvedStage = (Resolve-Path -LiteralPath $stage).Path
$expectedStage = [IO.Path]::GetFullPath((Join-Path $Out $name))
if ($resolvedStage -ne $expectedStage -or -not $resolvedStage.StartsWith($Out.TrimEnd('\','/') + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Refusing cleanup outside the exact package staging folder.'
}
Remove-Item -LiteralPath $resolvedStage -Recurse -Force

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
