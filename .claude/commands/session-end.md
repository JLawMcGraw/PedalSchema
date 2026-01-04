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

### 2. Document Completed Work

Create or update documentation for significant changes:

**For algorithm changes:**
- Update inline comments explaining the logic
- Document any new parameters or behaviors

**For new features:**
- Add usage examples
- Document any configuration options

**For bug fixes:**
- Note the root cause
- Document the solution approach

### 3. Identify Remaining Tasks

Check for incomplete work:

```bash
# Find TODOs added this session
git diff | grep -E "^\+.*TODO|^\+.*FIXME"

# Check for console.log statements to remove
grep -r "console.log" src/ --include="*.ts" --include="*.tsx" | head -10
```

### 4. Update Project Tasks

If there's a tasks file, update it with:
- Completed items (mark as done)
- New items discovered during work
- Blockers or dependencies

### 5. Create Commit (if requested)

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

Document the session with this structure:

### What Was Accomplished
- [ ] List completed tasks
- [ ] Features implemented
- [ ] Bugs fixed

### Key Changes Made
| File | Change |
|------|--------|
| `path/to/file` | Description of change |

### Technical Decisions
- Decision 1: Rationale
- Decision 2: Rationale

### Known Issues / TODOs
- [ ] Issue 1 - Priority
- [ ] Issue 2 - Priority

### Next Session Tasks
1. High priority task
2. Medium priority task
3. Low priority task

### Testing Status
- [ ] Manual testing completed
- [ ] Screenshots verified
- [ ] No console errors

## Verification Checklist

Before ending the session:

```bash
# 1. Build passes
npm run build

# 2. No TypeScript errors
npx tsc --noEmit

# 3. Take final verification screenshot
node .claude/scripts/screenshot-optimize.js

# 4. Check for debug code to remove
grep -r "console.log\|debugger" src/ --include="*.ts" --include="*.tsx"
```

## Quick Reference

| Task | Command |
|------|---------|
| Check changes | `git diff` |
| Stage all | `git add -A` |
| Commit | `git commit -m "message"` |
| Build check | `npm run build` |
| Screenshot | `node .claude/scripts/screenshot-optimize.js` |
