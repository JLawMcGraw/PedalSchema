# Repro: FX Loop Layout + Cable Routing

This repro loads a known configuration that triggers layout + cable routing edge cases.

## Steps
1) Run the dev server: `npm run dev`
2) Open `http://localhost:3000/editor/new`
3) In the browser console, run:

```js
fetch('/repro/repro-state.json')
  .then((r) => r.json())
  .then((s) => window.__loadPedalSchemaRepro(s));
```

4) Click "Optimize Layout" in the UI.
5) Optional: enable debug logs with `?debug=cables&debug=optimizer` in the URL.

## Expected
- Pedals remain in signal-chain order (right-to-left for front-of-amp).
- FX loop pedals are grouped for short cable runs to amp send/return.
- Cables do not route through pedal bodies (invalid paths should not render).
