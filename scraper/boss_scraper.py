#!/usr/bin/env python3
"""
BOSS Pedal Scraper
==================
Scrapes all BOSS compact pedal specifications from boss.info

Run: pip install beautifulsoup4 requests
     python boss_scraper.py

Output: boss_pedals.json
"""

import requests
from bs4 import BeautifulSoup
import json
import time
import re
from pathlib import Path
from typing import Optional, List, Dict

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

BASE_URL = "https://www.boss.info"

# Category pages to scrape
CATEGORIES = [
    "/us/categories/effects_pedals/distortion_overdrive_fuzz/",
    "/us/categories/effects_pedals/booster_preamp/",
    "/us/categories/effects_pedals/delay_reverb/",
    "/us/categories/effects_pedals/pitch_modulation/",
    "/us/categories/effects_pedals/dynamics_filter/",
    "/us/categories/effects_pedals/tuners_utility/",
    "/us/categories/effects_pedals/synth/",
    "/us/categories/effects_pedals/waza_craft/",
]


def get_product_links(category_url: str) -> List[str]:
    """Extract product URLs from a category page."""
    resp = requests.get(BASE_URL + category_url, headers=HEADERS)
    soup = BeautifulSoup(resp.text, 'html.parser')
    
    links = set()
    for a in soup.find_all('a', href=re.compile(r'^/us/products/[a-z0-9\-]+/$', re.I)):
        href = a.get('href')
        # Skip accessories, cables, boards
        if any(x in href for x in ['bcb-', 'bic-', 'psa', 'bck-', 'bs', 'ev-', 'fs-', 'fv-']):
            continue
        links.add(href)
    
    return list(links)


def parse_specs(soup: BeautifulSoup) -> Dict:
    """Parse specification definition list from product page."""
    specs = {}
    
    # Get all text content for regex parsing
    text = soup.get_text()
    
    # Dimensions
    width = re.search(r'Width\s*:?\s*(\d+)\s*mm', text)
    depth = re.search(r'Depth\s*:?\s*(\d+)\s*mm', text)
    height = re.search(r'Height\s*:?\s*(\d+)\s*mm', text)
    weight = re.search(r'Weight\s*:?\s*(\d+)\s*g', text)
    current = re.search(r'Current Draw\s*:?\s*(\d+)\s*mA', text)
    
    if width:
        specs['width_mm'] = int(width.group(1))
    if depth:
        specs['depth_mm'] = int(depth.group(1))
    if height:
        specs['height_mm'] = int(height.group(1))
    if weight:
        specs['weight_g'] = int(weight.group(1))
    if current:
        specs['current_ma'] = int(current.group(1))
    
    # Input/output impedance
    input_z = re.search(r'Input Impedance\s*:?\s*([\d\.]+)\s*([MkK])\s*ohm', text)
    output_z = re.search(r'Output Impedance\s*:?\s*([\d\.]+)\s*([MkK])\s*ohm', text)
    
    if input_z:
        val = float(input_z.group(1))
        unit = input_z.group(2)
        specs['input_z_ohms'] = int(val * (1_000_000 if unit.upper() == 'M' else 1_000))
    
    if output_z:
        val = float(output_z.group(1))
        unit = output_z.group(2)
        specs['output_z_ohms'] = int(val * (1_000_000 if unit.upper() == 'M' else 1_000))
    
    return specs


def get_product_image(soup: BeautifulSoup) -> Optional[str]:
    """Find the top-down product image URL."""
    # BOSS uses _top.png for top-down views
    img = soup.find('img', src=re.compile(r'_top\.png'))
    if img and img.get('src'):
        src = img['src']
        if not src.startswith('http'):
            src = 'https://static.roland.com' + src
        return src
    
    # Fallback to hero image
    img = soup.find('img', src=re.compile(r'_hero\.jpg'))
    if img and img.get('src'):
        src = img['src']
        if not src.startswith('http'):
            src = 'https://static.roland.com' + src
        return src
    
    return None


def scrape_product(url: str) -> Optional[Dict]:
    """Scrape a single product page."""
    try:
        resp = requests.get(BASE_URL + url, headers=HEADERS, timeout=10)
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        # Get model from URL
        model = url.strip('/').split('/')[-1].upper()
        
        # Get name from h1
        h1 = soup.find('h1')
        name = h1.get_text(strip=True) if h1 else model
        
        # Get tagline from first h2
        h2 = soup.find('h2')
        tagline = h2.get_text(strip=True) if h2 else None
        
        # Parse specs
        specs = parse_specs(soup)
        
        # Get image
        image_url = get_product_image(soup)
        
        # Build pedal record
        pedal = {
            'id': f"boss-{model.lower()}",
            'manufacturer': 'BOSS',
            'model': model,
            'name': name,
            'tagline': tagline,
            'url': BASE_URL + url,
            'image_url': image_url,
            'dimensions': {
                'width_mm': specs.get('width_mm'),
                'depth_mm': specs.get('depth_mm'),
                'height_mm': specs.get('height_mm'),
            },
            'power': {
                'voltage': 9,
                'current_ma': specs.get('current_ma'),
                'polarity': 'center-negative',
            },
            'weight_g': specs.get('weight_g'),
            'input_z_ohms': specs.get('input_z_ohms'),
            'output_z_ohms': specs.get('output_z_ohms'),
        }
        
        # Add inch dimensions if we have mm
        if pedal['dimensions']['width_mm']:
            pedal['dimensions']['width_in'] = round(pedal['dimensions']['width_mm'] / 25.4, 2)
        if pedal['dimensions']['depth_mm']:
            pedal['dimensions']['depth_in'] = round(pedal['dimensions']['depth_mm'] / 25.4, 2)
        
        return pedal
        
    except Exception as e:
        print(f"  Error: {e}")
        return None


def main():
    print("="*60)
    print("BOSS PEDAL SCRAPER")
    print("="*60)
    
    # Collect all product URLs
    all_urls = set()
    
    print("\n[1/3] Collecting product URLs from categories...")
    for cat in CATEGORIES:
        print(f"  → {cat}")
        urls = get_product_links(cat)
        all_urls.update(urls)
        time.sleep(0.5)
    
    print(f"\nFound {len(all_urls)} unique products")
    
    # Scrape each product
    print("\n[2/3] Scraping product specs...")
    pedals = []
    
    for i, url in enumerate(sorted(all_urls), 1):
        model = url.strip('/').split('/')[-1].upper()
        print(f"  [{i}/{len(all_urls)}] {model}", end=" ")
        
        pedal = scrape_product(url)
        if pedal and pedal['dimensions'].get('width_mm'):
            pedals.append(pedal)
            print(f"✓ {pedal['dimensions']['width_mm']}x{pedal['dimensions']['depth_mm']}mm")
        else:
            print("✗ no dimensions")
        
        time.sleep(0.5)  # Be polite
    
    # Save results
    print(f"\n[3/3] Saving {len(pedals)} pedals...")
    
    output = {
        'version': '1.0',
        'source': 'boss.info',
        'pedal_count': len(pedals),
        'pedals': pedals
    }
    
    with open('boss_pedals.json', 'w') as f:
        json.dump(output, f, indent=2)
    
    print(f"\n✓ Saved to boss_pedals.json")
    
    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    print(f"{'Model':<12} {'Width':<8} {'Depth':<8} {'Height':<8} {'mA':<6}")
    print("-"*60)
    for p in sorted(pedals, key=lambda x: x['model'])[:20]:
        d = p['dimensions']
        print(f"{p['model']:<12} {d.get('width_mm', '-'):<8} {d.get('depth_mm', '-'):<8} "
              f"{d.get('height_mm', '-'):<8} {p['power'].get('current_ma', '-'):<6}")
    
    if len(pedals) > 20:
        print(f"... and {len(pedals) - 20} more")


if __name__ == '__main__':
    main()
