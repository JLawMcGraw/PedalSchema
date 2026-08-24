# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the project glossary.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

**This repo is single-context.** There is no `CONTEXT-MAP.md` and there should not be one
unless PedalSchema is ever split into separate packages.

```
/
├── CONTEXT.md          ← one glossary for the whole project
├── docs/
│   └── adr/            ← 0001-....md, 0002-....md
└── src/
```

Neither `CONTEXT.md` nor `docs/adr/` exists yet. That is the expected starting state:
`/domain-modeling` creates them lazily, the first time a term or a decision actually gets
resolved. Don't scaffold them preemptively.

Note that `.claude/docs/` holds this project's *plans and roadmaps*, a separate convention.
Domain docs (glossary, ADRs) belong at the root and under `docs/adr/` as shown above.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because…_
