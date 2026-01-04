---
description: Gain context about the PedalSchema project at the start of a session
---

# Session Start - Project Context

Use this at the beginning of a coding session to quickly understand the project state and recent work.

## Instructions

### 1. Read Project Overview

Read the main documentation to understand the project:

```bash
# Read project README
cat README.md

# Check package.json for dependencies and scripts
cat package.json | head -50
```

### 2. Check Recent Git Activity

Understand what has been worked on recently:

```bash
# Recent commits
git log --oneline -15

# Current branch and status
git status

# Recent changes
git diff --stat HEAD~5
```

### 3. Review Project Structure

Key directories and their purposes:

| Directory | Purpose |
|-----------|---------|
| `src/app/` | Next.js app router pages |
| `src/components/` | React components (UI, editor, layout) |
| `src/lib/engine/` | Core logic (cables, collision, layout) |
| `src/store/` | Zustand state management |
| `src/types/` | TypeScript type definitions |
| `.claude/` | Claude Code scripts and commands |

### 4. Check for Active Issues

```bash
# Check for TODO comments in recent files
grep -r "TODO\|FIXME\|HACK" src/ --include="*.ts" --include="*.tsx" | head -20
```

### 5. Review Key Files Based on Context

**For layout/optimization work:**
- `src/lib/engine/layout/index.ts` - Pedal layout algorithm
- `src/lib/engine/collision/index.ts` - Collision detection
- `src/store/configuration-store.ts` - State management

**For cable/wiring work:**
- `src/lib/engine/cables/index.ts` - Cable generation
- `src/components/editor/panels/cable-list-panel.tsx` - Cable UI

**For UI work:**
- `src/components/editor/canvas/` - Canvas rendering
- `src/components/editor/panels/` - Side panels

### 6. Check Dev Environment

```bash
# Ensure dependencies are installed
npm install

# Check if dev server is running
lsof -i :3000 || echo "Dev server not running - start with: npm run dev"
```

## Summary Template

After gathering context, summarize:

1. **Project State**: What's the current state of the codebase?
2. **Recent Work**: What was worked on in recent commits?
3. **Open Issues**: Any TODOs, FIXMEs, or known issues?
4. **Ready to Work**: Is the dev environment ready?

## Quick Start Commands

```bash
# Start dev server
npm run dev

# Run type check
npm run build

# Take verification screenshot
node .claude/scripts/screenshot-optimize.js
```
