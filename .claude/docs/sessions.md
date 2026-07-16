# Session History

This file tracks work completed across coding sessions. Read this at session start for context.

---

## Session: 2026-01-22

### Summary
Major cable routing and layout optimization fixes from nextstep.md plan. Unified routing logic, fixed cables through pedals, improved zone sizing, and added 4-cable method rule.

### What Was Accomplished
- [x] Removed "expanded exclude" logic that was allowing cables through adjacent pedals
- [x] Added endpoint tolerance (4px) for first/last cable segments
- [x] Enforced board bounds in cable routing (cables stay on board)
- [x] Tightened L-path shortcuts (80px max with obstacles, was 150px)
- [x] Implemented cable grouping by from/to pair and jack type for offset calculation
- [x] Increased cable offset from 4px to 8px for better visual separation
- [x] Dynamic standoff based on pedal size
- [x] Dynamic FX loop zone sizing based on actual pedal widths
- [x] Snake pattern layout (right-to-left on all rows)
- [x] Added `four-cable-fx-loop` rule for auto-routing modulation/delay/reverb to loop
- [x] Unified cable-renderer to use routing-strategies (single source of truth)
- [x] Added debug helper `window.__loadPedalSchemaRepro()` for loading repro snapshots

### Key Changes
| File | Change |
|------|--------|
| `src/lib/engine/cables/validation.ts` | NEW: Removed expanded exclude logic; now only excludes source/dest pedals; added ENDPOINT_TOLERANCE (4px) |
| `src/lib/engine/cables/routing-strategies.ts` | NEW: Added `computeCableGroups()` with jack-type grouping; `isPathWithinBounds()` helper; off-board endpoint handling; increased CABLE_OFFSET to 8px |
| `src/lib/engine/pathfinding/index.ts` | Added `BoardBounds` interface; dynamic standoff based on pedal size; tightened L-path shortcuts when obstacles present |
| `src/components/editor/canvas/cable-renderer.tsx` | Unified to use `routeCableWithObstacles()`; removed duplicate routing logic; added `useMemo` for performance |
| `src/components/editor/canvas/editor-canvas.tsx` | Uses `computeCableGroups()` for per-group cable offsets |
| `src/lib/engine/layout/index.ts` | Snake pattern placement (right-to-left on all rows); dynamic zone sizing based on pedal widths; zone overlap handling |
| `src/lib/engine/layout/optimizer-v2.ts` | NEW: Dynamic ampZoneBoundary; overflow into opposite zone instead of (0,0) fallback |
| `src/lib/engine/signal-chain/rules.ts` | Added `four-cable-fx-loop` rule (modulation/delay/reverb → effects loop when 4-cable method enabled) |
| `src/store/configuration-store.ts` | Added `window.__loadPedalSchemaRepro()` debug helper |

### Technical Decisions
1. **No expanded excludes**: Cables must route around ALL pedals except source/destination. Previous logic was excluding adjacent pedals if their margin zones overlapped endpoints - this was wrong.
2. **Off-board endpoint handling**: Amp connections (guitar, amp_input, amp_send, amp_return) have endpoints outside board bounds. `allowOffBoard` flag skips bounds checking for these cables.
3. **Jack-type cable grouping**: Cables to different jacks on the same pedal are now separate groups (e.g., NS-2 input vs send/return). Prevents unnecessary spreading.
4. **Dynamic standoff**: `max(minStandoff, max(halfWidth, halfHeight) * 0.6)` ensures cables clear larger pedals.
5. **Snake pattern**: Always place right-to-left on all rows. Later chain positions stay closer to amp. No direction flip between rows.
6. **Dynamic zone boundary**: Zone split calculated from actual pedal widths, not fixed 35%. Allows overflow when zones are full.

### Architecture Notes
**Cable Validation (validation.ts):**
```
- excludePedalIds: ONLY source and destination pedals
- First/last segments: use reduced margin (OBSTACLE_MARGIN - ENDPOINT_TOLERANCE)
- Middle segments: use full OBSTACLE_MARGIN
- No expanded excludes for adjacent pedals
```

**Cable Grouping (routing-strategies.ts):**
```
getCableGroupKey():
- Pedal-to-pedal: `pedal:${id1}:${id2}:jack:${jackPair}`
- External→pedal: `ext:${fromType}:${toPedalId}:jack:${toJack}`
- Pedal→external: `ext:${fromPedalId}:${toType}:jack:${fromJack}`
```

**Layout Zone Sizing (layout/index.ts):**
```
frontRequired = sum(front pedal widths) + spacing
loopRequired = sum(loop pedal widths) + spacing
ampZoneBoundary = max(minLoop, min(loopRequired, maxLoop))
If zones don't fit, zonesOverlap = true (pedals can overflow)
```

### Next Tasks
- [ ] Test with crowded boards to verify cable routing improvements
- [ ] Consider visual indicator for invalid cable paths (currently red)
- [ ] Add tests for cable validation edge cases
- [ ] Verify 4-cable method rule works with various pedal configurations

---

## Session: 2026-01-08 (Afternoon)

### Summary
Fixed cable routing: cables no longer go off-screen or appear to pass through pedals.

### What Was Accomplished
- [x] Fixed cables going off-screen (y=-20 → y=236)
- [x] Added universal standoff from jack positions before routing
- [x] Added boardBounds constraint to keep cables within visible area
- [x] Verified fixes mathematically using extracted path coordinates
- [x] Created cable log capture script for verification
- [x] Disabled DEBUG_PATHS flag for production

### Key Changes
| File | Change |
|------|--------|
| `src/lib/engine/cables/routing-strategies.ts` | Added `boardBounds`, `fromBox`, `toBox` parameters; uses `getStandoffPoint()` for universal standoff; added `constrainY`/`constrainX` helpers |
| `src/lib/engine/pathfinding/index.ts` | Added `BoardBounds` interface and `boardBounds` parameter to `findPathAStar()`; constrains A* grid to board bounds |
| `src/components/editor/canvas/cable-renderer.tsx` | Passes pedal boxes and board bounds to `routeCablePath()`; disabled DEBUG_PATHS |
| `.claude/scripts/capture-cable-logs.js` | New script to capture cable routing console output for verification |
| `.claude/scripts/get-config-url.js` | New script to get configuration URL from dashboard |

### Technical Decisions
1. **Board bounds constraint**: All routing strategies now constrain Y coordinates to `[boardBounds.minY + 20, boardBounds.maxY - 20]` to keep cables visible on the board.
2. **Universal standoffs**: Every cable path now starts with a standoff point that moves 25px AWAY from the source/destination pedal before any routing occurs. This prevents cables from appearing to go through pedals.
3. **Standoff direction from `getStandoffPoint()`**: Uses jack position relative to pedal box to determine which direction to move (left edge → move left, right edge → move right, etc.).
4. **A* grid constrained to board**: When `boardBounds` is provided, A* pathfinding grid is constrained to `[minY + 10, maxY + 20]` to prevent routing above the board.

### Architecture Notes
**Cable Routing with Standoffs (routing-strategies.ts):**
```
1. Calculate standoff points using getStandoffPoint(from, fromBox, 25)
2. Build path: from → fromStandoff → [routing channel] → toStandoff → to
3. constrainY() ensures all Y values stay within [minY+20, maxY-20]
4. Validate route; if fails, try above/below routing
5. Fallback to A* with board bounds constraint
```

**Verification Method (per CLAUDE.md):**
```
1. Extract path coordinates from console logs
2. Verify all Y values are within [0, 500] (board bounds)
3. Verify routing channel Y (236, 276) is in gap between pedal rows
4. Construct ASCII diagram from extracted data
```

### Verification Results
```
BEFORE: Cable 7 path: (-60,250) → (-60,-20) → (580,-20) → (580,102)
                                    ^^^^^        ^^^^^
                                    OFF SCREEN (y < 0)

AFTER:  Cable 7 path: (-60,250) → (-60,236) → (604,236) → (605,102) → (580,102)
                                     ^^^         ^^^
                                     IN GAP (y=236 is between rows)

All 9 cables verified: Y ∈ [100, 400] (within board [0, 500]) ✓
```

### Next Tasks
- [ ] Consider cable color coding by signal path type
- [ ] Test with more complex/crowded board layouts
- [ ] May want to add visual indicator when standoff routing is active

---

## Session: 2026-01-08

### Summary
Fixed cable routing optimization: aligned cost function with visual renderer and increased penalties to force the optimizer to place pedals with clear cable channels.

### What Was Accomplished
- [x] Aligned cost function routing logic with visual renderer (uses same L-path strategy)
- [x] Added cable collision penalty function to detect cables going through pedals
- [x] Increased spacing penalty from 50 to 200 inches per close pedal pair
- [x] Increased minimum cable clearance from 62.5px to 75px
- [x] Added complex routing penalty (30 inches for paths needing more than 3 points)
- [x] Imported `validateRoute` and `lineIntersectsBox` for consistent collision detection
- [x] Verified both standard and 4-cable method produce cleaner layouts

### Key Changes
| File | Change |
|------|--------|
| `src/lib/engine/layout/routing-cost.ts` | Rewrote `routeCable()` to match visual renderer's L-path logic; added `calculateCableCollisionPenalty()`; increased spacing penalty to 200; added complex routing penalty of 30 |
| `src/components/editor/canvas/cable-renderer.tsx` | Simplified to use L-shaped routing with no exclusions |
| `src/lib/engine/pathfinding/index.ts` | Fixed emergency fallback to stay on board (positive Y values) |

### Technical Decisions
1. **Cost-renderer alignment**: Root cause of cables through pedals was mismatch between how cost function (A* routing) and visual renderer (L-paths) computed paths. Now both use same strategy.
2. **Heavy spacing penalty (200 inches)**: Forces optimizer to leave 75px (~1.9 inch) gaps between pedals for clean L-path cable routes.
3. **Complex routing penalty**: Discourages layouts requiring fallback routing strategies (channels, perimeter, A*).
4. **No exclusions in routing**: Changed from excluding source/destination boxes to checking ALL boxes for collisions.

### Architecture Notes
**Cable Routing Strategy (now consistent in both files):**
```
1. Direct line (if distance <= 80px and validates)
2. L-path horizontal-first (from → mid → to)
3. L-path vertical-first (from → mid → to)
4. Channel routing through gaps between pedal rows
5. Route above/below all pedals
6. A* fallback with no exclusions
```

**Cost Function Penalties:**
```
totalScore = routedLength
           + crossings * 6
           + spacingPenalty (200 per close pair)
           + collisionPenalty (100 per intersection)
           + complexRoutingPenalty (30 per complex cable)
```

### Next Tasks
- [ ] Consider adding visual feedback when cables have to use fallback routing
- [ ] Test with even more crowded pedalboard layouts
- [ ] May need to tune penalties further based on real-world usage

---

## Session: 2026-01-07 (Very Late Night)

### Summary
Fixed noise gate positioning bug and added clean/dirty modulation setting for effects loop routing.

### What Was Accomplished
- [x] Diagnosed NS-2 appearing after modulation (PH-3, BF-3) instead of before
- [x] Found bug in `noise-gate-after-drive` rule - was moving gates to END of chain instead of after last drive
- [x] Fixed rule to only move noise gates that are BEFORE the last drive pedal
- [x] Added `modulationInLoop` setting (clean vs dirty modulation)
- [x] Updated modulation-flexible rule to move modulation to effects loop when enabled
- [x] Added UI toggle in Routing Options panel
- [x] Created database migration for `modulation_in_loop` column
- [x] Updated editor to load/save the new setting

### Key Changes
| File | Change |
|------|--------|
| `src/lib/engine/signal-chain/rules.ts` | Fixed `noise-gate-after-drive` rule, updated `modulation-flexible` to respect `modulationInLoop` |
| `src/types/index.ts` | Added `modulationInLoop` to `Configuration` and `ChainContext` |
| `src/store/configuration-store.ts` | Added `modulationInLoop` state and `setModulationInLoop` action |
| `src/components/editor/panels/routing-options-panel.tsx` | Added Modulation toggle (clean/dirty) |
| `src/app/(dashboard)/editor/[id]/page.tsx` | Pass `modulationInLoop` prop |
| `src/app/(dashboard)/editor/[id]/editor-client.tsx` | Accept and save `modulationInLoop` |
| `supabase/migrations/20240107000002_add_modulation_in_loop.sql` | Add column to configurations |

### Technical Decisions
1. **Noise gate bug**: The original rule collected ALL noise gates and inserted them after the last drive. Fixed to only move gates that are BEFORE the last drive.
2. **Clean vs Dirty modulation**:
   - Dirty (default): Modulation stays in front of amp - preamp distortion affects modulated signal
   - Clean: Modulation goes in effects loop - cleaner, unaffected by preamp
3. **UI placement**: Modulation toggle only appears when effects loop is enabled (logical dependency)

### Architecture Notes
**Modulation Placement Logic:**
```
if (modulationInLoop && ampHasEffectsLoop && useEffectsLoop) {
  // Move chorus, flanger, phaser, tremolo to effects_loop location
}
```
This ensures the toggle only has effect when the effects loop is active.

### Next Tasks
- [ ] None - feature complete

---

## Session: 2026-01-07 (Late Night)

### Summary
Major optimization system overhaul: implemented joint topology + geometry optimization and added per-pedal loop toggle for NS-2 style pedals.

### What Was Accomplished
- [x] Fixed cables going through pedals (increased OBSTACLE_MARGIN, reduced GRID_CELL_SIZE)
- [x] Implemented joint topology + geometry optimization (signal chain + placement optimized together)
- [x] Added `SwappableGroup` detection for consecutive same-category pedals
- [x] Added `tryChainSwap` SA move type (25% probability) to reorder within swappable groups
- [x] Fixed Euclidean fallback bug (>10 pedals was using straight-line distance instead of A* routing)
- [x] Added `useLoop` toggle for NS-2 style pedals (no longer auto-uses all 4 jacks)
- [x] Created database migration for `use_loop` column
- [x] Renamed migration files to Supabase timestamp format
- [x] Pushed migration to production database

### Key Changes
| File | Change |
|------|--------|
| `src/types/index.ts` | Added `SwappableGroup`, `PedalPlacement`, `JointOptimizationResult`, `useLoop` field on `PlacedPedal` |
| `src/lib/engine/signal-chain/index.ts` | Added `identifySwappableGroups()` function |
| `src/lib/engine/layout/optimizer.ts` | Added `tryChainSwap`, `optimizeJointly()`, fixed Euclidean fallback, returns `JointOptimizationResult` |
| `src/lib/engine/layout/index.ts` | Added `calculateOptimalLayoutJoint()` |
| `src/lib/engine/layout/routing-cost.ts` | Uses shared `PedalPlacement` type from types |
| `src/lib/engine/pathfinding/index.ts` | Extracted A* pathfinding from cable-renderer (new file) |
| `src/lib/engine/cables/index.ts` | Check `placed.useLoop` before using send/return jacks |
| `src/store/configuration-store.ts` | Added `setUseLoop` action, uses `calculateOptimalLayoutJoint()` |
| `src/components/editor/panels/properties-panel.tsx` | Added "Loop Routing" toggle UI for 4-cable pedals |
| `src/app/(dashboard)/editor/[id]/page.tsx` | Load `use_loop` from database |
| `src/app/(dashboard)/editor/[id]/editor-client.tsx` | Save `use_loop` to database |
| `supabase/migrations/20240107000001_add_use_loop.sql` | Add `use_loop` column to `configuration_pedals` |

### Technical Decisions
1. **Joint optimization**: SA now optimizes both pedal positions AND signal chain order simultaneously, returning `{ placements, chainOrder, swappableGroups }`
2. **Swappable groups**: Consecutive pedals of same category (e.g., 3 overdrives) can be reordered for better cable routing
3. **Non-swappable categories**: tuner, looper, volume, utility, multi_fx are never swapped (user intent critical)
4. **useLoop default false**: NS-2 style pedals now require explicit opt-in for 4-cable routing
5. **Always use routing cost**: Removed Euclidean fallback for >10 pedals - A* routing always used

### Architecture Notes
**Joint Optimization Flow:**
```
1. identifySwappableGroups() finds [OD1, OD2, OD3] as swappable
2. SA runs with 4 move types:
   - trySwap (30%): swap pedal x,y positions
   - tryNudge (30%): move pedal slightly
   - tryRowChange (15%): move to different rail
   - tryChainSwap (25%): reorder within swappable group
3. Cost function uses A* routing (never Euclidean)
4. Returns { placements, chainOrder }
5. Store applies both position AND chainPosition changes
```

**NS-2 Loop Toggle:**
- `useLoop: boolean` on `PlacedPedal` controls whether send/return jacks are used
- Default `false` - only input/output jacks used (2 cables)
- When `true` - drive pedals route through the loop (4 cables)

### Next Tasks
- [ ] Test joint optimization with complex pedalboard layouts
- [ ] Consider anchor optimization (guitar/amp positions currently fixed)
- [ ] Add visual indicator when chain order was optimized

---

## Session: 2026-01-07 (Night)

### Summary
Set up BOSS pedal scraper and imported 41 pedals to Supabase database.

### What Was Accomplished
- [x] Reviewed scraper folder contents (boss_scraper.py, pedal.schema.json, import-pedals.js)
- [x] Added scraper/ to .gitignore (contains local JSON data files)
- [x] Fixed Python 3.9 compatibility in boss_scraper.py (Optional[] type hints)
- [x] Ran BOSS scraper - collected 41 pedals with dimensions, power specs, and I/O info
- [x] Created import-pedals.js to transform scraped data to database schema
- [x] Fixed column name mismatch (supports_4_cable vs supports_4cable)
- [x] Added SUPABASE_SERVICE_ROLE_KEY to bypass RLS for system pedal inserts
- [x] Successfully imported 41 BOSS pedals to database

### Key Changes
| File | Change |
|------|--------|
| `.gitignore` | Added scraper/ to ignore local JSON data files |
| `package.json` | Added dotenv dependency for import script |
| `scraper/boss_scraper.py` | Fixed Python 3.9 compatibility (typing imports) |
| `scraper/import-pedals.js` | Created import script with category mapping |
| `scraper/boss_pedals.json` | Generated 41 BOSS pedals (not committed) |
| `.env.local` | Added SUPABASE_SERVICE_ROLE_KEY |

### Technical Decisions
1. **Service role key for system pedals**: RLS policy prevents regular users from inserting `is_system=true` pedals. Service role bypasses RLS.
2. **Category mapping**: Scraper types (chorus, flanger, phaser, vibrato, rotary) map to database `modulation` category
3. **Scraper folder in gitignore**: JSON output files contain scraped data that shouldn't be in version control

### Architecture Notes
**RLS Policies for pedals table:**
- SELECT: System pedals viewable by everyone (`is_system = true`)
- SELECT: Users can view their own pedals (`auth.uid() = created_by`)
- INSERT: Users can only create non-system pedals (`is_system = false`)
- UPDATE/DELETE: Users can only modify their own non-system pedals

**Import script flow:**
1. Read scraped JSON
2. Transform to database schema (dimensions, power, category mapping)
3. Check for existing pedals by manufacturer + name
4. Insert new / update existing

### Next Tasks
- [ ] Add more manufacturer scrapers (Strymon, EHX, MXR)
- [ ] Add pedal jack positions (top-mounted vs side-mounted)
- [ ] Consider adding pedal images to the UI

---

## Session: 2026-01-07 (Evening)

### Summary
UI audit and fixes for layout bugs, plus cable routing improvements for effects loop support.

### What Was Accomplished
- [x] Fixed responsive layout with collapsible panels for mobile
- [x] Added mobile hamburger menu to header
- [x] Made toolbar responsive with overflow menu
- [x] Fixed pedal library panel overflow (color dots and "Added" badge)
- [x] Added proper container padding for dashboard
- [x] Fixed right panel sheet only opening on mobile
- [x] Added amp panel visualization with RTN/SND/IN jacks for effects loop
- [x] Fixed cable routing for effects loop connections
- [x] Fixed amp_send → pedal routing to go through open channel (not through pedal body)
- [x] Standardized spacing values across panels

### Key Changes
| File | Change |
|------|--------|
| `src/app/(dashboard)/editor/[id]/editor-client.tsx` | Added Sheet components for mobile panels, responsive layout |
| `src/app/globals.css` | Added container class with responsive padding |
| `src/components/editor/canvas/cable-renderer.tsx` | Added useEffectsLoop prop, improved external→pedal routing to approach from below |
| `src/components/editor/canvas/editor-canvas.tsx` | Added amp panel with RTN/SND/IN jacks visualization |
| `src/components/editor/panels/pedal-library-panel.tsx` | Fixed overflow - moved color dot left, replaced "Added" with checkmark |
| `src/components/editor/toolbar/editor-toolbar.tsx` | Made responsive with overflow dropdown menu |
| `src/components/layout/header.tsx` | Added mobile hamburger menu |
| `src/components/editor/panels/*.tsx` | Standardized spacing (gap-2, p-2/p-3, space-y-1/2/3) |

### Technical Decisions
1. **Mobile breakpoint at lg (1024px)**: Panels collapse into Sheet components on mobile
2. **Effects loop amp visualization**: Shows three jacks (RTN top, SND middle, IN bottom) when FX loop enabled
3. **External→pedal routing**: Now approaches pedals from below through the open channel between rows, avoiding routing through pedal bodies
4. **Pedal→external routing**: Uses L-shaped paths with standoff points, validated before use

### Architecture Notes
Cable routing for effects loop now properly splits signal:
- Front chain: Guitar → pedals → amp_input (bottom jack)
- Loop chain: amp_send (middle jack) → pedals → amp_return (top jack)

The `useEffectsLoop` prop is passed to CableRenderer to position amp_input jack correctly.

External→pedal routing calculates approach point below the destination pedal and routes through the channel.

### Next Tasks
- [ ] Test with different board layouts and pedal arrangements
- [ ] Consider optimizing cable paths for visual cleanliness
- [ ] Mobile touch interactions for drag-and-drop

---

## Session: 2026-01-07

### Summary
Major refactor of cable routing algorithm to fix cables passing through pedals.

### What Was Accomplished
- [x] Fixed cable routing - cables no longer pass through pedals
- [x] Fixed Z-shaped routing between adjacent pedals
- [x] Fixed amp/guitar cable bump issue (up-then-down zigzag)
- [x] Disabled debug logging for production
- [x] Build verified passing

### Key Changes
| File | Change |
|------|--------|
| `src/components/editor/canvas/cable-renderer.tsx` | Major refactor (714 insertions, 954 deletions) |
| `.claude/scripts/debug-cables.js` | New debug script |
| `.claude/scripts/screenshot-optimized.js` | New screenshot script for post-optimize testing |

### Technical Decisions
1. **Standoff points (35px)**: Added standoff points outside pedal boxes to ensure cables route around pedals, not through them
2. **Three routing strategies**:
   - Short distance (<120px): Direct routing for adjacent pedals
   - External connections (guitar/amp): L-shaped routing with standoff only on pedal side
   - Long pedal-to-pedal: Full standoffs on both sides with A* routing
3. **L-shaped routing for external connections**: Simpler than A* and avoids zigzag artifacts

### Architecture Notes
The cable routing in `cable-renderer.tsx` now uses:
- `getStandoffPoint()` - Calculates points outside pedal boxes based on jack edge position
- `findPathAStar()` - Grid-based A* pathfinding with Manhattan distance heuristic
- `smoothPath()` - Removes small zigzag deviations from paths

### Next Tasks
- [ ] Consider cable color differentiation for different signal types
- [ ] Look into cable bundling when multiple cables share similar paths
- [ ] Test with more complex pedalboard layouts

---

## Session Template

Copy this template for new sessions:

```markdown
## Session: YYYY-MM-DD

### Summary
Brief description of main work done.

### What Was Accomplished
- [x] Task 1
- [x] Task 2
- [ ] Incomplete task

### Key Changes
| File | Change |
|------|--------|
| `path/to/file` | Description |

### Technical Decisions
1. Decision and rationale

### Next Tasks
- [ ] Task for next session
```
