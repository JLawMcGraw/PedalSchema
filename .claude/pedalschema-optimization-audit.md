# PedalSchema Optimization Algorithm Audit

## Context

This is a guitar pedalboard layout application. The core problem: given a set of pedals and a signal chain order, find optimal physical positions that minimize total cable length while respecting constraints.

## The Problem Space

**Inputs:**
- Set of pedals with dimensions and jack positions (input/output locations)
- Signal chain order (which pedal connects to which)
- Board dimensions and row rails
- Optional: amp with effects loop (four-cable method splits the chain)

**Constraints:**
- No pedal overlap (collision detection)
- Pedals snap to rails/rows
- Cables must route around obstacles (A* pathfinding)
- Effects loop topology: guitar → front pedals → amp IN, amp SEND → loop pedals → amp RTN

**Objective:** Minimize total routed cable length (not Euclidean—actual A* path length)

## Critical Issue

The cost function is **interdependent**: moving pedal A changes the obstacles for pedal B's cable routing. This creates a chicken-and-egg optimization problem.

## Your Task

Perform a complete audit of the optimization system. Examine these directories in depth:

```
src/lib/engine/
├── cables/         # Cable path generation
├── collision/      # Collision detection & rail snapping  
├── layout/         # Layout optimization algorithm
```

Also examine:
- `src/store/` - State management (how optimization triggers)
- `src/types/` - Type definitions for pedals, cables, positions
- `src/components/editor/canvas/cable-renderer.tsx` - How cables are rendered

## Specific Questions to Answer

### 1. Algorithm Analysis
- What optimization strategy is currently used? (greedy? simulated annealing? genetic? brute force?)
- How does it handle the interdependency problem?
- What's the time complexity? Does it scale with pedal count?

### 2. Collision System
- How is collision detection implemented?
- Are there edge cases where collisions slip through?
- How does rail snapping interact with collision checks?

### 3. Cable Routing (A* Implementation)
- What's the grid resolution for A* pathfinding?
- How are obstacles registered in the pathfinding grid?
- Are cable-to-cable collisions considered?
- How are jack positions translated to grid coordinates?

### 4. Effects Loop Handling
- How does the four-cable method split the signal chain?
- Is the amp position considered in optimization?
- Are send/return cables routed correctly through the channel?

### 5. Coordinate System Issues
- Are there any coordinate system mismatches (screen vs grid vs board)?
- How do pedal dimensions translate to collision boundaries?
- Is there off-by-one or boundary condition bugs?

## Deliverables

After your analysis, provide:

1. **Bug Report**: List every bug or logic error found, with file:line references

2. **Architecture Issues**: Fundamental design problems that limit optimization quality

3. **Recommended Algorithm**: Based on the problem constraints, what optimization approach would actually work? Consider:
   - Iterative refinement (place greedily, then swap/nudge to improve)
   - Constraint propagation 
   - Simulated annealing with A* cost function
   - Two-phase: rough placement then local optimization

4. **Implementation Plan**: Concrete steps to fix the system, ordered by impact

## Key Files to Start With

Begin with these and trace dependencies:
- `src/lib/engine/layout/` - The optimizer itself
- `src/lib/engine/cables/` - Cable generation and A* pathfinding
- `src/lib/engine/collision/` - Collision detection
- `src/store/editor-store.ts` or similar - How state flows

Read the code carefully. Trace the data flow from "user clicks optimize" through to "pedals move to new positions." Identify where logic breaks down.
