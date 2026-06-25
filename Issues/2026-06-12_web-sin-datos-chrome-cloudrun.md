# Issue #002 — Web sin datos: Chrome no arrancaba en Cloud Run + ONPE devolvía página vacía

**Fecha:** 2026-06-12  
**Hora de inicio:** ~13:30 UTC  
**Hora de resolución:** ~17:16 UTC  
**Duración total:** ~3 horas 46 minutos  
**Severidad:** Alta (web mostraba 0 votos, "Conectando con servidor...")  
**Estado:** RESUELTO

---

## 1. ¿Qué sucedió?

La web del monitor electoral ONPE 2026 (`https://onpe-elecciones-2026.web.app`) mostraba **cero votos** y el spinner "Conectando con servidor..." sin datos reales. El backend estaba vivo (`isFetching: true`, `hasData: false`) pero no lograba obtener los resultados de la web de ONPE.

---

## 2. Diagnóstico

Se identificaron **4 problemas encadenados**:

### 2.1 Chrome no arranca en Cloud Run

| Error | Frecuencia | Causa |
|-------|-----------|-------|
| `Timed out after 30000 ms while waiting for the WS endpoint` | 70% de intentos | Chrome crashea silenciosamente por restricciones del kernel de Cloud Run (NETLINK, inotify, D-Bus) |
| `Failed to launch the browser process: Code: null` | 20% | Dependencias del sistema faltantes |
| Chrome arranca correctamente | 10% | Nodo con kernel compatible |

**Solución parcial:** `min-instances=1` no era suficiente. Al subir a `min-instances=2`, al menos una instancia tenía Chrome funcional.

### 2.2 La página ONPE cargaba pero el `setTimeout(15s)` se dormía

Cuando Chrome sí arrancaba, la página se cargaba correctamente (`domcontentloaded`), pero después del `await page.goto()`, el `setTimeout(r, 15000)` se congelaba porque Cloud Run **throttleaba la CPU** al no haber request HTTP activo (el scrape corre en background).

**Solución:** `--no-cpu-throttling` para mantener la CPU siempre asignada.

### 2.3 ONPE devuelve página sin datos desde algunas IPs de GCP

En algunas instancias, el extractor devolvía `keikoVotes: 0, robertoVotes: 0` porque la página HTML cargaba pero el JavaScript de ONPE no renderizaba los datos. El problema era intermitente: 2 de 3 instancias obtenían datos correctamente.

**Solución:** Mantener `min-instances=1` con `--no-cpu-throttling` y reintentos. Si una instancia obtiene datos, las siguientes usan el cache.

### 2.4 El flag `isFetching` se quedaba atascado

Cuando el scrape fallaba, el flag `isFetching` no se reseteaba, bloqueando futuros intentos de scrape.

**Solución:** Stale check en el `setInterval` de 45s que fuerza `isFetching = false` si lleva más de 180s en ese estado.

---

## 3. Cambios realizados

### Cloud Run (`gcloud` flags)

| Flag | Valor | Razón |
|------|-------|-------|
| `--memory` | `2Gi` | Chrome necesita ~1GB para arrancar |
| `--execution-environment` | `gen1` | Gen 2 usa gVisor que bloquea syscalls de Chrome |
| `--no-cpu-throttling` | `true` | Evita que el `setTimeout(15s)` del scraper se duerma |
| `--min-instances` | `1` | Una instancia siempre viva (costo mínimo) |

### Server.js

| Cambio | Archivo | Descripción |
|--------|---------|-------------|
| Separar lanzamiento de Chrome del timeout de scrape | `server.js` | Chrome tiene sus propios 3 reintentos; una vez lanzado, el scrape tiene 120s independientes |
| Recrear browser en retry si error es fatal | `server.js` | Si Chrome crashea (`Connection closed`), se cierra y se obtiene uno nuevo en el segundo intento |
| Stale check en intervalo | `server.js` | Cada 45s verifica si `isFetching` está atascado (>180s) y lo resetea |
| Cache siempre servida (nunca null) | `server.js` | `/api/results` devuelve datos cacheados inmediatamente; si están stale (>60s), dispara refresh en background |
| `_meta` extendido | `server.js` | Nuevos campos: `isFetching`, `hasData`, `error`, `consecutiveErrors` |
| Firestore graceful degradation | `server.js` | Si Firestore no está disponible (local), el servidor sigue funcionando sin crashear |
| Scrape secuencial en vez de paralelo | `server.js` | Evita contention de recursos en Cloud Run |
| `page.goto` sin request interception | `server.js` | La interceptación de requests causaba cuelgues en Cloud Run |
| Wait de 15s después de carga | `server.js` | Da tiempo al JS de ONPE para renderizar los datos (antes 3-5s) |

### Frontend (index.html)

| Cambio | Descripción |
|--------|-------------|
| `hasShownData` flag | Si ya mostró datos una vez, no vuelve a mostrar el spinner |
| `fetchInProgress` flag | Evita múltiples fetches simultáneos |
| Mostrar cached data con freshness | Si el servidor devuelve datos cacheados, se muestran con indicador de antigüedad |
| `isFetching` en UI | Si el servidor está scrapeando, muestra "Actualizando..." |
| Errores contextuales | Diferentes mensajes según `consecutiveErrors` y `hasData` |
| Retry count en loading | Muestra "(intento X)" mientras intenta conectar |

### Dockerfile

| Cambio | Descripción |
|--------|-------------|
| `node:20` (full, no slim) + `chromium --no-install-recommends` | Balance entre dependencias del sistema y tiempo de build |
| `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` | Usa el chromium del sistema |
| `PUPPETEER_EXECUTABLE_PATH` seteado vía Cloud Run env var | Apunta a `/usr/bin/chromium` |

---

## 4. Verificación

### Prueba local (antes de deploy)
```
=== TEST LOCAL ONPE SCRAPER ===
Actas: 98.269%
Keiko: 9,037,236 votos
Roberto: 9,035,572 votos
=== TEST LOCAL: EXITO ===
```

### Producción (post-deploy)
```json
{
  "candidate1": { "votes": 9037236 },
  "candidate2": { "votes": 9035572 },
  "actasContabilizadas": 98.269,
  "_meta": { "hasData": true, "isFetching": false, "scrapeDurationMs": 35117 }
}
```

---

## 5. Lecciones aprendidas

1. **`--no-cpu-throttling` es crítico para scrapers en Cloud Run.** Sin él, cualquier `setTimeout`/`setInterval` durante periodos sin requests se congela.

2. **Chrome en Cloud Run es intermitente.** Incluso con la imagen correcta, Chrome arranca en ~30% de instancias. Mantener `min-instances > 0` y reintentos es esencial.

3. **No mezclar timeout de arranque de Chrome con timeout de scrape.** Si Chrome tarda 90s en arrancar (3 intentos × 30s), el scrape solo tiene 30s restantes de un timeout de 120s.

4. **Siempre servir datos cacheados.** Nunca devolver 503 o bloquear la UI esperando el scrape. Mostrar lo último conocido mientras se actualiza en background.

5. **Probar localmente primero.** El scraper funcionaba perfecto desde local (IP residencial). Los problemas eran exclusivos del entorno Cloud Run.

---

## 6. Configuración actual de Cloud Run

```
Servicio:   onpe-backend
Región:     us-central1
Memoria:    2 GiB
CPU:        Siempre asignada (no-cpu-throttling)
Mín instancias: 1
Entorno:    Gen 1
Imagen:     node:20 + chromium (Debian)
Scrape:     Cada 45s (setInterval), timeout 120s
```
