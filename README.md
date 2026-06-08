# Monitor Elecciones Perú - ONPE 2026

Monitoreo en tiempo real de los resultados de la **Segunda Vuelta Electoral 2026** de la ONPE (Oficina Nacional de Procesos Electorales del Perú).

## Candidatos

| Candidato | Partido | Color |
|-----------|---------|-------|
| Keiko Fujimori | Fuerza Popular | `#e91e63` |
| Roberto Sánchez | Juntos por el Perú | `#2196f3` |

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend / Scraping | Node.js 18+, Express, Puppeteer |
| Frontend | HTML5, CSS3, Vanilla JS (SPA) |
| Túnel público | Cloudflare Tunnel (`cloudflared`) |
| Hosting estático | Firebase Hosting |
| CI/CD | GitHub Actions (auto-deploy a Firebase en push a `main`) |
| Servicio cloud (opcional) | Render.com |

---

## Flujo Funcional

```
ONPE (web oficial)        Node.js + Puppeteer         Express API
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│ resultadosegunda  │──1──→│  Scraping cada    │──2──→│ GET /api/results  │
│ vuelta.onpe.gob.pe│      │  60 segundos      │      │ GET /api/status   │
└──────────────────┘      └──────────────────┘      │ GET /api/candidates│
                                                      └────────┬─────────┘
                                                               │
                                          Cloudflare Tunnel     │
                                          ┌──────────────────┐  │
                                          │ trycloudflare.com│←─3──┘
                                          └────────┬─────────┘
                                                   │
    Usuario ←──5── Firebase Hosting ←──4── index.html (fetch API)
```

1. **Puppeteer** abre la web oficial de la ONPE, espera que cargue, extrae votos y % de actas del DOM.
2. El servidor **Express** cachea los datos en memoria y los expone vía API REST.
3. **Cloudflare Tunnel** expone `localhost:3000` a internet con una URL pública temporal.
4. El **frontend** (`public/index.html`) hace `fetch` cada 60s a la API.
5. **Firebase Hosting** sirve el frontend estático al usuario final.

---

## Requisitos Previos

Para ejecutar el proyecto necesitas tener instalado:

| Herramienta | Versión | Verificar con |
|-------------|---------|---------------|
| **Node.js** | 18+ | `node --version` |
| **npm** | 9+ | `npm --version` |
| **cloudflared** | latest | `cloudflared --version` |
| **Git** | cualquiera | `git --version` |

### Instalar cloudflared (Windows)

```powershell
winget install Cloudflare.cloudflared
```

O descargar desde: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

---

## Instalación

```bash
git clone <repo-url>
cd onpe
npm install
```

---

## Ejecución Local

### 1. Levantar el servidor

```bash
npm start
```

Esto inicia Express en `http://localhost:3000`. El servidor automáticamente hace un primer scraping a los 5 segundos de iniciar y luego cada 60 segundos.

### 2. Exponer con Cloudflare Tunnel (para acceso público)

En otra terminal:

```bash
cloudflared tunnel --url http://localhost:3000
```

Esto genera una URL pública tipo `https://xxxx.trycloudflare.com`.

### 3. Actualizar la URL en el frontend

Editar `public/index.html`, línea con `API_URL`:

```js
const API_URL = 'https://TU-URL.trycloudflare.com/api';
```

### 4. Abrir el dashboard

- **Local:** `http://localhost:3000`
- **Internet (vía tunnel):** La URL que te dio `cloudflared`
- **Firebase Hosting:** `https://onpe-elecciones-2026.web.app` (requiere deploy previo)

---

## API Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/results` | Resultados cacheados (votos, %, timestamp) |
| `GET` | `/api/candidates` | Metadata de candidatos |
| `GET` | `/api/status` | Estado del servidor (lastFetch, hasData, isFetching) |
| `GET` | `/api/refresh` | Forzar refresh inmediato del scraping |

### Ejemplo de respuesta `/api/results`

```json
{
  "candidate1": {
    "name": "Keiko Fujimori",
    "party": "Fuerza Popular",
    "color": "#e91e63",
    "votes": 8823951
  },
  "candidate2": {
    "name": "Roberto Sánchez",
    "party": "Juntos por el Perú",
    "color": "#2196f3",
    "votes": 8851468
  },
  "actasContabilizadas": 94.714,
  "timestamp": "2026-06-08T21:33:21.883Z"
}
```

---

## Despliegue

### Firebase Hosting (frontend estático)

El deploy a Firebase es automático vía GitHub Actions al hacer push a `main`.

```bash
# Manual si se requiere
npx firebase-tools deploy --only hosting --project onpe-elecciones-2026
```

### Render.com (backend)

El archivo `render.yaml` define el servicio. Para desplegar:

1. Conectar el repositorio de GitHub en [render.com](https://render.com)
2. Crear un **Web Service** apuntando al repo
3. Render detecta `render.yaml` automáticamente:
   - Build: `npm install`
   - Start: `npm start`
   - Runtime: Node.js

---

## Mantenimiento

- La URL del túnel de Cloudflare es **temporal**. Si el túnel se reinicia, hay que actualizar `API_URL` en `public/index.html` y redeployar a Firebase.
- Si la ONPE cambia la estructura HTML de su web, el scraping en `server.js` puede romperse y requerir ajustes en la función `fetchONPEData()`.
