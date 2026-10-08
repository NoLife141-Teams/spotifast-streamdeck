# Rebuild the two Favorite states at both Stream Deck resolutions on Windows.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$output = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\streamdeck\imgs'))
$green = [Drawing.ColorTranslator]::FromHtml('#A3E635')
foreach ($size in @(72, 144)) {
    foreach ($filled in @($false, $true)) {
        $bitmap = [Drawing.Bitmap]::new($size, $size)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $heart = [Drawing.Drawing2D.GraphicsPath]::new()
        $pen = [Drawing.Pen]::new($green, 3.5)
        $brush = [Drawing.SolidBrush]::new($green)
        try {
            $graphics.Clear([Drawing.Color]::Black)
            $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
            $graphics.ScaleTransform($size / 72.0, $size / 72.0)
            $pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
            $heart.AddBezier(36, 24, 26, 12, 10, 19, 14, 32)
            $heart.AddBezier(14, 32, 16, 39, 25, 47, 36, 55)
            $heart.AddBezier(36, 55, 47, 47, 56, 39, 58, 32)
            $heart.AddBezier(58, 32, 62, 19, 46, 12, 36, 24)
            $heart.CloseFigure()
            if ($filled) { $graphics.FillPath($brush, $heart) }
            $graphics.DrawPath($pen, $heart)
            $name = if ($filled) { 'heart-active' } else { 'heart' }
            if ($size -eq 144) { $name += '@2x' }
            $bitmap.Save((Join-Path $output ($name + '.png')), [Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $brush.Dispose(); $pen.Dispose(); $heart.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
        }
    }
}
Write-Output 'Generated empty and filled hearts on black backgrounds (72 and 144 px).'
