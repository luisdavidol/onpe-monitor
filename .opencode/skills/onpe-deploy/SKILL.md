---
name: onpe-deploy
description: Skill principal del proyecto ONPE. Siempre valida LOCALMENTE primero, luego despliega a Cloud Run, y finalmente hace push a GitHub. Usar para cualquier cambio en server.js, public/, Dockerfile, o cuando el usuario reporte un error o caída.
---

# ONPE Deploy — Flujo Local → Cloud Run → GitHub

## Regla de oro

**NUNCA desplegar a Cloud Run sin antes verificar localmente.** El historial demuestra que desplegar sin probar localmente causa ciclos largos de deploy fallido → fix → redeploy.

## Info del proyecto

- **Working directory:** `D:\GIT\onpe`
- **Firebase project:** `onpe-elecciones-2026`
- **Firebase URL:** `https://onpe-elecciones-2026.web.app`
- **Cloud Run URL:** `https://onpe-backend-656880564600.us-central1.run.app`
- **Firestore:** `social/stats` — NUNCA modificar ni eliminar

---

## FASE 1: Diagnosticar

Antes de tocar código, entender qué está pasando.

### 1.1 Verificar servicios en nube

```powershell
# Backend API
Invoke-RestMethod -Uri "https://onpe-backend-656880564600.us-central1.run.app/api/status" -UseBasicParsing -TimeoutSec 10

# Frontend
(Invoke-WebRequest -Uri "https://onpe-elecciones-2026.web.app" -UseBasicParsing -TimeoutSec 10).StatusCode

# Results endpoint
try { Invoke-RestMethod -Uri "https://onpe-backend-656880564600.us-central1.run.app/api/results" -UseBasicParsing -TimeoutSec 10 } catch { $_.Exception.Message }

# Social endpoint
Invoke-RestMethod -Uri "https://onpe-backend-656880564600.us-central1.run.app/api/social" -UseBasicParsing -TimeoutSec 10
```

### 1.2 Revisar logs de Cloud Run

```powershell
& "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" logging read "resource.type=cloud_run_revision AND resource.labels.service_name=onpe-backend" --project=onpe-elecciones-2026 --limit=20 --format="table(timestamp,textPayload)" --freshness=10m
```

### 1.3 Revisar código fuente

Leer `server.js`, `public/index.html`, `Dockerfile`, `package.json` para entender el estado actual.

---

## FASE 2: Probar LOCALMENTE

**SIEMPRE ejecutar esta fase antes de desplegar.** Crear scripts de prueba temporales y ejecutarlos.

### 2.1 Prueba de Puppeteer (si el cambio afecta el scraper)

Crear `test-onpe.js` temporal en la raíz del proyecto:

```javascript
const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();

    // User-Agent realista (sin "HeadlessChrome" — ONPE lo bloquea)
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Interceptar llamadas de red para debug
    page.on('response', async resp => {
        const ct = resp.headers()['content-type'] || '';
        if (resp.url().includes('.js') || resp.url().includes('.css')) {
            console.log(`  ${resp.status()} ${ct.substring(0,30)} ${resp.url().substring(0,100)}`);
        }
    });

    console.log('Navegando a ONPE...');
    try {
        await page.goto('https://resultadosegundavuelta.onpe.gob.pe/main/resumen', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });
    } catch (e) {
        console.log('Nav warning:', e.message.substring(0, 100));
    }

    console.log('Esperando renderizado...');
    await new Promise(r => setTimeout(r, 8000));

    // Verificar contenido
    const text = await page.evaluate(() => document.body.innerText);
    const lines = text.split('\n').filter(l => l.trim());

    console.log('\n=== CONTENIDO DE LA PAGINA ===');
    lines.slice(0, 20).forEach((l, i) => console.log(`  ${i}: ${l.trim().substring(0,120)}`));
    console.log(`Total: ${lines.length} lineas`);

    console.log('\n=== VERIFICACION ===');
    console.log('FUJIMORI:', text.includes('FUJIMORI'));
    console.log('SANCHEZ:', text.includes('SANCHEZ'));
    console.log('votos:', text.includes('votos'));

    await browser.close();
    console.log('\nPrueba local completada.');
})();
```

Ejecutar:
```powershell
node D:\GIT\onpe\test-onpe.js
```

**Criterio de éxito:** La página debe mostrar texto con "FUJIMORI", "SANCHEZ" y "votos". Si el texto está vacío, hay un problema con la web ONPE o con el User-Agent.

### 2.2 Prueba del servidor Express (si el cambio afecta server.js)

```powershell
# En una terminal, iniciar el servidor localmente
node D:\GIT\onpe\server.js

# En otra terminal, probar los endpoints
Invoke-RestMethod -Uri "http://localhost:3000/api/status" -UseBasicParsing -TimeoutSec 10
Invoke-RestMethod -Uri "http://localhost:3000/api/social" -UseBasicParsing -TimeoutSec 10
```

### 2.3 Prueba de dependencias (si se cambió package.json o Dockerfile)

```powershell
# Verificar que npm install funciona
cd D:\GIT\onpe
npm ci --omit=dev
node -e "require('puppeteer'); require('express'); require('@google-cloud/firestore'); console.log('OK')"
```

### 2.4 Limpiar scripts de prueba

```powershell
# Eliminar archivos temporales de prueba
Remove-Item D:\GIT\onpe\test-onpe.js -ErrorAction SilentlyContinue
```

---

## FASE 3: Corregir código

Solo después de entender el problema (Fase 1) y confirmar qué funciona localmente (Fase 2).

### Cambios comunes en server.js

- **Chrome no se lanza:** Agregar reintentos (3 intentos con 5s de delay)
- **Scrape cuelga:** Agregar timeout total con `Promise.race` (120s)
- **ONPE devuelve datos vacíos:** Verificar User-Agent (sin "HeadlessChrome")
- **Parser no encuentra votos:** Verificar formato actual de la página ONPE

### Cambios comunes en Dockerfile

- **Chrome no descarga:** Verificar que `tar` y `unzip` están instalados
- **Chrome no arranca:** Verificar dependencias del sistema (libgbm, libnss3, etc.)
- **Versión de Node:** Puppeteer 25+ requiere Node 22+

---

## FASE 4: Verificar localmente (post-corrección)

Después de hacer cambios, volver a ejecutar la Fase 2 para confirmar que la corrección funciona.

**Si la prueba local falla:** Volver a Fase 3. NO desplegar.

**Si la prueba local pasa:** Continuar a Fase 5.

---

## FASE 5: Desplegar a Cloud Run

Solo si la Fase 4 pasó exitosamente.

### 5.1 Deploy backend

```powershell
& "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" run deploy onpe-backend --source . --region=us-central1 --allow-unauthenticated --project=onpe-elecciones-2026 --memory=2Gi --min-instances=1 --quiet
# --min-instances=1 is MANDATORY: without it Cloud Run throttlea CPU en 0 tráfico,
# el setInterval background scraper no renderiza Chrome y devuelve "Sin datos" (ceros).
# El cache se queda pegado en datos viejos. Ver Issues/2026-06-12_web-sin-datos-chrome-cloudrun.md
```

Working directory: `D:\GIT\onpe`

### 5.2 Deploy frontend (si cambió public/)

```powershell
npx firebase-tools deploy --only hosting --project onpe-elecciones-2026
```

Working directory: `D:\GIT\onpe`

---

## FASE 6: Verificar en Cloud Run

Después del deploy, verificar que funciona en producción.

### 6.1 Esperar a que el servidor inicie (~30-45 segundos)

```powershell
Start-Sleep -Seconds 45
```

### 6.2 Verificar status

```powershell
Invoke-RestMethod -Uri "https://onpe-backend-656880564600.us-central1.run.app/api/status" -UseBasicParsing -TimeoutSec 10
```

### 6.3 Verificar results (puede requerir espera adicional si Chrome está scrapeando)

```powershell
# Si isFetching=true, esperar más
Start-Sleep -Seconds 30
Invoke-RestMethod -Uri "https://onpe-backend-656880564600.us-central1.run.app/api/results" -UseBasicParsing -TimeoutSec 10
```

### 6.4 Verificar logs si hay problemas

```powershell
& "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" logging read "resource.type=cloud_run_revision AND resource.labels.service_name=onpe-backend" --project=onpe-elecciones-2026 --limit=15 --format="table(timestamp,textPayload)" --freshness=5m
```

**Si el deploy falla en Cloud Run:** Volver a Fase 3. NO hacer push a GitHub.

**Si el deploy funciona:** Continuar a Fase 7.

---

## FASE 7: Push a GitHub

Solo si la Fase 6 pasó exitosamente.

```powershell
git add -A
git commit -m "<mensaje conciso en inglés describiendo el cambio>"
git push
```

Working directory: `D:\GIT\onpe`

---

## FASE 8: Documentar (si fue un incidente)

Si el cambio fue para resolver un bug o incidente, crear un issue documentando todo el proceso. Usar la plantilla de `Issues/YYYY-MM-DD_titulo.md` (ver skill `issue-tracker`).

---

## Checklist rápido

Antes de deploy, confirmar:

- [ ] ¿Se probó localmente? (Fase 2/4)
- [ ] ¿La prueba local pasó? (texto con datos, sin errores)
- [ ] ¿Se verificó que el User-Agent no contiene "HeadlessChrome"?
- [ ] ¿El Dockerfile tiene las dependencias correctas?
- [ ] ¿package.json tiene el engines correcto?

---

## Errores comunes y soluciones

| Error en Cloud Run | Causa | Solución |
|-------------------|-------|----------|
| `Timed out after 30000 ms waiting for WS endpoint` | Chrome no arranca | Reintentos + más memoria (`--memory=2Gi`) |
| `Failed to launch browser process: Code: null` | Chrome crashea | Verificar dependencias del sistema en Dockerfile |
| `Sin votos encontrados` + texto vacío | ONPE bloquea User-Agent | Usar `setUserAgent` sin "HeadlessChrome" |
| `Navigation timeout exceeded` | Página ONPE lenta | Aumentar timeout de navegación (45000 → 60000) |
| `Attempted to use detached Frame` | Navegación durante scrape | Catch del error + retry |
| Build falla en Cloud Run | Falta `tar`/`unzip` en Dockerfile | Agregar a `apt-get install` |
| `Could not find Chrome` | PUPPETEER_EXECUTABLE_PATH incorrecto | Verificar env vars en Cloud Run y Dockerfile |
