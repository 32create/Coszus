# Mercier theme v3 — handoff

Designed by Kye (32create) with Claude, October 2026. Build target: Shopify Plus store `wearemercier.myshopify.com`, on a fresh copy of Shopify's free **Horizon** theme.

The four files in `docs/design/` are the approved designs. Open them in a browser, click around, resize to phone width. Where this document and the previews disagree, ask.

---

## 1. Why Horizon

- Free, maintained by Shopify, regularly updated.
- Block architecture: every custom feature is its own self-contained block with scoped CSS/JS.
- Built in: cart drawer, quick add, predictive search, filters, swatches, back-in-stock, stock counter, image rollover, recommendations, customer accounts, Sign in with Shop.
- Proven for UK streetwear: Trapstar, Cole Buxton and Amicci all run on Horizon.
- **Turn Horizon's default animations off.** The design brings its own motion, and it costs mobile speed.

Pull Horizon updates in deliberately (merge on a branch, test), never automatically.

---

## 2. Design system

### Colours
| Token | Hex | Use |
|---|---|---|
| Ink | `#101010` | Text, primary buttons, Men nav |
| Paper | `#FFFFFF` | Page background |
| Off white | `#F4F4F2` | Product image backgrounds, panels, Women nav |
| Concrete | `#9A9A9A` | Muted text |
| Line | `#DCDCDC` | Borders, dividers |
| Petrol | `#2A3855` | Button hover, Juniors nav, points card |
| Bleu | `#0B4EA2` | Rare accent |
| Rouge | `#C8102E` | **Only** sale, low stock, bag count, errors |
| Gold | `#D4AF37` | **Only** Mercier Points and VIP |
| Progress | `#F4C430` → `#22A05A` | Free delivery bar (yellow to green) |

Red and gold must keep their single meaning. Don't use them decoratively.

### Type
- **Archivo** for everything (Google Fonts). Archivo Black / wide for campaign headlines.
- **Buttons:** Helvetica Neue / Arial, 12px, weight 700, uppercase.
- **Section headings** ("New In", "Best Sellers", "Steal Their Style", "Join the Family"): Archivo 600, `clamp(24px, 2.3vw, 32px)`, uppercase, letter-spacing -0.02em, left aligned. **Exception:** Latest News keeps the big split "LATEST ... NEWS" heading across the full width.
- Body 13–14px. Labels and kickers 11px, letter-spacing ~0.16em, uppercase, Concrete.

### Buttons (LFDY spec)
40px tall, 12px 24px padding, 12px bold caps, **6px corner radius**. On photos: white with ink text, ink on hover. On white: ink with white text, Petrol on hover.

### Layout
- Desktop side gutter **24px**. Mobile **20px** (16px in dense grids). Every section heading lines up on the same left edge.
- Mobile breakpoint **820px**. iPad portrait gets the mobile layout; iPad landscape gets desktop.
- Product cards: **4:5** images on Off white (the ratio the photos are shot at), white flat lays blended with `mix-blend-mode: multiply`. Flat lay first, model shot on hover. "New" in plain 12px text top-left (no box). Name in 14px bold uppercase, price underneath, left aligned. Names clamp to 2 lines. Small Ink stars and "(23)" under the price when the product has reviews (see section 6, Star ratings). Bookmark top-right once the wishlist is built (hidden until then).
- Collection grid (after livefastdieyoung.uk): edge to edge, 2px between columns, 40px between rows (32px on mobile), 48 products per batch, "See more". Bar: the category name in 20px bold uppercase, then a **Model** on/off switch and "N products" on the left (the switch swaps every card to its model shot, remembered), and a plain-text "Filters" with its icon on the right. Hero: a placeholder per department until the campaign photos are ready (section setting). No dividing line. Sort is the first group in the filter drawer, applied with Show results. Cards find the flat lay and model shot from image alt text containing "flat lay" and "on model".

### Accessibility and devices (non-negotiable)
- Inputs 16px on mobile (stops iPhone zooming in).
- Visible focus outlines, labelled icon buttons, Escape closes every drawer/modal.
- Respect reduced motion (all marquees and spins stop).
- No hover-only features on touch screens (the hover quick add bar is hidden on touch; touch gets a "+" instead).
- Safe areas on iPhone (`env(safe-area-inset-*)`) for sticky bars.
- Test: iPhone Safari, Android Chrome, iPad both orientations, laptop, wide desktop. Nothing may overflow horizontally.

---

## 3. Global elements (every page)

**Top bar** — black, scrolls across continuously (does not pause on hover), scrolls away with the page (not sticky). Messages (editable): "Join Mercier Points for rewards" (Join is an underlined link to sign-up), Klarna + Clearpay badges with "Klarna & Clearpay available", "Free UK delivery over £79.99". (Student discount message hidden 23 Oct 2026: no student discount.)

**One rule everywhere: no UK threshold shown to a non-UK visitor.** The top bar delivery message, the product page delivery and returns lines and the Delivery accordion each have International text, shown when the visitor's country (Shopify Markets) isn't the UK, or hidden when it's blank. Next-day is hidden outside the UK. The bag bar already hides outside the UK / GBP.

**Nav** — frosted glass, fixed, rounded.
- Desktop: Men / Women / Juniors left (department switch), oval MERCIER logo centre, then search, wishlist, bag (count in a red dot, hidden when 0), gold Points coin, divider, account.
- Mobile: menu, search, logo dead centre, bag, on every page. Slimmer. **No divider lines.** No M / W / J toggle (removed October 2026): the side menu's department tabs and the homepage shop cards do that job.
- Department names (desktop) open the department collection on every page. Switching in place on the homepage is still a header setting, off by default.
- Position is pure CSS (sticky under the top bar), so the nav is in place from first paint with or without JS.
- Department colours: Men = Ink glass, white logo. Women = Off white glass, ink logo. Juniors = Petrol glass, white logo. The department also sets the New In tab.

**Mobile side menu** — dept tabs (switch the menu in place; each menu starts with "Shop all [Men]"), "Search Mercier" bar, big category links (Sale in red), Mercier World / Mercier Points, then Customer service + Follow (collapsible), follow-for-points line, country selector. On mobile the footer link columns are removed because they live here.

**Search** — panel drops from the top. Empty state: big search line with rotating placeholder ("Try 'Scuba set'"...), "Shop" as big text links (Men, Women, Juniors, Sale in red) and a quiet "Popular" text list, recent searches when there are any. No product images until typing. Typing: instant results (6 across desktop, list on mobile), matched letters bold, typo correction ("Showing results for hoodie"), streetwear synonyms (trackie, tracky, bottoms, tee, jorts, kids, jumper). Enter / View all goes to a full results page with filters. Live: Shopify predictive search + **Search & Discovery** app synonyms and boosts.

**Bag drawer** (Horizon cart drawer, restyled)
- Title "Your bag" + count in a black circle.
- Free delivery bar, yellow→green, with a finish marker showing "£79.99 / Free delivery" that fills green with a tick when reached. Copy: "You're £X away from free UK delivery" / "You've unlocked free UK delivery".
- Line items: large image, name, size, qty +/−, remove. Sale items show the old price struck through + tag "Sale". When a hoodie and its matching bottoms are both in the bag, both get a black "✓ Complete the set" tag.
- Add-ons: small cards (image, name, price only) titled "Complete the set" (if a matching piece exists) else "Add £X for free delivery" else "Goes well with". Tapping goes to the product.
- Footer: Total with savings ("£93.00 ~~£100.00~~ SAVE £7.00"), delivery, "You'll earn X Mercier Points", "Checkout securely" button, express row (Shop Pay, Apple Pay, Google Pay, Clearpay), Clearpay split, trust row: Next-day delivery · 14-day returns. A rating slot (green star, title + score, linked to the live score) exists in Theme settings but is off and blank by default: no site-wide score anywhere until there's a real one.
- Empty: "Your bag is empty" + Shop men / women / juniors.

**Mercier Points** — gold coin in the nav (not a floating launcher: Smile's launcher is hidden in Smile Admin). The coin opens **Smile's own panel** (`SmileUI.openPanel`, Smile's documented JS API, see `assets/mercier-smile.js`), which has the balance, ways to earn and rewards. The theme's dropdown panel (header "Mercier Points / Welcome to the family", Join now + Sign in, rows for Ways to earn, Ways to spend) is the fallback when Smile UI isn't on the page. The Points page's signed-in button opens the same panel, and the Account page card shows the real balance through Smile.js (needs the JavaScript SDK on in Smile Admin > Settings > Developer Tools). **No VIP tiers**: Smile runs Mercier Points without them. Hidden on mobile (use side menu).

**Footer** — "Join the Family" email sign-up (birthday + shopping-for reveal), follow-for-100-points line, 5 columns (desktop), roundel emblem, © 2026 Mercier, Privacy, Terms, payment badges (Visa, Mastercard, Amex, Apple Pay, Google Pay, Clearpay).

**Pop-ups** (max two, never stacked)
- Country pop-up: only for visitors outside the UK. Use Shopify Markets.
- Mystery offer: premium split layout (MotoX photo left, off-white right). "The Mercier Family / A mystery offer, on us." Email → reveals 10–25% code. Once per visitor, after 8s or exit intent. **Build in Omnisend, not the theme** (unique codes + welcome flow).

---

## 4. Homepage (`01-homepage.html`)

In order:
1. **Hero slideshow**, 3 slides. Progress indicator: the active slide is a bar filling left to right, others are dots. Desktop full height. Mobile 4:5 (capped to screen height on tablets).
   - Swipe left/right on phones, click-and-drag on desktop. Any swipe or drag stops autoplay for the rest of the visit (browser session). Reduced motion: no autoplay.
   - No pause/play button (removed October 2026). Swipe or drag stops autoplay; reduced motion never autoplays.
   - Slide 1: landscape video (mobile reframed to the group), "SPEED COLLECTION" faded grey at top, Shop now button. Poster image while loading, pauses off-screen.
   - Slide 2: Hollywood image, no text.
   - Slide 3: MotoX rooftop, "New in for men & women / MotoX Collection / Mesh race tops & racer jackets / Shop now" + shoppable + dots.
2. **Shop cards** (section "Mercier shop cards"): a "Shop" section heading (left aligned, normal section heading style; editable, blank hides it), then three cards. Each card is a photo with a plain text label underneath (Men / Women / Juniors), left aligned, no button or box; the whole card is one link. Square photos by default, with an "Image shape" setting (Square 1:1 / Portrait 4:5), cover crop, no rounded corners, 12px gap like the product grid. Three across on desktop; desktop hover is a slight photo zoom and an underline on the label. Phones: a swipe row showing about 1.3 cards so the next one peeks in, label under each, with its own bottom padding setting (24px) so the cards don't run into New In. Each card is a block (image, label, link). Neutral grey until a photo is picked. Photos are lazy-loaded so the hero stays the first thing to load. Replaces the old shop buttons + 5-model lineup strip.
3. **New In**: "New In" left, Men / Women / Juniors tabs right on one line. Six cards across desktop, three on mobile, drifting slowly (pause on hover/touch). Flat lays first, model shot on hover.
4. **Latest News**: big split heading, 3 cards (video/image, title, category, one line, link), "See all latest news" button (hidden on mobile).
5. **Tracksuits banner**: full width, copy and button bottom right (centred bottom on mobile, square crop).
6. **Steal Their Style**: community photos with + hotspots that open a small rounded product card (image, name, price, arrow). Closes on outside tap or Escape. See section 13 for swapping photos. "Tag @mercierworld to get featured" + Follow button **below** the photos. One swipe row on mobile.
7. Footer.

Best Sellers was removed from the homepage (October 2026). The product row section can still show best-selling order if it's wanted elsewhere.

**Placeholders to replace before launch:** the hero video and tracksuits banner are borrowed (Episodes / Hoodrich). They cannot go live.

---

## 5. Collection page (`02-collection.html`)

One template for Men, Women, Juniors (and Sale), switching hero, title and products.
- **Hero**: about half the screen, campaign image, big uppercase department name only (no breadcrumb or intro line; both can be turned back on in the theme editor).
- **Category tiles**: portrait grey tiles with the garment shown whole (flat lays), label underneath, no counts. "All" and "Sale" (red text) are text tiles. Active = darker tile + underline.
- **Bar** (not sticky): "All · 18 products", Filter button, Sort select.
- **Filter**: right drawer on desktop, bottom sheet on mobile. Size, Colour swatches, Price, On sale. Search & Discovery.
- **Grid**: 4 across desktop, 2 mobile. Tags: "Low stock" (red, ≤10 left), "New", "Best Seller" (grey, from the Best Seller collections in Theme settings or the `best-seller` product tag). No red Sale tags in the main grid: sale items show grey struck-through price and sit after full price. If more than half a range is discounted (Juniors), keep sale in the main grid.
- **Colour dots** under products with colour siblings — use Shopify **combined listings** (Plus).
- **Quick add** on hover (desktop with a mouse): S M L XL appear at the bottom of the image. On touch and mobile: a small "+" bottom right of the image (44px tap target) opens a size sheet like the product page's, sold-out sizes faded. Products with no size option add straight away.
- **Editorial tiles** every ~12 products (MotoX, The Scuba Set).
- **Load more** in batches of 24 with "You've seen X of Y" progress.

---

## 6. Product page (`03-product.html`)

- **Desktop**: images two-across in a long scrolling column (67%), buy panel sticky on the right (33%). **Mobile**: swipe gallery with dots, info below, sticky bottom bar (name, price, Add to bag) that appears once you scroll past the main button.
- No breadcrumb. Title, star rating (only when the product has reviews, see below), price (no "incl. VAT"), then "4 interest-free payments of £X with" + joined Klarna/Clearpay badges.
- Colour swatch.
- **Size**: "Size" + red "Only X left" when the chosen size has ≤10. "SIZE GUIDE" with ruler icon on the right (opens size guide; bottom sheet on mobile). Sizes in one row of soft grey boxes, selected = dark, sold out = faded (no strike line).
- Add to bag (reads "Select a size" until chosen) + bookmark. On mobile with no size chosen, the sticky button opens a size sheet that adds straight to the bag.
- "Boxy fit. Model is [height] and wears [size]." (from product metafields), straight under the sizes so it sits with the Size guide link on every product. Products without a guide of their own use the department guide (Men / Women / Juniors).
- **Size guide**: one line under the title saying what was measured ("Garment measurements, laid flat" by default), and a cm / in switch (inches first in the US).
- **Perks**: spinning gold Mercier coin "Order and get X Mercier Points" · Free UK delivery over £79.99 · live next-day countdown ("Order within 1h 20m for next-day delivery", 2pm cut-off Mon–Thu, otherwise "Next-day delivery available, order by 2pm Mon to Thu") · 14-day returns in the UK.
- **Complete the set** card with inline S M L XL buttons that add the matching piece.
- Accordions: Description, Size & fit, Delivery & returns (Reprimo layout, real policy, see section 9), Care.
- **Worn by the family**: below the accordions, static row of customer photos, tap to enlarge, @mercierworld link. Product-specific photos once tagged content exists.
- **You might also like**: 4 products.
- **No reviews section** for now (removed until a review app has real reviews).
- **Star ratings** (October 2026): per product only, **no site-wide score anywhere**. Ink stars + "23 reviews" under the title on the product page, small stars + "(23)" under the price on cards (collection, New In rows, search, recommendations, wishlist). Read straight from Shopify's standard `reviews.rating` and `reviews.rating_count` metafields, which Judge.me and most review apps write, so no app embed or script. Shown only when a product has a rating above 0 and at least one review; otherwise nothing renders. Ink, not Gold or Rouge (they keep their single meanings). Theme settings → **Star ratings** switches cards and product page separately. The product page setting also controls `aggregateRating` in the product's structured data (added only when a rating exists), because Google wants the markup to match what's visible. Stars are one CSS-masked span (`snippets/mercier-rating.liquid`, styles in `assets/mercier.css`), no extra requests.
- Add to bag opens the bag drawer.

---

## 7. Other pages (`04-other-pages.html`)

- **Account**: sign in, Sign in with Shop, create account panel. Signed in: points card (gold coin, balance, progress), orders, addresses, details. Live: Shopify customer accounts.
- **Wishlist**: saved products with size buttons that add to bag, empty state. Custom block saving to the customer (metafield) — no wishlist app.
- **Mercier Points**: hero with big gold coin, how it works (Join, Earn, Spend), ways to earn, ways to spend. **1 point per £1, 100 points = £5 off (5% back, kye 5 Oct 2026), free delivery is also a reward, points last 12 months. Bonuses: create account 50 (kye 5 Oct), birthday 50, review 20, follow 20 per platform.** No tiers (Smile has none set up).
- **Help**: Contact (contact@mercieruk.co.uk, Mon–Fri 9–5, postal address), Delivery table, Returns, Size guide, FAQs. Replaces the PageFly pages.
- **Mercier World**: hero, origin story (October 2017, Mercer → Mercier, dealer in textiles and fabrics), Founder Talks video, the family section.
- **Latest News**: list and article layout (Shopify blog).
- **404**: "This page has gone off the grid" + Shop men/women/juniors + search.

---

## 8. Data model (metafields / metaobjects)

Put product info in Shopify, not hard-coded, so features work on every new product:
- `custom.set_partner` (product reference) — drives Complete the set on the product page and in the bag.
- `custom.size_guide` (metaobject reference) — size table per product type.
- `custom.fit_note` and `custom.model_info` (text).
- `custom.flat_lay` — first media should be the flat lay on grey; second the model shot.
- Badges via tags or metafield (`new`, etc.).
- Combined listings for colour variants.
- Customer metafield for wishlist.
- `reviews.rating` (rating) and `reviews.rating_count` (integer) — Shopify's standard review metafields, written by the review app, not by hand. Drive the star ratings and `aggregateRating`.

Photo standard: flat lay on grey first, model shot second, same crop, consistent naming.

---

## 9. Real store facts

- Free UK delivery over **£79.99**.
- UK standard (Royal Mail Tracked or DPD) 2–4 working days, £4.99. UK next working day (DPD) £6.99, order by 2pm Mon–Thu. Europe from £5.99, rest of Europe £8.99, USA/Australia £9.99, Canada/NZ £14.99, rest of world £19.99. Customs covered up to €150. No next day during Black Friday week.
- Returns: 14 days UK, 21 days international, unworn with tags, customer pays return postage unless Mercier's error, processed within 7 working days. **All returns are refunded as store credit (kye, 5 Oct 2026). UK/EU customers can ask for money back within 14 days of delivery (legal right); faulty or wrong items always get money back.** 1/1 sample sale items, underwear and socks can't be returned.
- Contact: contact@mercieruk.co.uk. Mercier, J & S House, Denton Drive, Northwich, CW9 7LU.
- About: launched October 2017 by Ben Mercer.

---

## 10. Apps

**Keep:** Smile (Mercier Points, rebranded, no VIP tiers), Omnisend (email/SMS, mystery offer), Klarna, Clearpay, one review app (Judge.me or any app that writes `reviews.rating` / `reviews.rating_count`; the theme reads those, so leave the app's own star widgets and embeds off), Shopify Search & Discovery.

**Remove at launch:** PageFly, Shogun, Instafeed, duplicate Klaviyo code (pick Omnisend), anything else not on the keep list.

**Since the 21 Oct security review:** the old apps come out on Mon 26 Oct 2026 (launch checklist step 9), not at launch, apart from Peek replay (`replay.js`, F23), which Kade gets off before launch. Keep Triple Whale too: its pixel in Customer events stays on, and only its Triple Pixel theme embed is off (F2).

**Smile rebrand:** name "Mercier Points"; colours Ink / Petrol / Off white / Gold; gold emblem icon; MotoX banner; launcher hidden (the nav coin opens it); Smile branding hidden (paid plan); connect to Omnisend for points balance and referral data.

---

## 11. Placeholders (in [brackets] in the previews)

Must be confirmed with Ben before launch: points for free delivery, account / birthday / referral rewards (rows left off until then), mystery offer range and whether it stacks with points, model height/size, size guide measurements, next drop date, party venue/time/RSVP, TikTok handle, customer/order examples. (The bag's "Rated 4.6/5" placeholder is gone; any site-wide score has to be real and linked.)

---

## 12. Launch checklist (carried over from v2 work)

- Remove fake review content and the old fake Trustpilot rating.
- Remove the foreign/unknown script and `replayapp.tk`.
- Switch on Klarna (only Clearpay was confirmed), Shop Pay.
- Install a review app and Search & Discovery synonyms. Check the review app syncs `reviews.rating` / `reviews.rating_count`, and that no old or fake ratings have been imported into those metafields (they'd show as stars).
- Exclude sale items from main Men/Women collections; point Sale tiles at Mens Sale / Womens Sale.
- Update the delivery page to mention free delivery over £79.99.
- Tracking: Meta pixel + Conversions API, GA4, Omnisend events, checked before launch.
- Checkout styling in the checkout editor: oval logo, Ink buttons 6px radius, Archivo, Off white summary.
- Full test on real iPhone, Android and iPad: browse, add to bag, checkout with card, Klarna, Clearpay, Shop Pay.
- Launch in a quiet week. Keep the old theme ready to republish.
- After launch: transfer this repo to a Mercier-owned GitHub account.

---

## 13. How to change the Steal Their Style photos

Anyone on the team can do this in the theme editor. No code.

1. **Online Store → Themes → Customize** on the theme, then open the homepage.
2. In the left sidebar, find **Mercier steal their style** and click the photo you want to change (each photo is a block). Add one with **Add block → Photo**; drag to reorder.
3. **Photo**: square, at least 1000px wide. Other shapes are cropped to a square from the centre.
4. **Product 1** / **Product 2**: pick the products in the photo. Leave one empty to hide its dot.
5. While the photo is selected, its dots show on the preview numbered **1** and **2** (an empty product shows as a dashed dot). Move **Product 1 dot: across** and **down** until dot 1 sits on the garment. 0 across is the left edge, 100 the right; 0 down is the top, 100 the bottom. Same for dot 2.
6. Click a dot in the preview to check the card, then **Save**.

Tips: put dots on the garment itself, not the face or the edge of the photo. Five photos fill the desktop row; more than five scroll sideways.
