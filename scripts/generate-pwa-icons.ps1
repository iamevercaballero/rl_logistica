<#
.SYNOPSIS
  Genera los iconos de la app a partir de public/logo.jpg.

.DESCRIPTION
  Fuente unica de verdad: logistica-palets-frontend/public/logo.jpg (el mismo
  logo que usan el sidebar, el login y los documentos impresos).

    public/icon-192.png   (192x192)  manifest PWA  -> logo completo
    public/icon-512.png   (512x512)  manifest PWA  -> logo completo
    public/favicon.png    (48x48)    pestania      -> solo el monograma "RL"

  El logo es un lockup horizontal ("RL" + "Transporte & Logistica" + la
  flecha). A 192px+ se lee entero, asi que icon-192/512 usan el logo completo
  recortado y centrado sobre blanco. A 16px (la pestania real) el texto se
  vuelve ruido, asi que el favicon usa solo el monograma "RL" de la esquina
  superior izquierda. Ambos recuadros se detectan solos escaneando el pixel;
  si cambia el logo puede hacer falta ajustar los factores de region de abajo.

  El fondo blanco llega al borde -> los PNG sirven como icono "any" y
  "maskable" (el contenido queda dentro del centro).

  Requiere Windows / .NET (System.Drawing) — es una tarea de diseno que se
  corre en la maquina de quien cambia el logo, no en CI ni en el VPS. Los PNG
  resultantes se commitean; este script solo hace falta cuando cambia logo.jpg.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/generate-pwa-icons.ps1
#>

Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = 'Stop'
$publicDir = Join-Path $PSScriptRoot '..\logistica-palets-frontend\public'
$srcPath   = Join-Path $publicDir 'logo.jpg'

if (-not (Test-Path $srcPath)) { throw "No se encontro $srcPath" }

$src = New-Object System.Drawing.Bitmap($srcPath)

# --- Recuadro de tinta (no-blanco) dentro de una region del logo -------------
function Get-InkBounds([int]$x0, [int]$y0, [int]$x1, [int]$y1) {
  $minX = $x1; $minY = $y1; $maxX = $x0; $maxY = $y0
  for ($y = $y0; $y -lt $y1; $y += 2) {
    for ($x = $x0; $x -lt $x1; $x += 2) {
      $p = $src.GetPixel($x, $y)
      if ($p.R -lt 240 -or $p.G -lt 240 -or $p.B -lt 240) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  [pscustomobject]@{ X = $minX; Y = $minY; W = ($maxX - $minX + 1); H = ($maxY - $minY + 1) }
}

# Logo completo.
$full = Get-InkBounds 0 0 $src.Width $src.Height
Write-Host ("logo completo : {0}x{1} en ({2},{3})" -f $full.W, $full.H, $full.X, $full.Y)

# Monograma "RL": esquina superior-izquierda del contenido. Los factores
# acotan la busqueda a las letras y dejan afuera el texto (a la derecha) y la
# flecha (arranca justo debajo del pie de la "L").
$mono = Get-InkBounds $full.X $full.Y `
                      ([int]($full.X + $full.W * 0.37)) `
                      ([int]($full.Y + $full.H * 0.53))
Write-Host ("monograma RL  : {0}x{1} en ({2},{3})" -f $mono.W, $mono.H, $mono.X, $mono.Y)

# --- Render: recorte -> centrado sobre lienzo cuadrado blanco ---------------
function New-Icon {
  param([int]$Size, [string]$Name, $Box, [double]$Fill)
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode    = 'AntiAlias'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode   = 'HighQuality'
  $g.Clear([System.Drawing.Color]::White)

  $side = [Math]::Max($Box.W, $Box.H)         # lado del recorte (cuadrado)
  $scale = ($Size * $Fill) / $side
  $dw = $Box.W * $scale
  $dh = $Box.H * $scale
  $dx = ($Size - $dw) / 2
  $dy = ($Size - $dh) / 2

  $srcRect = New-Object System.Drawing.RectangleF($Box.X, $Box.Y, $Box.W, $Box.H)
  $dstRect = New-Object System.Drawing.RectangleF($dx, $dy, $dw, $dh)
  $g.DrawImage($src, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()

  $bmp.Save((Join-Path $publicDir $Name), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("  OK  {0} ({1}x{1})" -f $Name, $Size)
}

New-Icon -Size 512 -Name 'icon-512.png' -Box $full -Fill 0.76
New-Icon -Size 192 -Name 'icon-192.png' -Box $full -Fill 0.76
New-Icon -Size 48  -Name 'favicon.png'  -Box $mono -Fill 0.88

$src.Dispose()
Write-Host "Listo -> $publicDir"
