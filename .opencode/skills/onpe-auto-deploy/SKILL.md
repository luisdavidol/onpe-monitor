---
name: onpe-auto-deploy
description: Use when working on the ONPE Elecciones 2026 monitor project (D:\GIT\onpe). After making and verifying changes, automatically deploy to Firebase Hosting (frontend) and/or Cloud Run (backend), then push to GitHub. Do NOT deploy or push if verification fails.
---

# ONPE Auto Deploy

## Project Info
- **Working directory:** `D:\GIT\onpe`
- **Firebase project:** `onpe-elecciones-2026`
- **Firebase Hosting URL:** `https://onpe-elecciones-2026.web.app`
- **Cloud Run backend URL:** `https://onpe-backend-656880564600.us-central1.run.app`
- **Firestore DB:** `social/stats` — NUNCA modificar ni eliminar la base de datos

## Infrastructure

| Layer | Tech | Deploy command |
|-------|------|---------------|
| Frontend | Firebase Hosting | `npx firebase-tools deploy --only hosting` |
| Backend | Cloud Run (Docker) | `gcloud run deploy onpe-backend --source .` |
| Database | Firestore (Native) | NO se despliega — datos persistentes |

## Auto-Deploy Workflow

After completing ANY change to the project, you MUST execute this workflow automatically — do NOT wait for the user to ask:

### Step 1: Identify what changed

Determine which layer(s) were modified:

| Changed files | Affects |
|--------------|---------|
| `public/**`, `firebase.json` | Frontend |
| `server.js`, `package*.json`, `Dockerfile`, `.dockerignore` | Backend |
| Both sets | Both |

### Step 2: Verify Cloud Run API is healthy

```powershell
Invoke-RestMethod -Uri "https://onpe-backend-656880564600.us-central1.run.app/api/status" -UseBasicParsing -TimeoutSec 10
```

### Step 3: Deploy frontend (if changed)

```powershell
npx firebase-tools deploy --only hosting --project onpe-elecciones-2026
```
Working directory: `D:\GIT\onpe`

### Step 4: Deploy backend (if changed)

```powershell
& "$env:LOCALAPPDATA\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd" run deploy onpe-backend --source . --region=us-central1 --allow-unauthenticated --project=onpe-elecciones-2026 --quiet
```
Working directory: `D:\GIT\onpe`

### Step 5: Verify deployed API

```powershell
Invoke-RestMethod -Uri "https://onpe-backend-656880564600.us-central1.run.app/api/status" -UseBasicParsing -TimeoutSec 10
```

### Step 6: Verify Firebase Hosting

```powershell
$response = Invoke-WebRequest -Uri "https://onpe-elecciones-2026.web.app" -UseBasicParsing
$response.StatusCode  # must be 200
```

### Step 7: Commit and push to GitHub

```powershell
git add -A
git commit -m "<concise English commit message describing changes>"
git push
```
Working directory: `D:\GIT\onpe`

## Rules

- **NEVER** skip verification steps — if any verification fails, STOP and report the error
- **NEVER** deploy or push if verification fails
- **NEVER** modify, delete, or re-create the Firestore database or the `social/stats` document
- **NEVER** deploy only part of the changes — if both frontend and backend changed, deploy both
- Use concise commit messages in English
- Only deploy the layer(s) that actually changed (skip unchanged layers)
- Report a one-line summary to the user when done
