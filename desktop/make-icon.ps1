Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\alfay\.gemini\antigravity-ide\brain\d12156dd-9740-4f85-84ae-bbc16d35682b\mingle_app_icon_1791739741515.jpg"
$destPng = "c:\Users\alfay\Desktop\mini\desktop\icon.png"
$destIco = "c:\Users\alfay\Desktop\mini\desktop\icon.ico"

$srcImg = [System.Drawing.Image]::FromFile($srcPath)

# 1. Save 512x512 PNG
$png512 = New-Object System.Drawing.Bitmap 512, 512
$g512 = [System.Drawing.Graphics]::FromImage($png512)
$g512.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g512.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g512.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g512.DrawImage($srcImg, 0, 0, 512, 512)
$g512.Dispose()
$png512.Save($destPng, [System.Drawing.Imaging.ImageFormat]::Png)
$png512.Dispose()

# 2. Build multi-resolution ICO (256, 128, 64, 48, 32, 16)
$sizes = @(256, 128, 64, 48, 32, 16)
$pngBytesList = @()

foreach ($sz in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $sz, $sz
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($srcImg, 0, 0, $sz, $sz)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $pngBytesList += ,$ms.ToArray()
    $ms.Dispose()
}

$srcImg.Dispose()

# Write ICO binary
$fs = [System.IO.File]::Create($destIco)
$bw = New-Object System.IO.BinaryWriter($fs)

# ICONDIR header
$bw.Write([UInt16]0) # Reserved
$bw.Write([UInt16]1) # Type 1 = ICO
$bw.Write([UInt16]$sizes.Length) # Count

# Header is 6 bytes + 16 bytes per entry
$dataOffset = 6 + ($sizes.Length * 16)

for ($i = 0; $i -lt $sizes.Length; $i++) {
    $sz = $sizes[$i]
    $bytes = $pngBytesList[$i]
    
    $w = if ($sz -ge 256) { 0 } else { [byte]$sz }
    $h = if ($sz -ge 256) { 0 } else { [byte]$sz }
    
    $bw.Write([byte]$w)
    $bw.Write([byte]$h)
    $bw.Write([byte]0)   # Colors (0 for >8bpp)
    $bw.Write([byte]0)   # Reserved
    $bw.Write([UInt16]1) # Color planes
    $bw.Write([UInt16]32) # Bits per pixel
    $bw.Write([UInt32]$bytes.Length) # Size in bytes
    $bw.Write([UInt32]$dataOffset)   # Offset
    
    $dataOffset += $bytes.Length
}

for ($i = 0; $i -lt $sizes.Length; $i++) {
    $bw.Write($pngBytesList[$i])
}

$bw.Close()
$fs.Close()

Write-Output "ICO and PNG created successfully at $destIco and $destPng"
