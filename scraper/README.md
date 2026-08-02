# PedalSchema

Open database of guitar pedal specifications for pedalboard planning tools.

## Goal

Build a comprehensive database of pedal dimensions, power requirements, and I/O specifications that can power pedalboard layout and cable routing applications.

## Data Structure

Each pedal record includes:

```json
{
  "id": "boss-ds-1",
  "manufacturer": "BOSS",
  "model": "DS-1",
  "name": "Distortion",
  "type": "distortion",
  "dimensions": {
    "width_mm": 73,
    "depth_mm": 129,
    "height_mm": 59,
    "width_in": 2.87,
    "depth_in": 5.08
  },
  "power": {
    "voltage": 9,
    "current_ma": 10,
    "polarity": "center-negative"
  },
  "io": {
    "jack_position": "side",
    "bypass": "buffered"
  },
  "url": "https://www.boss.info/us/products/ds-1/",
  "image_url": "https://static.roland.com/products/ds-1/images/ds-1_top.png"
}
```

See [`pedal.schema.json`](./pedal.schema.json) for the full JSON schema.

## Pipeline

Three stages, run in order. Each is independent and idempotent.

```bash
# 1. Scrape specs -> boss_pedals.json
pip install beautifulsoup4 requests
python boss_scraper.py

# 2. Import into Supabase (inserts new, updates existing, matched on
#    manufacturer + name). Needs SUPABASE_SERVICE_ROLE_KEY in .env.local:
#    system pedals are is_system=true, which RLS blocks for normal users.
node import-pedals.js

# 3. Mirror product photos into storage (see Image Mirroring below)
node mirror-pedal-images.js
```

## Data Sources

| Source | Status | Notes |
|--------|--------|-------|
| BOSS (boss.info) | ✓ Scraped + imported | `boss_scraper.py`; consistent spec format |
| Strymon, EHX, MXR/Dunlop, Ibanez, TC, ProCo | Entered by hand | In the DB with mirrored photos, but no scraper — specs were entered manually |
| JHS | Planned | |
| Walrus Audio | Planned | |
| Chase Bliss | Planned | |

Photo sources are tracked separately from spec sources — see `PRODUCT_PAGES` in
`mirror-pedal-images.js` for the curated per-pedal image URLs, including the ones that
took real archaeology (dead manufacturer hosts, Wayback captures).

## Contributing

### Adding a Scraper

1. Create `{manufacturer}_scraper.py`
2. Output to `{manufacturer}_pedals.json` **in this directory** — `.gitignore` has
   `scraper/*.json` (with `pedal.schema.json` negated), so output here stays untracked.
   A subdirectory would NOT be matched by that rule and the scraped data would be committed.
3. Validate against `pedal.schema.json`
4. Extend `import-pedals.js`'s category mapping if the scraper emits new type names
5. Submit PR

### Manual Entries

For boutique pedals without scrapable pages:
1. Insert directly (see `import-pedals.js` for the row shape), or add to a
   `manual_entries.json` in this directory
2. Include the source URL you took the specs from
3. Measure dimensions if not published

## Image Mirroring

`mirror-pedal-images.js` fetches a product photo per pedal from manufacturer sources,
knocks out the background, and stores the result in the `pedal-images` bucket. It
**records provenance in the same statement that writes the image** —
`image_source_url`, `image_license`, `image_attribution`, `image_fetched_at` — so no
served image lacks a named origin, and clearing an image clears its provenance too.

`image_license` is recorded bluntly rather than optimistically:

| Value | Meaning |
|---|---|
| `manufacturer-proprietary` | A manufacturer's product photo. We hold no licence; mirrored for product identification, removable on request. |
| `wikimedia-see-file-page` | Per-file terms a human must resolve before the bytes are used. |
| `user-provided` | Uploaded by the pedal's owner via `/pedals/new`. |
| `unknown` | Host not recognised — treat as un-cleared. |

**Provenance without an image means referenced, not mirrored.** A row with
`image_source_url` set and `image_url` NULL is a deliberate decision to link rather
than copy, and the script skips it **even under `FORCE=1`**. The Klon Centaur is the
current case: its only good source is CC BY-SA 2.0 and our knockout makes a derivative,
so share-alike would reach our output. Referencing avoids creating the derivative.

See **Image Rights** in the root `README.md` for the removal path.

### Amps and boards

`mirror-gear-images.js` does the same for the twelve amps and eight boards, importing
the pedal script's pipeline rather than copying it, and writing to `amps/{id}.png` and
`boards/{id}.png` in the same bucket.

Two things differ, both deliberate:

- **No footprint-aspect gate.** A pedal photo is stretched onto the pedal's physical
  width × depth on the canvas, so its aspect is checked against that. Amps and boards
  appear face-on in a library card — width × *height* — and would all fail that gate.
- **Sources are a fixed, human-checked table, not a search.** The failure mode here is
  not a dead URL, it is a live URL for the wrong object, and it does not look wrong in
  the report. Three real examples: `voxamps.com/product/ac30c2/` redirects to the
  AC30C2 *canvas cover* (a padded bag); every Pedaltrain listing leads with a composite
  of board + gig bag + accessories; and the next image along is a third party's
  watermarked diagram.

**Resolving a new source** — `resolve-gear-image.js <url>` opens the page in a real
browser and reports every rendered image with its natural size, because these makers
defeat plain fetches in three different ways: Fender and EVH answer `curl` with 403,
Vox builds its gallery in JS (four *different* Vox product pages return the same list
of image URLs — the shared nav menu), and Marshall's archive is an SPA whose `og:image`
is the Marshall logo. It reports; a human picks and then *looks at the picture*.

**Dark subject on a dark backdrop will pass every automated check and still be wrong.**
Marshall shoots black amps against grey (63,63,63); the knockout absorbs anything
within `BG_TOL=35` of that, and a black cabinet's shadowed edge is inside that band, so
the flood walks into the amp and eats ragged holes. Prefer a source PNG that already
ships an alpha silhouette — the knockout then takes its `already-cutout` path and never
floods. Both Marshall entries do exactly this.

Verify with `node .claude/scripts/verify-gear-images.js`, which asserts each card's
`<img>` actually decoded in the browser (`naturalWidth > 0`) and is served from our
storage — a broken image still has a bounding box and still survives a screenshot
glance.

## License

Data: CC0 (Public Domain) — the specification fields (dimensions, power, I/O).
Code: MIT

**Not** the pedal photographs: those belong to their manufacturers or photographers and
are mirrored under the terms described above.

## Related Projects

- [Pedal Playground](https://pedalplayground.com/) - Visual pedalboard planner
- [Modulargrid](https://modulargrid.net/) - Eurorack module database (inspiration)
