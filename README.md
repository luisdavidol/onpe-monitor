# Monitor Elecciones Peru - ONPE 2026

Monitoreo en tiempo real de los resultados de la **Segunda Vuelta Electoral 2026** de la ONPE (Oficina Nacional de Procesos Electorales del Peru).

## Candidatos

| Candidato | Partido | Color |
|-----------|---------|-------|
| Keiko Fujimori | Fuerza Popular | `#e91e63` |
| Roberto Sanchez | Juntos por el Peru | `#2196f3` |

---

## Stack Tecnologico

| Capa | Tecnologia | Host |
|------|-----------|------|
| Backend / Scraping | Node.js 20, Express, Puppeteer + Chromium | **Google Cloud Run** |
| Base de Datos | **Firestore** (Firebase) | Google Cloud |
| Frontend | HTML5, CSS3, Vanilla JS (SPA) | **Firebase Hosting** |
| CI/CD | GitHub Actions (deploy condicional de frontend y backend via Cloud Build) | GitHub / Google Cloud |

---

## Flujo Funcional

```
ONPE (web oficial)          Cloud Run (Docker)          Firestore
+------------------+        +------------------+       +------------------+
| resultadosegunda |---1--->|  Puppeteer cada   |---2-->| social/stats     |
| vuelta.onpe.gob  |        |  60 segundos      |       | (views, likes,   |
+------------------+        +--------+---------+       |  comments)       |
                                     |                 +------------------+
                                     | API REST
                                     v
                            +------------------+
                            | Usuario final    |
                            | via Firebase     |
                            | Hosting          |
                            +------------------+
```

1. **Cloud Run** ejecuta Puppeteer cada 60s, scrapea la web oficial de la ONPE y cachea resultados en memoria.
2. **Firestore** almacena datos sociales (visitas, likes, comentarios) de forma persistente en la nube.
3. El **frontend** (`public/index.html`) hace `fetch` cada 60s a la API de Cloud Run via HTTPS.
4. **Firebase Hosting** sirve el frontend estatico al usuario final.

---

## API Endpoints

### Resultados Electorales

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET` | `/api/results` | Resultados cacheados (votos, %, timestamp) |
| `GET` | `/api/candidates` | Metadata de candidatos |
| `GET` | `/api/status` | Estado del servidor (lastFetch, hasData, isFetching) |
| `GET` | `/api/refresh` | Forzar refresh inmediato del scraping |

### Datos Sociales (Firestore)

| Metodo | Ruta | Descripcion |
|--------|------|-------------|
| `GET` | `/api/social` | Obtener contadores y comentarios |
| `POST` | `/api/social/view` | Incrementar contador de visitas |
| `POST` | `/api/social/like` | Incrementar contador de likes |
| `POST` | `/api/social/comment` | Agregar un comentario `{ name, text }` |

### Ejemplo de respuesta `/api/results`

```json
{
  "candidate1": {
    "name": "Keiko Fujimori",
    "party": "Fuerza Popular",
    "color": "#e91e63",
    "votes": 9014171
  },
  "candidate2": {
    "name": "Roberto Sanchez",
    "party": "Juntos por el Peru",
    "color": "#2196f3",
    "votes": 9020928
  },
  "actasContabilizadas": 97.982,
  "timestamp": "2026-06-11T01:13:29.942Z"
}
```

### Ejemplo de respuesta `/api/social`

```json
{
  "views": 7,
  "likes": 2,
  "comments": [
    {
      "id": "mq8ro6bwzu57p",
      "name": "Usuario",
      "text": "Comentario de ejemplo",
      "date": "2026-06-11T00:35:57.836Z"
    }
  ]
}
```

---

## Infraestructura Cloud

### Cloud Run (Backend)

- **URL:** `https://onpe-backend-656880564600.us-central1.run.app`
- **Region:** `us-central1`
- **Memoria:** 1 GiB
- **Timeout:** 300s
- **Build:** Dockerfile + Cloud Build (sin necesidad de Docker local)

### Firestore (Base de Datos)

- **Modo:** Native
- **Ubicacion:** `nam5` (multi-region US)
- **Documento:** `social/stats` — almacena `views`, `likes`, `comments[]`
- **Datos persistentes:** los likes y comentarios no se pierden aunque Cloud Run escale a cero

### Firebase Hosting (Frontend)

- **URL:** https://onpe-elecciones-2026.web.app
- **Deploy automatico:** GitHub Actions en push a `main`

---

## Desarrollo Local

### Requisitos

| Herramienta | Version | Verificar con |
|-------------|---------|---------------|
| Node.js | 20+ | `node --version` |
| npm | 9+ | `npm --version` |
| gcloud CLI | latest | `gcloud --version` |

### Instalacion

```bash
git clone https://github.com/luisdavidol/onpe-monitor.git
cd onpe
npm install
```

### Ejecutar localmente

```bash
npm start
```

Esto inicia Express en `http://localhost:3000`. Para que Firestore funcione localmente, autenticate con:

```bash
gcloud auth application-default login
```

---

## Despliegue

### Backend a Cloud Run

```bash
gcloud run deploy onpe-backend \
  --source . \
  --region=us-central1 \
  --allow-unauthenticated \
  --project=onpe-elecciones-2026
```

> Usa Cloud Build para construir la imagen Docker, no requiere Docker local.

### Frontend a Firebase Hosting

```bash
npx firebase-tools deploy --only hosting --project onpe-elecciones-2026
```

> Automatico via GitHub Actions en push a `main`.

---

## URLs de Produccion

| Servicio | URL |
|----------|-----|
| Sitio web | https://onpe-elecciones-2026.web.app |
| API Backend | https://onpe-backend-656880564600.us-central1.run.app/api |
| Cloud Run Console | https://console.cloud.google.com/run |
| Firestore Console | https://console.firebase.google.com/project/onpe-elecciones-2026/firestore |
