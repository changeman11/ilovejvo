# Makes small web versions of the game art in art-src/ (originals) -> public/images/art/.
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File scripts\make-art.ps1
Add-Type -AssemblyName System.Drawing

$src = Join-Path $PSScriptRoot '..\art-src'
$out = Join-Path $PSScriptRoot '..\public\images\art'
New-Item -ItemType Directory -Force $out | Out-Null

$jpeg = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$params = New-Object System.Drawing.Imaging.EncoderParameters 1
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 84L

# Crop (x, y, w, h) from a source file and save at the given size.
function Save-Crop($file, $x, $y, $w, $h, $outW, $outH, $name) {
  $img = [System.Drawing.Image]::FromFile((Resolve-Path (Join-Path $src $file)))
  $bmp = New-Object System.Drawing.Bitmap $outW, $outH
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.SmoothingMode = 'HighQuality'
  $g.PixelOffsetMode = 'HighQuality'
  $g.DrawImage($img, (New-Object System.Drawing.Rectangle 0, 0, $outW, $outH), (New-Object System.Drawing.Rectangle $x, $y, $w, $h), 'Pixel')
  $bmp.Save((Join-Path $out $name), $jpeg, $params)
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
}

# In-game scene (whole picture), for the home banner
Save-Crop 'image3.png' 0 0 617 751 493 600 'scene.jpg'
# Character faces (square), for round stickers
Save-Crop 'image.png'  85  30 340 340 200 200 'face-green.jpg'
Save-Crop 'image2.png' 160  0 310 310 200 200 'face-teal.jpg'
Save-Crop 'image3.png' 130 40 320 320 200 200 'face-blond.jpg'
Save-Crop 'image4.png' 150 95 360 360 200 200 'face-pink.jpg'
Save-Crop 'image5.png' 130 50 380 380 200 200 'face-x.jpg'
# Full character with the ball, for the sign-in card
Save-Crop 'image2.png' 0 0 510 802 280 440 'player-teal.jpg'

# Desktop background: a clean in-game shot of the grass court (no menus), WebP from the user.
# WebP needs Windows' own image decoder (WPF), not System.Drawing.
Add-Type -AssemblyName PresentationCore, WindowsBase
$stream = [IO.File]::OpenRead((Resolve-Path (Join-Path $src 'court-clean.webp')))
$frame = [Windows.Media.Imaging.BitmapDecoder]::Create($stream, 'PreservePixelFormat', 'OnLoad').Frames[0]
$stream.Close()
$enc = New-Object Windows.Media.Imaging.JpegBitmapEncoder
$enc.QualityLevel = 82
$enc.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($frame))
$fs = [IO.File]::Create((Join-Path $out 'court-bg.jpg'))
$enc.Save($fs)
$fs.Close()

# More characters (faces for stickers)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 84L
Save-Crop 'char-55.png'     150  40 390 390 200 200 'face-55.jpg'
Save-Crop 'char-21.png'     140  20 340 340 200 200 'face-21.jpg'
Save-Crop 'char-knight.png' 235  65 470 470 200 200 'face-knight.jpg'
Save-Crop 'char-22w.png'    115  35 310 310 200 200 'face-22w.jpg'

Get-ChildItem $out | Select-Object Name, Length
