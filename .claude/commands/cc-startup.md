Load Command Center context and orient.

1. Read CLAUDE.md for identity and operating rules
2. Check production health: `curl -s https://bmp-command-center-production.up.railway.app/api/heartbeat`
3. Check for any recent errors in the app
4. Read `server.js` to refresh awareness of current API surface
5. Read `public/index.html` (first 100 lines) to refresh awareness of current UI state

Output a brief status: health, any issues, ready for work.