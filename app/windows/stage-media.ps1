$ErrorActionPreference = 'Stop'
$dest = Join-Path $PSScriptRoot '..\vendor\media'
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$pins = @(
  @('mediabunny', 'lYzeerDwo9QLhBCipqQDXOSV7InvaIFplllZQviPO5rPwH+IUr8M1uvumk1olIUgMRGkPiInRriv25WFErUgMw=='),
  @('@mediabunny/mp3-encoder', 'v5L8Z9T298IcSWGvWPlGGNhoM2YzY+fOVAtdkwc6Leh8c1HXl5ivJVBKCcRZeCbp4LDJOSuwdu2SE/V67SZo7w=='),
  @('@mediabunny/aac-encoder', '3fiZYAX95d+TDp2vu0sXMYputLm2+W21fZQMUWTf9awKhsRC/wko9OXj4GLLmGKMRryvI9Ocv9HzhhHVRYWopQ==')
)
$manifest = @()
foreach ($pin in $pins) {
  $name = $pin[0]; $short = ($name -split '/')[-1]
  $meta = Invoke-RestMethod -Uri ('https://registry.npmjs.org/' + [uri]::EscapeDataString($name) + '/1.62.1')
  if ($meta.dist.integrity -ne ('sha512-' + $pin[1])) { throw "Registry integrity changed for $name" }
  $tgz = Join-Path $dest "$short-1.62.1.tgz"
  Invoke-WebRequest -Uri $meta.dist.tarball -OutFile $tgz
  $stream = [IO.File]::OpenRead($tgz); $sha = [Security.Cryptography.SHA512]::Create()
  try { $digest = [Convert]::ToBase64String($sha.ComputeHash($stream)) } finally { $stream.Dispose(); $sha.Dispose() }
  if ($digest -ne $pin[1]) { throw "Downloaded integrity mismatch for $name" }
  $folder = Join-Path $dest $short
  New-Item -ItemType Directory -Force -Path $folder | Out-Null
  tar -xzf $tgz -C $folder --strip-components=1
  if ($LASTEXITCODE -ne 0) { throw "Extraction failed for $name" }
  $manifest += [ordered]@{ name = $name; version = '1.62.1'; url = $meta.dist.tarball; integrity = $meta.dist.integrity; sha256 = (Get-FileHash -LiteralPath $tgz -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $dest 'PROVENANCE.json') -Encoding UTF8
$manifest | ForEach-Object { "$($_.sha256)  $(($_.name -split '/')[-1])-1.62.1.tgz" } | Set-Content -LiteralPath (Join-Path $dest 'SHA256SUMS.txt') -Encoding ASCII
