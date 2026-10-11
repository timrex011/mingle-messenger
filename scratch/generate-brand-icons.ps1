Add-Type -AssemblyName System.Drawing

function Draw-MingleIcon([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)

    # 1. Background White Squircle (Rounded Rectangle)
    $radius = $size * 0.28
    $rect = New-Object System.Drawing.RectangleF 0, 0, $size, $size
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2

    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($size - $d, 0, $d, $d, 270, 90)
    $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
    $path.AddArc(0, $size - $d, $d, $d, 90, 90)
    $path.CloseFigure()

    $brushWhite = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
    $g.FillPath($brushWhite, $path)
    $brushWhite.Dispose()

    # Subtle border for visibility on white surfaces
    $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(35, 100, 110, 180)), ($size * 0.015)
    $g.DrawPath($borderPen, $path)
    $borderPen.Dispose()
    $path.Dispose()

    # 2. Blue/Indigo Message Bubble
    $blueColor = [System.Drawing.Color]::FromArgb(255, 104, 126, 241) # #687ef1
    $penWidth = [Math]::Max(1.5, $size * 0.09)
    $pen = New-Object System.Drawing.Pen $blueColor, $penWidth
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round

    # Center is at ($size*0.52, $size*0.48)
    # Circle radius $r = $size * 0.24
    $cx = $size * 0.52
    $cy = $size * 0.48
    $r = $size * 0.235

    $bubblePath = New-Object System.Drawing.Drawing2D.GraphicsPath
    # Arc from angle 115 deg to 175 deg around the circle
    $bubblePath.AddArc(($cx - $r), ($cy - $r), ($r * 2), ($r * 2), 118, 304)

    # Tail points down-left to ($size * 0.25, $size * 0.75)
    $tailTipX = $size * 0.25
    $tailTipY = $size * 0.75
    $bubblePath.AddLine(($cx - $r * 0.95), ($cy + $r * 0.35), $tailTipX, $tailTipY)
    $bubblePath.CloseFigure()

    $g.DrawPath($pen, $bubblePath)

    $pen.Dispose()
    $bubblePath.Dispose()
    $g.Dispose()

    return $bmp
}

# 1. Generate 512x512 Master PNG
$master = Draw-MingleIcon 512
$targetsPng = @(
    "c:\Users\alfay\Desktop\mini\desktop\icon.png",
    "c:\Users\alfay\Desktop\mini\client\public\favicon.png",
    "c:\Users\alfay\Desktop\mini\website\favicon.png"
)
foreach ($p in $targetsPng) {
    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($p)) | Out-Null
    $master.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
}
$master.Dispose()

# 2. Generate Multi-Resolution ICO (256, 128, 64, 48, 32, 16)
$sizes = @(256, 128, 64, 48, 32, 16)
$pngBytesList = @()

foreach ($sz in $sizes) {
    $bmp = Draw-MingleIcon $sz
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $pngBytesList += ,$ms.ToArray()
    $ms.Dispose()
}

$targetsIco = @(
    "c:\Users\alfay\Desktop\mini\desktop\icon.ico",
    "c:\Users\alfay\Desktop\mini\client\public\favicon.ico",
    "c:\Users\alfay\Desktop\mini\website\favicon.ico"
)

foreach ($destIco in $targetsIco) {
    $fs = [System.IO.File]::Create($destIco)
    $bw = New-Object System.IO.BinaryWriter($fs)

    $bw.Write([UInt16]0)
    $bw.Write([UInt16]1)
    $bw.Write([UInt16]$sizes.Length)

    $dataOffset = 6 + ($sizes.Length * 16)

    for ($i = 0; $i -lt $sizes.Length; $i++) {
        $sz = $sizes[$i]
        $bytes = $pngBytesList[$i]
        $w = if ($sz -ge 256) { 0 } else { [byte]$sz }
        $h = if ($sz -ge 256) { 0 } else { [byte]$sz }

        $bw.Write([byte]$w)
        $bw.Write([byte]$h)
        $bw.Write([byte]0)
        $bw.Write([byte]0)
        $bw.Write([UInt16]1)
        $bw.Write([UInt16]32)
        $bw.Write([UInt32]$bytes.Length)
        $bw.Write([UInt32]$dataOffset)

        $dataOffset += $bytes.Length
    }

    for ($i = 0; $i -lt $sizes.Length; $i++) {
        $bw.Write($pngBytesList[$i])
    }

    $bw.Close()
    $fs.Close()
}

Write-Output "All icons generated successfully!"
