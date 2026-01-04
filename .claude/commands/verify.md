---
description: Verify Claude's work by taking screenshots and checking the app
---

# Verification Skill

Use this skill to verify that changes work correctly in the running application.

## Prerequisites

- Dev server must be running (`npm run dev`)
- For authenticated pages, `.env.local` must have VERIFY_EMAIL and VERIFY_PASSWORD set

## Instructions

### 1. Determine What to Verify

Ask the user what they want to verify, or infer from recent changes:
- **UI changes**: Take a screenshot of the affected page
- **Data/state**: Check browser console or state

### 2. For UI Verification

Take a screenshot using the screenshot script:

```bash
# Public pages (login, signup)
node .claude/scripts/screenshot.js http://localhost:3000/<page>

# Authenticated pages (dashboard, editor, etc.)
node .claude/scripts/screenshot.js http://localhost:3000/<page> --auth

# Full page screenshot
node .claude/scripts/screenshot.js http://localhost:3000/<page> --auth --full

# Wait longer for dynamic content
node .claude/scripts/screenshot.js http://localhost:3000/<page> --auth --wait 3000
```

After taking the screenshot:
1. Read the screenshot file using the Read tool
2. Analyze the visual output
3. Report what you see and whether it matches expectations

### 3. Report Findings

Always include:
- What you checked
- What you found (with evidence: screenshot path)
- Whether it matches expectations
- Any issues discovered

## Common Verification Scenarios

| Change Type | Verification Method |
|-------------|---------------------|
| Pedal placement | Screenshot the editor page |
| Cable rendering | Screenshot with cables visible |
| Optimize layout | Screenshot before/after optimize |
| Signal chain | Screenshot the chain panel |

## Example Usage

User: "Check if the cables are rendering correctly"

Claude:
1. Takes screenshot: `node .claude/scripts/screenshot.js http://localhost:3000/editor/new --auth --wait 2000`
2. Reads the screenshot
3. Reports findings about cable visibility
