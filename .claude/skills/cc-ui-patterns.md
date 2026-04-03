---
name: CC UI Patterns
description: Command Center frontend patterns — vanilla JS, Socket.io real-time updates, BMP design system. Use when building or modifying CC dashboard UI.
---

# Command Center UI Patterns

The CC frontend is a single HTML file (public/index.html) with embedded CSS and JS. No framework, no build step.

## Architecture
- Single `index.html` with `<style>` and `<script>` tags
- Socket.io client for real-time updates
- Fetch API for data loading
- DOM manipulation for rendering (no virtual DOM)

## Design System (BMP)
- **Background:** dark charcoal (#1a1a2e, #16213e)
- **Accent:** warm amber/gold (#d4a574, #c9956b)
- **Success:** muted green (#4a7c59)
- **Text:** warm white (#e8e0d8)
- **Cards:** subtle border glow on hover, rounded corners
- **Status dots:** pulsing green (online), grey (offline)
- **Progress bars:** gradient fills, animated

## Real-Time Patterns
```javascript
// Listen for new messages
socket.on('new-message', (msg) => {
  // Append to message list, update unread badge
});

// Listen for task updates
socket.on('task-updated', (task) => {
  // Re-render the task card in place
});

// Listen for heartbeat
socket.on('heartbeat-update', (data) => {
  // Update agent status dot
});
```

## Key Sections
- **Dashboard** — agent roster with heartbeat dots, quick stats
- **Sprint Board** — Kanban-style task cards (queued/in-progress/complete)
- **Conference Room** — comms interface, channel tabs, message list
- **Hall of Fame** — completed sprints

## Rules
- Always preserve input focus during real-time updates (don't re-render while user is typing)
- Favicon unread badge updates on new messages
- No page reloads — everything is Socket.io driven
- Mobile responsive but desktop-first
- Iterate with targeted edits — don't rewrite the entire index.html
