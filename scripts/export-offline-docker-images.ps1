[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$archivePath = Join-Path $repositoryRoot 'nova-harness-docker-images-1.0.0.tgz'
$tarPath = Join-Path $repositoryRoot 'nova-harness-docker-images-1.0.0.tar'
$checksumPath = "$archivePath.sha256"

if ([System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($tarPath)) -ne $repositoryRoot) {
  throw 'Temporary image path is outside the repository root.'
}

docker version --format 'Docker Server {{.Server.Version}}' | Out-Host
if ($LASTEXITCODE -ne 0) {
  throw 'Docker Engine is unavailable. Start Docker Desktop first.'
}

Write-Host 'Building nova-harness:1.0.0 ...'
docker build --tag nova-harness:1.0.0 $repositoryRoot
if ($LASTEXITCODE -ne 0) {
  throw 'Nova Harness image build failed.'
}

docker image inspect postgres:17-alpine *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Pulling postgres:17-alpine ...'
  docker pull postgres:17-alpine
  if ($LASTEXITCODE -ne 0) {
    throw 'PostgreSQL image pull failed.'
  }
}

try {
  Write-Host 'Exporting images to temporary TAR ...'
  docker save --output $tarPath nova-harness:1.0.0 postgres:17-alpine
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker image export failed.'
  }

  Write-Host 'Compressing TAR to a docker-load-compatible TGZ ...'
  $source = [System.IO.File]::OpenRead($tarPath)
  try {
    $target = [System.IO.File]::Create($archivePath)
    try {
      $gzip = [System.IO.Compression.GZipStream]::new(
        $target,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
      )
      try {
        $source.CopyTo($gzip)
      }
      finally {
        $gzip.Dispose()
      }
    }
    finally {
      $target.Dispose()
    }
  }
  finally {
    $source.Dispose()
  }

  $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash
  [System.IO.File]::WriteAllText(
    $checksumPath,
    "$hash  $([System.IO.Path]::GetFileName($archivePath))`n",
    [System.Text.UTF8Encoding]::new($false)
  )
  Write-Host "Created: $archivePath"
  Write-Host "Checksum: $checksumPath"
}
finally {
  if (Test-Path -LiteralPath $tarPath) {
    Remove-Item -LiteralPath $tarPath -Force
  }
}
