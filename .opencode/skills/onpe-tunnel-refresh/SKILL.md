---
name: onpe-tunnel-refresh
description: Use when the Cloudflare Tunnel restarts and a new trycloudflare.com URL is generated. Run this skill to capture the new URL, update index.html, test the API, and redeploy to Firebase Hosting. Also use whenever the user says the site is down or needs the tunnel refreshed.
---

# ONPE Tunnel Refresh

## When to Use
- Cloudflare Tunnel restarted (new `trycloudflare.com` URL)
- User says "la web está caída" or "levanta la web"
- User asks to refresh/renew the tunnel

## Project Info
- **Working directory:** `D:\GIT\onpe`
- **Firebase project:** `onpe-elecciones-2026`
- **Firebase Hosting URL:** `https://onpe-elecciones-2026.web.app`
- **Local server:** `http://localhost:3000`
- **API_URL location:** `D:\GIT\onpe\public\index.html` (JS const)

## Step-by-Step Workflow

Execute each step SEQUENTIALLY — do NOT run steps in parallel. Wait for each to complete before proceeding.

### Step 1: Kill existing cloudflared, restart with output capture
```powershell
Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process -FilePath "cloudflared" -ArgumentList "tunnel --url http://localhost:3000" -RedirectStandardOutput "$env:TEMP\cloudflare-tunnel.txt" -NoNewWindow
Start-Sleep -Seconds 8
Get-Content "$env:TEMP\cloudflare-tunnel.txt" -Tail 20
```
Parse the output to extract the new tunnel URL (e.g. `https://xxxx.trycloudflare.com`).

### Step 2: Update API_URL in public/index.html
Replace the old `API_URL` line with the new tunnel URL:
```
const API_URL = 'https://<NEW-URL>.trycloudflare.com/api';
```

### Step 3: Verify local server is running
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/status" -UseBasicParsing -TimeoutSec 5
```
If OFF, start it: `Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory "D:\GIT\onpe" -WindowStyle Minimized`

### Step 4: Test the API through the new tunnel URL
```powershell
$url = "<NEW-TUNNEL-URL>/api/status"
Invoke-RestMethod -Uri $url -UseBasicParsing -TimeoutSec 15
```
Then test results:
```powershell
$url = "<NEW-TUNNEL-URL>/api/results"
Invoke-RestMethod -Uri $url -UseBasicParsing -TimeoutSec 15
```
Must return valid JSON with `candidate1`, `candidate2`, `actasContabilizadas`.

### Step 5: Deploy to Firebase Hosting
```powershell
npx -y firebase-tools@latest deploy --only hosting --project onpe-elecciones-2026
```
Working directory: `D:\GIT\onpe`

### Step 6: Verify Firebase Hosting URL
```powershell
Invoke-WebRequest -Uri "https://onpe-elecciones-2026.web.app" -UseBasicParsing -TimeoutSec 15
```
Must return HTTP 200.

### Step 7: Commit and push to GitHub
```powershell
git add -A
git commit -m "Update Cloudflare Tunnel URL to <NEW_SHORT_ID>"
git push
```
Working directory: `D:\GIT\onpe`

## Rules
- Execute steps SEQUENTIALLY, never in parallel
- If any verification fails, STOP and report the error — do NOT proceed to deploy
- Use concise English commit messages
- Report the final Firebase Hosting URL and tunnel URL to the user
