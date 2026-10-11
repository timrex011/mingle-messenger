Add-Type -AssemblyName System.Drawing

$srcPath = "c:\Users\alfay\Desktop\mini\desktop\icon.png"
$srcImg = [System.Drawing.Image]::FromFile($srcPath)

$sizes = @(256, 128, 64, 48, 32, 16)
$pngBytesList = @()

foreach ($sz in $sizes) {
    $sBmp = New-Object System.Drawing.Bitmap $sz, $sz
    $sg = [System.Drawing.Graphics]::FromImage($sBmp)
    $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $sg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $sg.DrawImage($srcImg, 0, 0, $sz, $sz)
    $sg.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $sBmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $sBmp.Dispose()
    $pngBytesList += ,$ms.ToArray()
    $ms.Dispose()
}

$srcImg.Dispose()

$icoFiles = @(
    "c:\Users\alfay\Desktop\mini\desktop\icon.ico",
    "c:\Users\alfay\Desktop\mini\client\public\favicon.ico",
    "c:\Users\alfay\Desktop\mini\website\favicon.ico"
)

foreach ($destIco in $icoFiles) {
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

Write-Output "ICO files updated successfully from website/favicon.svg!"
