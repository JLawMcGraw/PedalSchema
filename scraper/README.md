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

## License

Data: CC0 (Public Domain) — the specification fields (dimensions, power, I/O).
Code: MIT

**Not** the pedal photographs: those belong to their manufacturers or photographers and
are mirrored under the terms described above.

## Related Projects

- [Pedal Playground](https://pedalplayground.com/) - Visual pedalboard planner
- [Modulargrid](https://modulargrid.net/) - Eurorack module database (inspiration)
