# Issue #001 — Web caída: Backend no devolvía datos electorales

**Fecha:** 2026-06-11  
**Hora de inicio:** ~14:20 UTC  
**Hora de resolución:** ~16:14 UTC  
**Duración total:** ~1 hora 54 minutos  
**Severidad:** Alta (web completamente funcional pero sin datos)  
**Estado:** RESUELTO

---

## 1. ¿Qué sucedió?

La web del monitor electoral ONPE 2026 (`https://onpe-elecciones-2026.web.app`) dejó de mostrar datos de votos. La página cargaba bien (HTML, CSS, estilos), pero la sección de resultados mostraba un error: "No se pudieron obtener los datos de ONPE".

### Síntomas reportados
- La web se veía "caída" desde el punto de vista del usuario
- El frontend (Firebase Hosting) respondía correctamente — servía el HTML
- El backend (Cloud Run) respondía a las APIs — `/api/social` funcionaba (216 visitas, 13 likes, 13 comentarios)
- Pero `/api/results` devolvía error 500 — "No se pudieron obtener los datos de ONPE"

### Lo que el usuario veía
```
[Spinner] Conectando con servidor...
   ❌ No se pudieron obtener los datos de ONPE
   [Reintentar]
```

---

## 2. ¿Qué se analizó?

### 2.1 Verificación de servicios en nube

| Servicio | Estado | Detalle |
|----------|--------|---------|
| Firebase Hosting (frontend) | ✅ OK | Status 200, HTML servido correctamente (27,348 bytes) |
| Cloud Run (backend API) | ✅ OK | API respondiendo, social data intacto en Firestore |
| Firestore (base de datos) | ✅ OK | 216 views, 13 likes, 13 comments — datos persistentes |
| Scraper Puppeteer | ❌ FALLANDO | Chrome no podía lanzarse O la página ONPE no devolvía datos |

### 2.2 Análisis de logs de Cloud Run

Se revisaron los logs de Cloud Run (`gcloud logging read`) y se encontraron **dos errores alternantes**:

**Error A — Chrome no se lanza:**
```
Error fetching ONPE data: Timed out after 30000 ms while waiting for the WS endpoint URL to appear in stdout!
```
> **Explicación para dummies:** Puppeteer (el robot que visita la web de ONPE) intenta abrir Chrome dentro del servidor. Chrome tarda más de 30 segundos en arrancar y Puppeteer se rinde.

**Error B — Chrome crashea al iniciar:**
```
Error fetching ONPE data: Failed to launch the browser process: Code: null
```
> **Explicación para dummies:** Chrome arranca pero se cierra inmediatamente sin dar ninguna razón (como un auto que enciende y se apaga al instante).

### 2.3 Pruebas de compatibilidad de Chrome

Se probaron múltiples configuraciones:

| Configuración | Resultado |
|--------------|-----------|
| `headless: 'new'` (código original) | Falla intermitente |
| `headless: true` | Falla intermitente |
| Puppeteer 25 + Chromium bundled (descargado) | No descargaba — falta `unzip` en imagen slim |
| Puppeteer 25 + Node 22 + Chromium bundled | Build falla — Node 20 vs 22 incompatibilidad |
| Volver a Debian Chromium + Node 20 | Chrome se lanza a veces |

**Conclusión:** El Chrome launch era INTERMITENTE — a veces funcionaba, a veces no. Esto sugiere que el problema no era de configuración sino de recursos del servidor.

### 2.4 Investigación de la web ONPE

Cuando Chrome SÍ se lanzaba exitosamente, el scraper obtenía **0 votos** y texto vacío. Se hizo una prueba local con Puppeteer:

```javascript
// Resultado del scraping:
{ keikoVotes: 0, robertoVotes: 0, actasPorcentaje: 0 }
// Texto de la página: (vacío)
```

**Pero la web de ONPE SÍ tenía datos.** Al acceder manualmente se veía:
```
KEIKO SOFIA FUJIMORI HIGUCHI — FUERZA POPULAR — 9'032,653 votos — 50.002%
ROBERTO HELBERT SANCHEZ PALOMINO — JUNTOS POR EL PERÚ — 9'032,092 votos — 49.998%
Actas contabilizadas: 98.216%
```

### 2.5 Descubrimiento de la causa raíz

Se hizo una prueba comparativa de User-Agent:

| User-Agent | Content-Type devuelto | ¿Funciona? |
|------------|----------------------|-------------|
| PowerShell (Invoke-WebRequest) | `application/javascript` | ✅ |
| Chrome normal | `application/javascript` | ✅ |
| **HeadlessChrome** | **`text/html`** | ❌ |
| Chrome + Referer de la página | `application/javascript` | ✅ |

**¡El servidor de ONPE bloquea peticiones con "HeadlessChrome" en el User-Agent!**

> **Explicación para dummies:** La web de ONPE tiene un "guardia de seguridad" que revisa quién entra. Si detecta que eres un robot (tu nombre dice "HeadlessChrome"), te devuelve una página vacía en vez de los datos reales. Es como si un portero no dejara entrar a gente con uniforme de repartidor.

### 2.6 Verificación de la solución

Se probó localmente con el User-Agent correcto (sin "HeadlessChrome"):

```javascript
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
```

Resultado:
```
✅ application/javascript — 2,751,949 bytes (JS correcto)
✅ text/css — 245,603 bytes (CSS correcto)
✅ Angular renderizó correctamente
✅ Datos extraídos: 9,032,653 vs 9,032,092 votos
```

---

## 3. ¿Cómo se resolvió?

### Cambios técnicos realizados en `server.js`

**1. Reintentos de Chrome (el principal):**
```javascript
// ANTES: un solo intento, si falla → error
browser = await puppeteer.launch({...});

// DESPUÉS: 3 intentos con 5s de espera entre cada uno
for (let attempt = 1; attempt <= 3; attempt++) {
    try {
        browser = await puppeteer.launch({...});
        break; // éxito → salir del loop
    } catch (e) {
        if (attempt < 3) await new Promise(r => setTimeout(r, 5000));
        else throw e; // último intento fallido → error
    }
}
```
> **Para dummies:** Si Chrome no arranca a la primera, intenta 3 veces con 5 segundos de descanso entre cada intento. Como cuando intentas encender un auto viejo.

**2. Timeout total de 120 segundos:**
```javascript
const result = await Promise.race([
    scrapeWithPuppeteer(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 120s')), 120000))
]);
```
> **Para dummies:** Si el scraping tarda más de 2 minutos en total, se cancela y se intenta de nuevo en el próximo ciclo. Evita que el servidor se quede colgado indefinidamente.

**3. User-Agent correcto (ya existía, se mantuvo):**
```javascript
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ...');
```
> **Para dummies:** El robot se disfraza de Chrome normal para que el "portero" de ONPE lo deje entrar.

**4. Separación de responsabilidades:**
```javascript
// ANTES: todo en una sola función gigante
async function fetchONPEData() { /* 100+ líneas */ }

// DESPUÉS: función de scraping separada
async function scrapeWithPuppeteer() { /* solo scraping */ }
async function fetchONPEData() { /* lógica de cache + timeout */ }
```
> **Para dummies:** En vez de tener una persona que hace todo, ahora hay dos: uno se encarga de ir a buscar datos y otro se encarga de guardarlos y servirlos.

**5. Memoria del contenedor aumentada:**
```
--memory=2Gi  (antes era 1Gi por defecto)
```
> **Para dummies:** Chrome necesita mucha memoria para funcionar. Le dimos el doble de RAM al servidor.

### Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `server.js` | Reintentos, timeout total, limpieza de código |
| `Dockerfile` | Sin cambios (se revirtió al original) |
| `package.json` | Sin cambios (se revirtió al original) |

---

## 4. Prevención futura

- El scraper ahora tiene **reintentos automáticos** — si Chrome falla, reintenta 2 veces más
- El **timeout de 120s** evita que el servidor se quede colgado
- El **setInterval de 60s** sigue intentando en background — eventualmente un intento tendrá éxito
- Los logs ahora muestran claramente qué está pasando en cada intento

---

## 5. Lecciones aprendidas

1. **No asumir que el scraper funciona localmente = funciona en Cloud Run.** El entorno de nube tiene restricciones diferentes (memoria, CPU, red).

2. **Los servidores web pueden bloquear bots.** ONPE detecta "HeadlessChrome" y devuelve contenido vacío. Siempre usar un User-Agent realista.

3. **Chrome en contenedores es frágil.** Puppeteer + Chrome en Docker/Cloud Run necesita reintentos porque el lanzamiento es intermitente.

4. **Verificar el estado real del servicio, no solo si "responde".** El backend respondía 200, pero los datos eran un error 500. Un health check debe verificar la funcionalidad real.

5. **Probar localmente primero.** Mucho tiempo se perdió desplegando a Cloud Run para cada prueba. Las pruebas locales con Puppeteer son mucho más rápidas.
