Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  CHECKLIST DE SALUD - ONPE Elecciones" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$allOk = $true

# 1. Servidor local
Write-Host "[1/4] Servidor local (localhost:3000)..." -NoNewline
try {
    $status = Invoke-RestMethod -Uri "http://localhost:3000/api/status" -UseBasicParsing -TimeoutSec 5
    if ($status.hasData -eq $true) {
        Write-Host " ON" -ForegroundColor Green
    } else {
        Write-Host " ON (sin datos)" -ForegroundColor Yellow
        $allOk = $false
    }
} catch {
    Write-Host " OFF" -ForegroundColor Red
    Write-Host "       Ejecuta: npm start" -ForegroundColor Yellow
    $allOk = $false
}

# 2. Cloudflared process
Write-Host "[2/4] Cloudflared tunnel..." -NoNewline
$cf = Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue
if ($cf) {
    $cfFile = "$env:TEMP\cf_err.txt"
    if (Test-Path $cfFile) {
        $url = Get-Content $cfFile -ErrorAction SilentlyContinue | Select-String "trycloudflare.com" | Select-Object -Last 1
        if ($url) {
            Write-Host " ON" -ForegroundColor Green
        } else {
            Write-Host " ON (URL no detectada)" -ForegroundColor Yellow
        }
    } else {
        Write-Host " ON" -ForegroundColor Green
    }
} else {
    Write-Host " OFF" -ForegroundColor Red
    Write-Host "       Ejecuta: cloudflared.exe tunnel --url http://localhost:3000" -ForegroundColor Yellow
    $allOk = $false
}

# 3. Cloudflare API
Write-Host "[3/5] Cloudflare API..." -NoNewline
try {
    $cfUrl = Get-Content "$env:TEMP\cf_err.txt" -ErrorAction SilentlyContinue | Select-String "https://.*trycloudflare.com" | ForEach-Object { $_.Matches.Value } | Select-Object -Last 1
    if ($cfUrl) {
        $result = Invoke-RestMethod -Uri "$cfUrl/api/results" -UseBasicParsing -TimeoutSec 10
        Write-Host " ON ($($result.candidate1.votes) | $($result.candidate2.votes) | $($result.actasContabilizadas)%)" -ForegroundColor Green
    } else {
        Write-Host " SIN URL" -ForegroundColor Red
        $allOk = $false
    }
} catch {
    Write-Host " OFF" -ForegroundColor Red
    $allOk = $false
}

# 4. Firebase
Write-Host "[4/5] Firebase Hosting..." -NoNewline
try {
    Invoke-WebRequest -Uri "https://onpe-elecciones-2026.web.app" -UseBasicParsing -TimeoutSec 10 | Out-Null
    Write-Host " ON" -ForegroundColor Green
} catch {
    Write-Host " OFF" -ForegroundColor Red
    $allOk = $false
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
if ($allOk) {
    Write-Host "  TODO OK - Web funcionando!" -ForegroundColor Green
    Write-Host "  https://onpe-elecciones-2026.web.app" -ForegroundColor Green
} else {
    Write-Host "  HAY COMPONENTES CAIDOS" -ForegroundColor Red
    Write-Host "  Revisa los comandos sugeridos arriba" -ForegroundColor Yellow
}
Write-Host "========================================" -ForegroundColor Cyan