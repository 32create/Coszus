#!/usr/bin/env python3
"""
label-flat-lays.py

Labels each product's flat lay and model shot in its image alt text, so the collection
grid's Plain / Model toggle knows which photo is which (snippets/coszus-product-card.liquid
looks for "flat lay" and "on model" in the alt text):

    "OG Badge Hoodie Black – flat lay"
    "OG Badge Hoodie Black – on model"

A flat lay is found by its background: a garment on pure white has a border at 248-255
brightness. Model shots don't, including those on a white studio backdrop, which reads
234-241 (off-white, with shadow). Per product it proposes the first pure-white image as the
flat lay and the first other image as the model shot. Products
whose images already say "flat lay" / "on model" are left alone. Nothing else is changed.

Dry run (default) writes a review page and a proposals file, and changes nothing in Shopify:

    python3 docs/scripts/label-flat-lays.py --out /tmp/flat-lays
    open /tmp/flat-lays/review.html

Before launch, put the reviewed labels in the theme instead of the store. This writes
snippets/coszus-image-roles.liquid, which only this theme reads, so the live site is untouched:

    python3 docs/scripts/label-flat-lays.py --snippet /tmp/flat-lays/proposals.json

At launch, apply them as alt text (edit or delete lines in proposals.json first if any are
wrong). Only run --apply with Kye's go-ahead: alt text is store data, read by every theme.

    SHOPIFY_STORE=COSZUS-STORE.myshopify.com SHOPIFY_ADMIN_TOKEN=... \\
      python3 docs/scripts/label-flat-lays.py --apply /tmp/flat-lays/proposals.json

Without SHOPIFY_ADMIN_TOKEN the dry run reads the public storefront, which only lists
products published to the Online Store. With it, every product is read. The token needs
the read_products and write_products Admin API scopes (see docs/METAFIELDS.md for setting
up the Dev Dashboard app). Needs Python 3.9+ and Pillow (pip3 install pillow).

Re-run after uploading new flat lays: already-labelled products are skipped.
"""

import argparse
import html
import io
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

API_VERSION = '2026-07'
STOREFRONT = 'https://coszusworld.com'
FLAT_LAY_MIN = 245  # median border brightness: flat lays 248-255, white-backdrop model shots 234-241
UA = {'User-Agent': 'Mozilla/5.0 (label-flat-lays)'}


def get_json(url, data=None, headers=None):
    request = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def admin(query, variables=None):
    store = os.environ['SHOPIFY_STORE']
    body = json.dumps({'query': query, 'variables': variables or {}}).encode()
    result = get_json(
        f'https://{store}/admin/api/{API_VERSION}/graphql.json',
        data=body,
        headers={'Content-Type': 'application/json', 'X-Shopify-Access-Token': os.environ['SHOPIFY_ADMIN_TOKEN']},
    )
    if result.get('errors'):
        sys.exit(f"Admin API error: {result['errors']}")
    return result['data']


PRODUCTS_QUERY = """
query ($cursor: String) {
  products(first: 100, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id handle title
      media(first: 50) { nodes { ... on MediaImage { id alt image { url } } } }
    }
  }
}
"""


def load_products():
    """[{id, handle, title, images: [{id, alt, url}]}] in each product's media order."""
    if os.environ.get('SHOPIFY_ADMIN_TOKEN'):
        products, cursor = [], None
        while True:
            page = admin(PRODUCTS_QUERY, {'cursor': cursor})['products']
            for p in page['nodes']:
                images = [
                    {'id': m['id'], 'alt': m.get('alt') or '', 'url': m['image']['url']}
                    for m in p['media']['nodes']
                    if m.get('image')
                ]
                products.append({'id': p['id'], 'handle': p['handle'], 'title': p['title'], 'images': images})
            if not page['pageInfo']['hasNextPage']:
                return products
            cursor = page['pageInfo']['endCursor']

    print('No SHOPIFY_ADMIN_TOKEN: reading published products from the storefront only.', file=sys.stderr)
    products, page = [], 1
    while True:
        batch = get_json(f'{STOREFRONT}/products.json?limit=250&page={page}')['products']
        if not batch:
            return products
        for p in batch:
            images = [
                {'id': None, 'alt': i.get('alt') or '', 'url': ('https:' + i['src']) if i['src'].startswith('//') else i['src']}
                for i in p['images']
            ]
            products.append({'id': None, 'handle': p['handle'], 'title': p['title'], 'images': images})
        page += 1


def border_brightness(url):
    """Median brightness (darkest channel, 0-255) of the outer 6% band of the image."""
    sized = url + ('&' if '?' in url else '?') + 'width=160'
    with urllib.request.urlopen(urllib.request.Request(sized, headers=UA), timeout=30) as response:
        image = Image.open(io.BytesIO(response.read())).convert('RGB')
    width, height = image.size
    band = max(2, int(min(width, height) * 0.06))
    pixels = image.load()
    border = sorted(
        min(pixels[x, y])
        for y in range(height)
        for x in range(width)
        if x < band or x >= width - band or y < band or y >= height - band
    )
    return border[len(border) // 2]


def labelled(product):
    alts = [i['alt'].lower() for i in product['images']]
    return any('flat lay' in a for a in alts) and any('on model' in a for a in alts)


def propose(products):
    todo = [p for p in products if p['images'] and not labelled(p)]
    urls = sorted({i['url'] for p in todo for i in p['images']})
    with ThreadPoolExecutor(16) as pool:
        scores = dict(zip(urls, pool.map(border_brightness, urls)))

    proposals, no_flat_lay = [], []
    for p in todo:
        for image in p['images']:
            image['score'] = scores[image['url']]
        flat = next((i for i in p['images'] if i['score'] >= FLAT_LAY_MIN), None)
        if not flat:
            no_flat_lay.append(p)
            continue
        model = next((i for i in p['images'] if i['score'] < FLAT_LAY_MIN), None)
        for image, role in ((flat, 'flat lay'), (model, 'on model')):
            if image and role not in image['alt'].lower():
                proposals.append({
                    'product': p['handle'],
                    'product_id': p['id'],
                    'image_url': image['url'],
                    'media_id': image['id'],
                    'score': image['score'],
                    'role': role,
                    'old_alt': image['alt'],
                    'new_alt': f"{p['title']} – {role}",
                })
    return proposals, no_flat_lay


def write_review(out, products, proposals, no_flat_lay):
    by_product = {}
    for row in proposals:
        by_product.setdefault(row['product'], []).append(row)
    titles = {p['handle']: p['title'] for p in products}

    def thumb(url, caption):
        sized = url + ('&' if '?' in url else '?') + 'width=240'
        return f'<figure><img src="{html.escape(sized)}" alt="" loading="lazy"><figcaption>{html.escape(caption)}</figcaption></figure>'

    rows = []
    for handle, items in by_product.items():
        figs = ''.join(thumb(r['image_url'], f"{r['role']} · {r['score']}") for r in items)
        rows.append(f'<section><h2>{html.escape(titles[handle])}</h2><div class="row">{figs}</div></section>')
    missing = ''.join(f'<li>{html.escape(p["title"])}</li>' for p in no_flat_lay)

    page = f"""<!doctype html><meta charset="utf-8"><title>Flat lay labels</title>
<style>
body{{font:14px/1.4 -apple-system,Helvetica,Arial,sans-serif;margin:24px;color:#111}}
section{{border-top:1px solid #ddd;padding:12px 0}} h2{{font-size:13px;margin:0 0 8px}}
.row{{display:flex;gap:8px}} figure{{margin:0}} img{{width:160px;aspect-ratio:4/5;object-fit:cover;background:#f3f3f3;display:block}}
figcaption{{font-size:11px;color:#555;margin-top:4px}}
</style>
<h1>Flat lay labels: {len(by_product)} products, {len(proposals)} images</h1>
<p>Each row shows the image proposed as the flat lay and as the model shot. Anything wrong: remove or change its line in proposals.json before applying.</p>
{''.join(rows)}
<h2 style="margin-top:32px">No flat lay found ({len(no_flat_lay)} products)</h2><ul>{missing}</ul>
"""
    with open(os.path.join(out, 'review.html'), 'w') as f:
        f.write(page)


def apply(path):
    if not os.environ.get('SHOPIFY_ADMIN_TOKEN') or not os.environ.get('SHOPIFY_STORE'):
        sys.exit('--apply needs SHOPIFY_STORE and SHOPIFY_ADMIN_TOKEN.')
    with open(path) as f:
        proposals = json.load(f)

    # Proposals from a storefront dry run have no Admin IDs: match them to media by file name
    if any(not row['media_id'] for row in proposals):
        products = {p['handle']: p for p in load_products()}
        for row in proposals:
            if row['media_id']:
                continue
            product = products.get(row['product'])
            name = row['image_url'].split('?')[0].rsplit('/', 1)[-1]
            match = next((i for i in (product or {}).get('images', []) if i['url'].split('?')[0].endswith(name)), None)
            if not match:
                sys.exit(f"Can't find {name} on {row['product']} any more. Re-run the dry run.")
            row['product_id'], row['media_id'] = product['id'], match['id']

    mutation = """
    mutation ($productId: ID!, $media: [UpdateMediaInput!]!) {
      productUpdateMedia(productId: $productId, media: $media) {
        mediaUserErrors { field message code }
      }
    }
    """
    by_product = {}
    for row in proposals:
        by_product.setdefault(row['product_id'], []).append({'id': row['media_id'], 'alt': row['new_alt']})
    for product_id, media in by_product.items():
        errors = admin(mutation, {'productId': product_id, 'media': media})['productUpdateMedia']['mediaUserErrors']
        print(('FAILED ' + json.dumps(errors)) if errors else 'ok', product_id, len(media), 'images')


def write_snippet(path, out='snippets/coszus-image-roles.liquid'):
    """Theme-side labels: one '[role:handle/file name]' entry per image, read by coszus-product-card."""
    with open(path) as f:
        proposals = json.load(f)
    lines = sorted({f"[{row['role']}:{row['product']}/{row['image_url'].split('?')[0].rsplit('/', 1)[-1]}]" for row in proposals})
    with open(out, 'w') as f:
        f.write('{%- comment -%}\n'
                '  Generated by docs/scripts/label-flat-lays.py --snippet. Do not edit by hand.\n'
                '  Flat lay / model shot labels kept in the theme until launch, when they move to image\n'
                '  alt text (--apply). snippets/coszus-product-card.liquid captures this list.\n'
                '{%- endcomment -%}\n')
        f.write('\n'.join(lines) + '\n')
    print(f'{out}: {len(lines)} images')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', default='flat-lays', help='folder for review.html and proposals.json (dry run)')
    parser.add_argument('--apply', metavar='PROPOSALS_JSON', help='write the reviewed proposals to Shopify (launch)')
    parser.add_argument('--snippet', metavar='PROPOSALS_JSON', help='write the reviewed proposals into the theme only')
    args = parser.parse_args()

    if args.apply:
        apply(args.apply)
        return
    if args.snippet:
        write_snippet(args.snippet)
        return

    products = load_products()
    proposals, no_flat_lay = propose(products)
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, 'proposals.json'), 'w') as f:
        json.dump(proposals, f, indent=2, ensure_ascii=False)
    write_review(args.out, products, proposals, no_flat_lay)
    already = sum(1 for p in products if labelled(p))
    print(f'{len(products)} products: {already} already labelled, '
          f'{len({r["product"] for r in proposals})} to label ({len(proposals)} images), '
          f'{len(no_flat_lay)} with no flat lay.')
    print(f'Review: {os.path.join(args.out, "review.html")}')


if __name__ == '__main__':
    main()
