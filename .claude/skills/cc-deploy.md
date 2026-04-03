---
name: CC Deploy
description: Deploy Command Center changes to Railway production — push to main, verify deploy, check runtime health
---

# CC Deploy

Push Command Center changes to production via GitHub (auto-deploys on Railway).

## When to use
- After making changes to server.js, db.js, or public/index.html
- When Titus asks to deploy a CC fix or feature

## How to execute

### Step 1 — Verify changes locally
```bash
cd C:/Users/willg/OneDrive/Desktop/socrates-monitor
# Check what changed
git diff
git status
```

### Step 2 — Commit and push
```bash
git add -A
git commit -m "feat: [description]"
git push origin main
```
Railway auto-deploys from main. No staging gate for CC.

### Step 3 — Verify deploy
Wait 30-60 seconds for Railway build, then:
```bash
# Health check
curl -s https://bmp-command-center-production.up.railway.app/api/heartbeat

# Verify specific feature
curl -s https://bmp-command-center-production.up.railway.app/api/tasks | head -c 500
```

### Step 4 — Verify Socket.io
Open the dashboard in browser or check that real-time events still fire:
```bash
curl -s https://bmp-command-center-production.up.railway.app/ | head -c 200
```

## Rules
- NEVER push if server.js has syntax errors — test with `node -c server.js` first
- Socket.io events must still fire after changes
- If the deploy breaks comms, every agent goes dark — treat as P0
- No staging gate — but test locally first
