# CLAUDE.md - Verification Protocol

## CORE PRINCIPLE

Never claim something is "fixed," "working," or "complete" without verification proof.
"No errors thrown" ≠ verified working.
"Screenshot taken" ≠ visually confirmed.

You must PROVE correctness or explicitly state you CANNOT verify.

---

## VERIFICATION METHODS

### 1. VISUAL/SPATIAL (Frontend, Layout, Positioning, Component Structure)

**⚠️ DO NOT rely on screenshot interpretation for spatial/positional claims. Your visual reasoning is unreliable for this.**

#### Primary: Data Extraction + Mathematical Verification

1. **Extract coordinates/values from code or runtime state:**
   - DOM element positions and bounding boxes
   - Path/line coordinates
   - CSS computed values
   - Component tree structure
   - Canvas/SVG coordinates

2. **Verify mathematically:**
   ```
   EXAMPLE - Cable Routing:
   
   Cable path points: [(100,50), (150,50), (200,50), (300,50)]
   Boundary box: x:175-225, y:25-75
   
   Intersection check:
   - Point (100,50): Outside boundary ✓
   - Point (150,50): Outside boundary ✓
   - Point (200,50): x=200 falls within 175-225, y=50 falls within 25-75
     → INSIDE BOUNDARY ✗
   
   RESULT: FAILURE - Path passes through boundary at (200,50)
   ```

3. **Construct ASCII diagram from extracted data:**

   **Layout/Positioning:**
   ```
   Extracted positions:
   Pedal1: (50,100), size: 60x40
   Pedal2: (250,100), size: 60x40  
   Boundary: (140,80) to (180,120)
   Cable: (110,120) → (250,120)
   
   ASCII representation:
   
        50      110  140  180  250     310
        |        |    |    |    |       |
   80   +------+      +----+    +------+
        |Pedal1|------|BNDX|----+Pedal2|  ← Cable intersects boundary
   120  +------+      +----+    +------+
   
   FAILURE: Cable passes through boundary zone (140-180)
   ```

   **Component Hierarchy:**
   ```
   <App>
     ├─ <Header />
     ├─ <PedalBoard>
     │    ├─ <Pedal id="1" pos="50,100" />
     │    ├─ <Boundary rect="140,80,40,40" /> ← COLLISION ZONE
     │    └─ <Pedal id="2" pos="250,100" />
     └─ <CableLayer>
          └─ <Cable from="1" to="2" pathLength="4" status="INVALID" />
               └─ Error: Path intersects boundary at segment 2
   ```

#### Secondary: Screenshots (Evidence Only)

Screenshots are PROOF for the user, not your verification method.

**Before screenshot:**
```
Success criteria checklist:
- [ ] Cable routes around boundary (no intersection)
- [ ] All pedals render within board area
- [ ] Connection points align with pedal edges
```

**After screenshot:**
Describe what you actually observe, then cross-reference with your data extraction:
```
Screenshot shows cable running horizontally across board.
Cross-reference with extracted path data confirms:
- Path coordinates show intersection at (200,50)
- Screenshot is consistent with FAILURE state
```

---

### 2. API/BACKEND

**Execute real requests. Show real output. No paraphrasing.**

```bash
# Execute the actual request
curl -X POST http://localhost:3000/api/cocktails \
  -H "Content-Type: application/json" \
  -d '{"name": "Test", "ingredients": [...]}'

# Show raw response
{
  "id": 42,
  "name": "Test",
  "created": "2024-01-15T..."
}
```

**Verify against expected behavior:**
```
Expected: Response contains `id` field and returns 201
Actual: Response contains `id: 42`, status 201
RESULT: ✓ PASS
```

**For error fixes:**
```
Before: POST /api/cocktails returned 500 with "Cannot read property 'map' of undefined"
After: POST /api/cocktails returns 201 with valid response body
Test: [show actual curl output]
RESULT: ✓ PASS
```

---

### 3. DATABASE

**Run actual queries. Show actual results.**

```sql
-- Verify record was created
SELECT id, name, created_at FROM cocktails WHERE id = 42;

-- Actual result:
| id | name | created_at          |
|----|------|---------------------|
| 42 | Test | 2024-01-15 10:30:00 |

-- Expected: Record exists with correct name
-- RESULT: ✓ PASS
```

**For state changes:**
```
Before state:
SELECT status FROM orders WHERE id = 5; → 'pending'

After running fix:
SELECT status FROM orders WHERE id = 5; → 'completed'

RESULT: ✓ PASS - Status updated correctly
```

---

### 4. BUILD/COMPILATION

**"No errors" is insufficient. Confirm expected output exists.**

```bash
# Run build
npm run build

# Verify output (show actual output)
Build completed in 4.2s
✓ Compiled successfully
✓ Generated 23 pages

# Confirm artifacts exist
ls -la .next/
total 48
drwxr-xr-x  12 user  staff   384 Jan 15 10:30 .
drwxr-xr-x  45 user  staff  1440 Jan 15 10:30 ..
drwxr-xr-x   4 user  staff   128 Jan 15 10:30 cache
drwxr-xr-x   3 user  staff    96 Jan 15 10:30 server
drwxr-xr-x  26 user  staff   832 Jan 15 10:30 static

# Expected: .next directory with server and static folders
# RESULT: ✓ PASS
```

**For specific build fixes:**
```
Issue: Build failing on TypeScript error in utils/format.ts
Fix applied: Added type guard for nullable value

Build output after fix:
[show full relevant output]

Previous error no longer present: ✓
Build completes successfully: ✓
RESULT: ✓ PASS
```

---

### 5. UNIT/INTEGRATION TESTS

**When applicable, write a test that captures the fix:**

```typescript
// Test for cable routing fix
test('cable routes around boundary, not through it', () => {
  const cable = createCable(pedal1, pedal2);
  const boundary = { x: 175, y: 25, width: 50, height: 50 };
  const path = cable.getPath();
  
  const intersects = pathIntersectsBoundary(path, boundary);
  
  expect(intersects).toBe(false);
});

// Run test, show output:
// PASS src/tests/cable.test.ts
//   ✓ cable routes around boundary, not through it (4ms)
```

---

## BANNED PHRASES

Never use these without verification evidence immediately following:

- "Should be fixed now"
- "This should work"  
- "The issue is resolved"
- "I've updated the code"
- "Fixed the bug"
- "The screenshot shows it's working"
- "Visually confirmed"
- "Looking at the screenshot, I can see..."
- "The changes have been applied"
- "Everything looks correct"

---

## REQUIRED COMPLETION FORMAT

### When Verified:
```
✓ VERIFIED: [method(s) used]

Evidence:
[Actual data, output, or mathematical proof]

[Screenshot if applicable - as supporting evidence, not primary verification]
```

### When Verification Fails:
```
✗ VERIFICATION FAILED: [what failed]

Expected: [specific expected state]
Actual: [specific actual state from data extraction/testing]

Diagnosis: [why it failed]
Next step: [what you'll try]
```

### When Cannot Verify:
```
⚠ UNVERIFIED: [why verification isn't possible]

What I changed: [specific changes made]

To verify manually:
1. [Exact step]
2. [Exact step]
3. [What to look for]

What I need to verify programmatically:
- [Tool/access/information needed]
```

---

## ON VERIFICATION FAILURE

When verification fails, do NOT stop and wait. Follow this sequence:

1. **Report failure clearly** (using the ✗ VERIFICATION FAILED format)
2. **Diagnose root cause** — Why did the fix not work?
3. **Immediately begin next attempt** — No need to ask permission
4. **Re-verify after each attempt**

Loop until:
- ✓ Verification passes, OR
- You've exhausted reasonable approaches → Report what you've tried and ask for guidance

```
✗ VERIFICATION FAILED: Cable still intersects boundary

Expected: Path points avoid boundary rect (175-225, 25-75)
Actual: Path point (200,50) falls within boundary

Diagnosis: A* pathfinding not treating boundary as obstacle — 
obstacle grid doesn't include boundary coordinates

Attempting fix: Adding boundary rect to obstacle set in pathfinding init...

[continues working]
```

Do NOT:
- Stop and ask "would you like me to fix this?"
- Report failure and wait for instructions
- Abandon verification and claim partial success

---

## VERIFICATION SELECTION GUIDE

| Problem Type | Primary Verification | Secondary |
|--------------|---------------------|-----------|
| CSS/Layout | Data extraction + math | ASCII diagram + screenshot |
| Component rendering | DOM state extraction | Component hierarchy ASCII |
| Spatial/positioning | Coordinate math | ASCII diagram |
| API response | curl/fetch raw output | — |
| Database state | SQL query results | — |
| Build failure | Build output + artifact check | — |
| Logic bug | Unit test | Console output |
| Integration | Integration test | API + DB combined |

---

## SELF-CHECK BEFORE CLAIMING DONE

Before reporting completion, ask yourself:

1. Did I extract actual data, or did I just look at something?
2. Can I show mathematical/logical proof, or am I making assumptions?
3. If I used a screenshot, did I cross-reference with extracted data?
4. Did I show raw output, or did I summarize/paraphrase?
5. Would a skeptical developer accept this evidence?

If any answer is uncertain, you have NOT verified. Go back and verify properly or mark as UNVERIFIED.
