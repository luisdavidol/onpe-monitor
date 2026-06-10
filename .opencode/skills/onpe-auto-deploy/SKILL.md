---
name: onpe-auto-deploy
description: Use when working on the ONPE Elecciones 2026 monitor project (D:\GIT\onpe). After making and verifying changes, automatically deploy to Firebase Hosting and push to GitHub without being asked. Do NOT deploy or push if tests fail.
---

# ONPE Auto Deploy

## Project Info
- **Working directory:** `D:\GIT\onpe`
- **Firebase project:** `onpe-elecciones-2026`
- **Firebase Hosting URL:** `https://onpe-elecciones-2026.web.app`
- **Local server:** `http://localhost:3000`
- **Cloudflare Tunnel:** exposes `localhost:3000` via `cloudflared tunnel --url http://localhost:3000`

## Auto-Deploy Workflow

After completing ANY change to the project (HTML, JS, CSS, server, etc.), you MUST execute this workflow automatically — do NOT wait for the user to ask:

### Step 1: Verify local server is running
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/status" -UseBasicParsing -TimeoutSec 5
```
If OFF, start it: `Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "D:\GIT\onpe" -WindowStyle Hidden`

### Step 2: Run health check
```powershell
powershell -ExecutionPolicy Bypass -File "D:\GIT\onpe\health-check.ps1"
```
All 4 components MUST be ON. If not, fix issues before proceeding.

### Step 3: Verify API returns valid data
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/results" -UseBasicParsing -TimeoutSec 5
```
Must return valid `candidate1`, `candidate2`, and `actasContabilizadas` fields.

### Step 4: Deploy to Firebase Hosting
```powershell
npx -y firebase-tools@latest deploy --only hosting --project onpe-elecciones-2026
```
Working directory: `D:\GIT\onpe`

### Step 5: Commit and push to GitHub
```powershell
git add -A
git commit -m "<concise English commit message describing changes>"
git push
```
Working directory: `D:\GIT\onpe`

## Rules
- NEVER skip verification steps — if any verification fails, STOP and report the error
- NEVER deploy or push if tests fail
- Use concise commit messages in English
- If Cloudflare Tunnel URL changed, update `API_URL` in `public/index.html` before deploying
- Report a one-line summary to the user when done
