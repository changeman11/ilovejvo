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

# Desktop background: the in-game menu screenshot (WebP), cut between the game's top and bottom bars.
# WebP needs Windows' own image decoder (WPF), not System.Drawing.
Add-Type -AssemblyName PresentationCore, WindowsBase
$stream = [IO.File]::OpenRead((Resolve-Path (Join-Path $src 'ingame-menu.webp')))
$frame = [Windows.Media.Imaging.BitmapDecoder]::Create($stream, 'PreservePixelFormat', 'OnLoad').Frames[0]
$stream.Close()
$crop = New-Object Windows.Media.Imaging.CroppedBitmap $frame, (New-Object Windows.Int32Rect 0, 110, 2000, 652)
$enc = New-Object Windows.Media.Imaging.JpegBitmapEncoder
$enc.QualityLevel = 80
$enc.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($crop))
$raw = Join-Path $out 'court-raw.jpg'
$fs = [IO.File]::Create($raw)
$enc.Save($fs)
$fs.Close()

# Replace the game's own menu on the left (our menu sits there): cover it with a mirrored copy of the
# clean trees and grass on the right, blur that softly, and fade it into the sharp court.
$img = [System.Drawing.Image]::FromFile((Resolve-Path $raw))
$w = $img.Width; $h = $img.Height
$filled = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($filled)
$g.DrawImage($img, 0, 0, $w, $h)
# right edge strip (x 1440-2000), flipped, onto x 0-560; then the clean court next to the cards onto 560-760
$g.DrawImage($img, (New-Object System.Drawing.Rectangle 560, 0, -560, $h), 1440, 0, 560, $h, 'Pixel')
$g.DrawImage($img, (New-Object System.Drawing.Rectangle 560, 0, 200, $h), 700, 0, 200, $h, 'Pixel')
$g.Dispose()
$small = New-Object System.Drawing.Bitmap ([int]($w / 30)), ([int]($h / 30))
$g = [System.Drawing.Graphics]::FromImage($small); $g.InterpolationMode = 'HighQualityBilinear'
$g.DrawImage($filled, 0, 0, $small.Width, $small.Height); $g.Dispose()
$blur = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($blur); $g.InterpolationMode = 'HighQualityBicubic'
$g.DrawImage($small, -20, -20, $w + 40, $h + 40); $g.Dispose()
$final = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($final)
$g.DrawImage($img, 0, 0, $w, $h)
$solidTo = 700; $fadeTo = 900
$g.DrawImage($blur, (New-Object System.Drawing.Rectangle 0, 0, $solidTo, $h), 0, 0, $solidTo, $h, 'Pixel')
for ($x = $solidTo; $x -lt $fadeTo; $x += 4) {
  $alpha = 1 - (($x - $solidTo) / ($fadeTo - $solidTo))
  $cm = New-Object System.Drawing.Imaging.ColorMatrix; $cm.Matrix33 = [single]$alpha
  $ia = New-Object System.Drawing.Imaging.ImageAttributes; $ia.SetColorMatrix($cm)
  $g.DrawImage($blur, (New-Object System.Drawing.Rectangle $x, 0, 4, $h), $x, 0, 4, $h, 'Pixel', $ia)
}
$g.Dispose()
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 80L
$final.Save((Join-Path $out 'court-bg.jpg'), $jpeg, $params)
$img.Dispose(); $filled.Dispose(); $small.Dispose(); $blur.Dispose(); $final.Dispose()
Remove-Item $raw

# More characters (faces for stickers)
$params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 84L
Save-Crop 'char-55.png'     150  40 390 390 200 200 'face-55.jpg'
Save-Crop 'char-21.png'     140  20 340 340 200 200 'face-21.jpg'
Save-Crop 'char-knight.png' 235  65 470 470 200 200 'face-knight.jpg'
Save-Crop 'char-22w.png'    115  35 310 310 200 200 'face-22w.jpg'

Get-ChildItem $out | Select-Object Name, Length
