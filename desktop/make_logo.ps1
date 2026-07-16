Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot "logo.png"
$size = 1024
$bmp = New-Object System.Drawing.Bitmap $size,$size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$g.Clear([System.Drawing.Color]::Transparent)

# rounded-square badge
$inset = 70
$radius = 220
$rect = New-Object System.Drawing.Rectangle $inset,$inset,($size-2*$inset),($size-2*$inset)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$d = $radius*2
$path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
$path.AddArc($rect.Right-$d, $rect.Y, $d, $d, 270, 90)
$path.AddArc($rect.Right-$d, $rect.Bottom-$d, $d, $d, 0, 90)
$path.AddArc($rect.X, $rect.Bottom-$d, $d, $d, 90, 90)
$path.CloseFigure()

$c1 = [System.Drawing.Color]::FromArgb(79,70,229)   # indigo
$c2 = [System.Drawing.Color]::FromArgb(34,211,238)  # cyan
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $c1, $c2, 55.0
$g.FillPath($brush, $path)

# subtle inner glow ring
$pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(60,255,255,255)), 6
$g.DrawPath($pen, $path)

# SAI text — centered via a PointF (RectangleF ctor with int args fails overload resolution)
$font = New-Object System.Drawing.Font("Segoe UI",[single]280,[System.Drawing.FontStyle]::Bold)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$mid = New-Object System.Drawing.PointF([single]($size/2),[single]($size/2 + 18))
$g.DrawString("SAI", $font, $textBrush, $mid, $sf)

$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
"logo: $out ($((Get-Item $out).Length) bytes)"
