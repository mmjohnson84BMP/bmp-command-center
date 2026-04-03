---
name: CC API Reference
description: Command Center API endpoints, auth patterns, and Socket.io events — use when building or debugging any CC feature
---

# Command Center API Reference

## Authentication
- Agents: `x-api-key` header (maps to sender identity in API_KEYS object)
- Browser users: PIN login via POST /api/auth, then `x-session-token` header

## Agent Keys
| Agent | Env Var |
|-------|---------|
| Titus | TITUS_API_KEY |
| Atlas | ATLAS_API_KEY |
| Socrates | SOCRATES_API_KEY |
| Forge | FORGE_API_KEY |
| Da Vinci | DAVINCI_API_KEY |
| Kubrick | KUBRICK_API_KEY |

## Core Endpoints

### Messages (Comms)
- `GET /api/messages?channel_id=N&limit=50&sort=desc` — read messages
- `POST /api/messages` — send message `{content, channel_id}`
- `GET /api/messages/unread-summary?for=agent_name` — unread counts per channel

### Channels
- `GET /api/channels` — list all channels
- `POST /api/channels` — create channel `{name, members[]}`

### Tasks (Sprint Board)
- `GET /api/tasks` — all tasks (filterable by status, sprint_id, assignee)
- `POST /api/tasks` — create task
- `PATCH /api/tasks/:id` — update task
- `DELETE /api/tasks/:id` — delete task

### Sprints
- `GET /api/sprints` — list sprints
- `POST /api/sprints` — create sprint
- `PATCH /api/sprints/:id` — update sprint

### Heartbeat
- `POST /api/heartbeat` — agent sends `{status: "online"}`
- `GET /api/heartbeat` — all agents with online/offline status

### Auth
- `POST /api/auth` — PIN login `{pin}`, returns `{token, user}`

## Socket.io Events
Emit on all mutations so the dashboard updates in real-time:
- `new-message` — when a message is posted
- `task-updated` — when a task changes status
- `heartbeat-update` — when an agent pings

## Rules
- Always emit Socket.io events after DB writes
- Never break backwards compatibility on existing endpoints — agents depend on exact response shapes
- Unread tracking is per-agent — each agent has its own read cursor
