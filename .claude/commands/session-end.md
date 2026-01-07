---
description: Document session work and create tasks for future sessions
---

# Session End - Documentation & Tasks

Use this at the end of a coding session to document what was accomplished and create tasks for future work.

## Instructions

### 1. Review Session Changes

Check what was modified during this session:

```bash
# See all modified files
git status

# See detailed changes
git diff

# See staged changes
git diff --cached
```

### 2. Update Session History (REQUIRED)

**Add a new entry to the session history file:**

Read the current file:
```bash
cat .claude/docs/sessions.md
```

Then add a new session entry at the top (after the header), using this format:

```markdown
## Session: YYYY-MM-DD

### Summary
Brief description of main work done.

### What Was Accomplished
- [x] Task 1
- [x] Task 2
- [ ] Incomplete task (carried to next session)

### Key Changes
| File | Change |
|------|--------|
| `path/to/file` | Description of change |

### Technical Decisions
1. **Decision name**: Rationale for the decision

### Architecture Notes
Document any important architectural details for future reference.

### Next Tasks
- [ ] High priority task
- [ ] Medium priority task
```

### 3. Document Completed Work

**For algorithm changes:**
- Update inline comments explaining the logic
- Document any new parameters or behaviors in sessions.md

**For new features:**
- Add usage examples
- Document any configuration options

**For bug fixes:**
- Note the root cause
- Document the solution approach

### 4. Identify Remaining Tasks

Check for incomplete work:

```bash
# Find TODOs added this session
git diff | grep -E "^\+.*TODO|^\+.*FIXME"

# Check for console.log statements to remove
grep -r "console.log" src/ --include="*.ts" --include="*.tsx" | head -10

# Check for debug flags that should be disabled
grep -r "DEBUG.*=.*true" src/ --include="*.ts" --include="*.tsx"
```

### 5. Verification Checklist

Before ending the session:

```bash
# 1. Build passes
npm run build

# 2. No TypeScript errors
npx tsc --noEmit

# 3. Take final verification screenshot
node .claude/scripts/screenshot-editor.js

# 4. Check for debug code to remove
grep -r "console.log\|debugger" src/ --include="*.ts" --include="*.tsx"
```

### 6. Create Commit (if requested)

When ready to commit:

```bash
# Stage changes
git add -A

# Create descriptive commit
git commit -m "feat: description of changes

- Detail 1
- Detail 2

🤖 Generated with Claude Code"
```

## Session Summary Template

Use this structure when updating `.claude/docs/sessions.md`:

```markdown
## Session: YYYY-MM-DD

### Summary
One-line description of main accomplishment.

### What Was Accomplished
- [x] Completed task
- [ ] Incomplete task (for next session)

### Key Changes
| File | Change |
|------|--------|
| `path/to/file` | Description |

### Technical Decisions
1. **Decision**: Rationale

### Architecture Notes
Important details about implementation for future reference.

### Next Tasks
- [ ] Task 1 - Priority
- [ ] Task 2 - Priority
```

## Quick Reference

| Task | Command |
|------|---------|
| Check changes | `git diff` |
| Stage all | `git add -A` |
| Commit | `git commit -m "message"` |
| Build check | `npm run build` |
| Screenshot | `node .claude/scripts/screenshot-editor.js` |
| View sessions | `cat .claude/docs/sessions.md` |
