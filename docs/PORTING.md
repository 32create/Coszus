# Coszus rebuild: what came from Mercier

Branch `horizon-rebuild`, set up 15 Nov 2026. This is the Mercier v3 theme (main @ d198358, 12 Nov 2026) renamed for Coszus.

## Why this route
The live Coszus theme is Shopify **Studio 15** (the Dawn family). Mercier v3 is **Horizon 4.2**. They're different architectures, so Mercier sections can't be dropped into Studio. You'd be rewriting each one.

Starting from the Mercier code instead means every feature below already works, and the job becomes restyling to the Coszus mockup plus putting Coszus's apps back. The old Studio theme stays on `main` as the reference.

## What was done to the Mercier code
- Every `mercier-` file, class, setting id, translation key and JS name is now `coszus-`.
- All Mercier copy, links and contact details have been swapped or blanked: Instagram and TikTok links are blank, and the contact email is `info@coszus.com` (**check that's the right inbox**).
- **Removed:** Mercier World page, Mercier Points page, the design-system page, and the Smile loader (`coszus-smile`). Coszus runs Growave, not Smile.
- **Points coin in the header is off** (`show_points: false`). The points code is still in the header, bag and product page, so it can be pointed at Growave later or deleted.
- `snippets/coszus-image-roles.liquid` is emptied. That was Mercier's hardcoded flat-lay list. Coszus cards should find the flat lay and model shot from image **alt text** ("flat lay" / "on model").
- `assets/coszus-logo.png` is a blank placeholder. **Swap in the Coszus logo** (or set it in the header settings).
- Free delivery bar default is £80 (Coszus's threshold).
- Black Friday switch is off by default.
- The Returns portal section's PostCo URL is blank.
- Templates (`templates/*.json`) and `config/settings_data.json` still hold Mercier's **layout** (sections, order, settings). Images and collection picks point at Mercier's store, so they'll show empty until you set them in the editor.

## What carries over and works out of the box
| Feature | Where | Coszus note |
|---|---|---|
| Header, frosted nav, mobile side menu | `sections/coszus-header.liquid` | Departments are Men / Women / Juniors. Coszus is menswear: hide Women and Juniors (task 1) |
| Scrolling top bar | `sections/coszus-top-bar.liquid` | Rewrite messages: free delivery £80, free swim shorts £125 |
| Search panel, predictive search, synonyms | `coszus-search*` | Needs Search & Discovery synonyms set up on Coszus |
| Bag drawer: free delivery bar, complete-the-set tags, add-ons, savings line | `snippets/coszus-bag-*`, `assets/coszus-bag.js` | Replaces Kaching's cart. The £125 free swim shorts tier needs adding as a second step on the bar, or keep Kaching for the gift only |
| Product cards: flat lay first, model on hover, New / Low stock tags, stars, quick add | `snippets/coszus-product-card.liquid`, `coszus-quick-add` | Exactly what you asked for on Coszus |
| Collection page: hero, category tiles, Model switch, filters drawer, load more, editorial tiles | `sections/coszus-collection.liquid` | Restyle to the mockup |
| Product page: gallery, sticky buy panel, size row, low stock, size guide with cm/in, fit + model line, Klarna/Clearpay line, next-day countdown, accordions, complete the set, worn-by-the-family | `sections/coszus-product.liquid` | Check which BNPL Coszus actually has before showing badges |
| Complete the set (product page + bag) | `custom.set_partner` | Create the metafield on Coszus (see METAFIELDS.md) |
| Size guide sheet | `custom.size_guide` metaobject | Create the metaobject on Coszus |
| Black Friday system: switch, start time, ticker, hero slide, tiles page, sale chips | Theme settings > Black Friday, `sections/coszus-black-friday.liquid` | Coszus drops live on sale 29/30 Nov, so this is worth wiring first |
| Wishlist (browser-saved) | `sections/coszus-wishlist.liquid` | The cross-device worker app (`apps/wishlist`) was not copied |
| Account, help, contact, returns, 404, blog/news | `coszus-account`, `coszus-help`, `coszus-404`, `coszus-news` | Rewrite copy |
| Steal Their Style hotspots | `sections/coszus-steal-their-style.liquid` | Needs Coszus UGC photos |
| Join panel / email sign-up | `coszus-join*` | Mercier's was wired for Omnisend. Coszus uses Klaviyo, so check the form posts to Klaviyo |
| Star ratings | `reviews.rating` metafields | Shows nothing until a review app writes them |

## Coszus things to put back (they live in the old Studio theme on `main`)
- **Apps:** Growave rewards (`page.growave-reward-page`), Kaching (cart / bundles), Klaviyo, and Sections Store (`ss-*` sections). PageFly and Foxify shouldn't come back.
- **Product templates:** `bundle-products`, `cardholder`, `coming-soon`, `pre-order`, `no-fit-bar`, `no-qty-remaining`, `variant-image-only`. Map each one to a Horizon product template, or drop any that aren't used.
- **Collection templates:** `coszus-editions`, `collection-title`.
- **Pages:** `ss26-early-access`, `returns`, `contact`.

## Build order for Monday evening
1. Men only: hide Women / Juniors in the header, menu, search and shop cards (Theme settings > Departments).
2. Tokens: swap Mercier's colours and fonts for Coszus's (Instrument Sans, palette from the mockup) in `snippets/coszus-tokens.liquid` and `assets/coszus.css`. This does most of the restyle in one go.
3. Header + top bar + footer to match the mockup.
4. Product card + collection page.
5. Product page.
6. Bag: add the £125 swim shorts tier.
7. Homepage sections in the editor.
8. Black Friday page for the 29/30 Nov drop.
9. Metafields on Coszus (`docs/scripts/create-metafield-definitions.mjs`, set the store), then fill set partners and size guides.
10. Connect this branch to a **new unpublished** theme on Coszus and check on phone.

## Mockup
The approved Coszus site mockup is in the Coszus plan page (Claude artifact, site/ folder: index, collection, product, black-friday, our-story, size-guide, contact, returns, shipping). Export those HTML files into `docs/design/` before restyling, so the build has them to match against.
