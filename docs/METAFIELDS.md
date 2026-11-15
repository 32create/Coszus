# Coszus product data (metafields and metaobjects)

HANDOFF section 8. Product info lives in Shopify, not in the theme, so features work on every new product.

These are **definitions only**. Creating them adds fields to the Shopify admin; it doesn't change any product. Definitions are store-wide (not per theme), so create them with Kye's go-ahead.

## Definitions

| Field | Owner | Type | Used for |
|---|---|---|---|
| `custom.set_partner` | Product | Product reference | Complete the set on the product page and in the bag. Set it on **both** pieces (hoodie → joggers, joggers → hoodie). |
| `custom.size_guide` | Product | Metaobject reference (`size_guide`) | Size guide sheet on the product page. One entry per product type, reused across products. |
| `custom.fit_note` | Product | Single line text | "Boxy fit." straight under the sizes, below the Size guide link. |
| `custom.model_info` | Product | Single line text | "Model is 6ft 1 and wears M." after the fit note. |
| `custom.flat_lay` | Product | File (images only) | Optional override for the card image. Leave empty when the first product image is already the flat lay. |
| `custom.badge` | Product | Single line text, choices: New, Back in stock, Limited | Plain-text tag top left on product cards. Empty = no tag. |
| `custom.wishlist` | Customer | List of product references (max 100) | Saved products for signed-in customers. See the wishlist note below. |

Not in the setup script: `reviews.rating` and `reviews.rating_count` are Shopify's standard review metafields. The review app (Judge.me or similar) creates and fills them; the theme only reads them for the star ratings and `aggregateRating`. Don't create or edit them by hand.

Metaobject **`size_guide`** (storefront access on, not publishable so entries are always live):

| Field | Type | Notes |
|---|---|---|
| `name` | Single line text, required | e.g. "Hoodies", "Joggers". Used as the entry's display name. |
| `unit` | Single line text, choices: cm, in | The unit the table is written in. The guide converts it: visitors get a cm / in switch (1 in = 2.54 cm, rounded to 0.5), inches first in the US, cm everywhere else. The size column is never converted. |
| `measured` | Single line text | One line under the guide's title saying what was measured, e.g. "Body measurements". Empty shows "Garment measurements, laid flat". |
| `table` | Multi-line text | One row per line, cells split by `\|`. First line is the header. Example below. |
| `how_to_measure` | Rich text | |
| `image` | File (images only) | Optional measuring diagram. |
| `fit_notes` | Multi-line text | |

```
Size | Chest | Length | Sleeve
S | 104 | 70 | 62
M | 110 | 72 | 63
L | 116 | 74 | 64
XL | 122 | 76 | 65
```

Cells can be a number (`104`, `104.5`) or a range (`96-100`); both convert. Anything else (`–`, `One size`) shows as written. A header cell like `Chest (cm)` swaps to `(in)` with the switch.

**Already created the `size_guide` metaobject?** The script never edits an existing definition, so add the `measured` field by hand: Settings → Custom data → Metaobjects → Size guide → Add field → Single line text, key `measured`.

## Rules the theme will rely on

- **Photo order:** first media = flat lay on grey, second = model shot, same crop, consistent file names (e.g. `scuba-hoodie-black-1-flatlay.jpg`, `scuba-hoodie-black-2-model.jpg`). Product cards show the first image and swap to the second on hover.
- **"New" badge:** `custom.badge = New`. The theme also treats the product tag `new` as New, so bulk tagging works. The metafield wins if both are set.
- **Low stock** isn't a field. Product page: the chosen size has 10 or fewer left. Product cards: the whole product (all sizes) has 10 or fewer left (Theme settings → Product cards).
- The store's existing **"Low stock" product tag** (on most products, from an old app) is ignored. The theme works it out from stock.
- **Sale** isn't a field: it comes from compare-at price.
- **Colour dots** on cards come from a **Colour option on the product's variants** (with Shopify swatches, via the category "Color" option), not from the Combined Listings app. Coszus currently lists each colour as its own product with only a Size option, so no dots show until colours are variants of one product.

## What the product page reads (Task 5)

Read only; nothing is written. New fields first, then the store's existing fields as fallbacks so the page works before anything is filled in:

| Feature | Reads | Fallback (existing store data) |
|---|---|---|
| Complete the set | `custom.set_partner` | First available product in `custom.upsell_products`, shown as "Goes well with" |
| Fit line | `custom.fit_note` | `shopify.fit` label |
| Model line | `custom.model_info` | `custom.model_height_and_wear_size` (on 538 products) |
| Size guide | `custom.size_guide` metaobject | Size guide blocks in the product section: by product type, then the product's department guide (Men / Women / Juniors, from the department collections in Theme settings), then a guide with no type or department |
| Care accordion | `custom.materials_care` | Block text |
| Worn by the family | `custom.out_about_images` | Family photo blocks |
| Colour swatches | `pl_swatches.groups` (left by the Platmart Swatches app) | None |
| Colour name | `shopify.color-pattern` label | None |

`custom.delivery_returns` (on 671 products) is **not** used: it still says "order before 3pm" for DPD. Delivery & returns comes from the section block, written from HANDOFF section 9.

**Colour swatches after Platmart goes.** The group data stays on the products when the app is removed, but nothing will add new products to a group. Before launch, either keep the groups up to date by hand, or create a `custom.colour_siblings` field (list of product references) and switch the section to it. That's a one-line change in `sections/coszus-product.liquid`.

## Clash with the live store: `custom.size_guide` already exists

The store already has a product definition **`custom.size_guide` of type *page reference*** ("Size Guide"), left over from the old setup. It had no values when checked (October 2026). Shopify can't change a definition's type, so before the new one can be created:

1. Shopify admin → Settings → Custom data → Products → "Size Guide" → check it's still unused → Delete definition. This is a store-wide change, so it's Kye's call.
2. Then create the definitions below. Until then, the script reports `CONFLICT product.custom.size_guide` and skips it.

The store also has older product fields such as `custom.model_height_and_wear_size` and `custom.upsell_products`. Check whether they hold data worth moving into `custom.model_info` and `custom.set_partner` before Task 5. Don't delete them as part of this.

## How to create them

**Option A: by hand** (simplest). Shopify admin → Settings → Custom data. Create the `size_guide` metaobject first (Storefronts access on), then the product fields, then the customer field, using the tables above. Pin the product fields so they show on the product page in admin.

**Option B: script** (`docs/scripts/create-metafield-definitions.mjs`, Node 18+). It only creates definitions that are missing, never edits or deletes one, and never touches products or customers. Shopify no longer allows new custom apps made in the admin, so the token comes from a Dev Dashboard app:

1. Shopify Dev Dashboard (dev.shopify.com, with an account in Coszus's organisation) → Create app → e.g. "Coszus setup".
2. Admin API scopes: `read_metaobject_definitions`, `write_metaobject_definitions`, `read_products`, `write_products`, `read_customers`, `write_customers`. Release the version and install it on `COSZUS-STORE.myshopify.com`. Copy the Client ID and secret.
3. Get a token (valid 24 hours):
   ```bash
   curl -s -X POST https://COSZUS-STORE.myshopify.com/admin/oauth/access_token \
     -H 'Content-Type: application/json' \
     -d '{"client_id":"CLIENT_ID","client_secret":"CLIENT_SECRET","grant_type":"client_credentials"}'
   ```
4. Dry run first, then apply, using the `access_token` from step 3:
   ```bash
   SHOPIFY_STORE=COSZUS-STORE.myshopify.com SHOPIFY_ADMIN_TOKEN=TOKEN node docs/scripts/create-metafield-definitions.mjs
   SHOPIFY_STORE=COSZUS-STORE.myshopify.com SHOPIFY_ADMIN_TOKEN=TOKEN node docs/scripts/create-metafield-definitions.mjs --apply
   ```
5. Uninstall the setup app afterwards.

## Wishlist

A Shopify theme on its own **can't write a customer metafield**. The Storefront API has no customer metafield writes. The Customer Account API does, but a theme can't get its token without the Headless channel or an app extension. So "saving to the customer metafield, no wishlist app" needs one of:

1. **A small private custom app** (not from the App Store) with an app proxy: the theme posts to `/apps/wishlist`, the app checks the signed-in customer and writes `custom.wishlist`. Needs hosting (a serverless function). This is still technically an app.
2. **Browser-only wishlist** (local storage): no app, but it doesn't follow the customer across devices.

The theme can read `customer.metafields.custom.wishlist` either way, so the definition is safe to create now.

**Built in Task 7:** option 2, with the hook for option 1. Lists live in the browser; the Wishlist page also reads `custom.wishlist` and merges it in, and `assets/coszus-wishlist.js` syncs with the app proxy once its path is set in Theme settings.

**Built in Task 7b:** option 1, the private app (`apps/wishlist/`, a Cloudflare Worker). Setup, testing and how to turn it off: `docs/WISHLIST-APP.md`.
