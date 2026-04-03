---
name: CC Sprint Management
description: Create, update, and manage sprints and tasks on the Command Center sprint board
---

# Sprint Management

Manage the sprint lifecycle: create sprints, add tasks, update status, close sprints, move completed sprints to Hall of Fame.

## When to use
- Titus or Will asks to create a new sprint
- Tasks need to be added, updated, or reorganized
- A sprint needs to be closed and archived

## Sprint Lifecycle
1. **Create sprint** — name, description, start date
2. **Add tasks** — title, description, assignee, priority, category
3. **Work tasks** — status flows: queued → in_progress → complete
4. **Close sprint** — all tasks complete or explicitly closed
5. **Hall of Fame** — completed sprints appear in the Hall of Fame section

## Task Fields
```json
{
  "title": "S[sprint]-[number]: Task name",
  "description": "What needs to happen. Done when: [success criteria]",
  "category": "backend|frontend|ui|new-feature|bug-fix|infra",
  "status": "queued|in_progress|complete",
  "priority": 1,
  "assignee": "socrates|atlas|da-vinci|titus|forge",
  "sprint_id": 9
}
```

## Naming Convention
Tasks follow: `S[sprint_number]-[task_number]: [Title]`
Example: `S9-004: Validate MRR dry run with templates`

## API Calls
```bash
# Create sprint
curl -X POST .../api/sprints -d '{"name": "Sprint 10: Skills Architecture", "description": "..."}'

# Create task
curl -X POST .../api/tasks -d '{"title": "S10-001: ...", "sprint_id": 10, "assignee": "socrates", ...}'

# Update task status
curl -X PATCH .../api/tasks/42 -d '{"status": "in_progress"}'

# Close sprint
curl -X PATCH .../api/sprints/10 -d '{"status": "complete"}'
```

## Rules
- Every task has ONE assignee
- Every task has a "Done when:" in the description
- Update task status at each state change — don't batch
- Sprint names should be descriptive: "Sprint N: [Theme]"
- Keep tasks granular — one PR per task is ideal
