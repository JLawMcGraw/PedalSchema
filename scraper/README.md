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

See `schema/pedal.schema.json` for full JSON schema.

## Scrapers

### BOSS Pedals

```bash
pip install beautifulsoup4 requests
python boss_scraper.py
```

Outputs: `boss_pedals.json`

## Data Sources

| Source | Status | Notes |
|--------|--------|-------|
| BOSS (boss.info) | ✓ Scraper ready | Consistent spec format |
| Strymon | Planned | Good spec pages |
| EHX | Planned | Variable formatting |
| MXR/Dunlop | Planned | |
| JHS | Planned | |
| Walrus Audio | Planned | |
| Chase Bliss | Planned | |

## Contributing

### Adding a Scraper

1. Create `{manufacturer}_scraper.py`
2. Output to `data/{manufacturer}_pedals.json`
3. Validate against schema
4. Submit PR

### Manual Entries

For boutique pedals without scrapable pages:
1. Add to `data/manual_entries.json`
2. Include source URL
3. Measure dimensions if not published

## License

Data: CC0 (Public Domain)
Code: MIT

## Related Projects

- [Pedal Playground](https://pedalplayground.com/) - Visual pedalboard planner
- [Modulargrid](https://modulargrid.net/) - Eurorack module database (inspiration)
