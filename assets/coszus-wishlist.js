/*
  Coszus wishlist (HANDOFF section 7, docs/FOUNDATIONS.md "Wishlist").

  Bookmark buttons ([data-coszus-save]) on Coszus product cards and the product page save a
  product. Saved products live in the browser (localStorage 'coszus:wishlist'), for guests and
  signed-in customers alike, and show on the Wishlist page (sections/coszus-wishlist.liquid).

  Loaded once per page as a low-priority module (snippets/scripts.liquid). Nothing runs until the
  page has parsed, and buttons are marked when the browser is idle, so it never holds up the page.

  ACCOUNT SYNC. A theme can't write a customer metafield on its own, so the private wishlist app
  (apps/wishlist, docs/WISHLIST-APP.md) serves an app proxy that reads and writes the signed-in
  customer's `custom.wishlist` metafield (list of product references). Put its path in
  Theme settings > Product cards > "Account wishlist endpoint" (e.g. /apps/wishlist) and this file
  syncs signed-in customers with it:
    GET  {endpoint}                          -> { "handles": ["scuba-zip-hoodie-black", ...], "account": "<key>" }
    POST {endpoint}  { "handles": [...] }    -> 2xx (replaces the list)
  On sign-in (the first signed-in page after a signed-out one, or a different account from the one
  this browser last synced with), the browser list is merged in, so nothing saved as a guest is
  lost. After that the account is the source of truth, so something removed on another device
  stays removed, unless a change made here hasn't reached the account yet (offline, closed tab),
  in which case this browser's list is sent up. Empty endpoint =
  signed-in customers keep a browser list like guests. The theme's config carries no customer email or ID:
  the app gets the customer from Shopify's signed app proxy request, and "account" is its opaque
  key for that customer (a keyed hash, not the ID).

  JOIN THE FAMILY. A guest's first save shows the Join the Family panel once (Theme settings >
  Product cards > "Ask guests to join after their first save"). The save has already happened in
  the browser; the panel's code and markup only load at that point (assets/coszus-join-panel.js).
  Never shown to signed-in customers, or again once joined or dismissed.

  OMNISEND. For signed-in customers who allowed marketing (accepted the cookie banner, or no consent
  is needed where they are), when Omnisend's script is on the page, saves and removals send "added
  product to wishlist" / "removed product from wishlist" events. Omnisend's own app embed identifies
  signed-in customers, so this file never sends their email. Without Omnisend or marketing consent
  nothing is sent.
*/

const KEY = 'coszus:wishlist';
const MAX = 100;
const CHANGE = 'coszus:wishlist-change';
// The account key this browser list was last synced with ('1' if the app sent none; cleared on every
// signed-out page), and whether a change here hasn't reached the account
const SYNCED = 'coszus:wishlist-account';
const DIRTY = 'coszus:wishlist-dirty';

/** @typedef {{ h: string, id?: string, t: number }} Item */

/**
 * @returns {{ endpoint: string, customer: boolean, joinPanel?: boolean }}
 */
function readConfig() {
  try {
    const el = document.getElementById('CoszusWishlistConfig');
    if (el?.textContent) return JSON.parse(el.textContent);
  } catch (e) {}
  return { endpoint: '', customer: false };
}

const config = readConfig();
const accountSync = Boolean(config.customer && config.endpoint);
// Shared with assets/coszus-join.js: 'joined', 'dismissed' or 'shown'
const JOIN = 'coszus:join';

/** @param {string} key */
function getFlag(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch (e) {
    return '';
  }
}

/**
 * @param {string} key
 * @param {string} value - Empty removes it
 */
function setFlag(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch (e) {}
}

// Signed out: whatever is saved next is a guest list, merged in at the next sign-in
if (!config.customer) setFlag(SYNCED, '');

/** @returns {Item[]} */
function read() {
  try {
    const items = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(items) ? items.filter((item) => item && typeof item.h === 'string') : [];
  } catch (e) {
    return [];
  }
}

/**
 * Saves in this browser only
 * @param {Item[]} items
 */
function save(items) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX)));
  } catch (e) {}
  document.dispatchEvent(new CustomEvent(CHANGE, { detail: { handles: items.map((item) => item.h) } }));
}

/**
 * Saves here and, for signed-in customers, in their account
 * @param {Item[]} items
 */
function write(items) {
  save(items);
  if (accountSync) {
    setFlag(DIRTY, '1');
    pushToAccount(items.slice(0, MAX).map((item) => item.h));
  }
}

let sending = false;
/** @type {string[] | null} */
let queued = null;

/**
 * One request at a time, always the latest list, so quick taps can't land out of order.
 * keepalive lets the last one finish if the visitor leaves the page.
 * @param {string[]} handles
 */
async function pushToAccount(handles) {
  queued = handles;
  if (sending) return;
  sending = true;
  while (queued) {
    const body = JSON.stringify({ handles: queued });
    queued = null;
    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
      });
      if (response.ok && !queued) setFlag(DIRTY, '');
    } catch (e) {}
  }
  sending = false;
}

/**
 * The account's list arrived, from the app (fresh) or the Wishlist page's Liquid (as of page load).
 * @param {string[]} handles
 * @param {boolean} fromApp - Only the app's answer is allowed to send anything back
 * @param {string} [account] - The app's key for the signed-in account
 */
function applyAccount(handles, fromApp, account = '') {
  const local = read();
  const synced = getFlag(SYNCED);
  if (!synced || (account && synced !== account)) {
    // Sign-in, or a different customer from last time: keep the guest list and the account's
    const merged = mergeHandles(local, handles);
    if (!fromApp) {
      if (merged.length !== local.length) save(merged);
      return;
    }
    setFlag(SYNCED, account || '1');
    if (merged.length !== handles.length) write(merged);
    else {
      setFlag(DIRTY, '');
      save(merged);
    }
  } else if (getFlag(DIRTY)) {
    // A change made here never reached the account: this browser wins
    if (fromApp) write(local);
  } else {
    // The account wins, so removals on another device stick. Keep what this browser knows about each item.
    const known = new Map(local.map((item) => [item.h, item]));
    const next = mergeHandles([], handles).map((item) => known.get(item.h) || item);
    const same = next.length === local.length && next.every((item, i) => item.h === local[i].h);
    if (!same) save(next);
  }
}

async function pullFromAccount() {
  try {
    const response = await fetch(config.endpoint, { headers: { Accept: 'application/json' } });
    if (!response.ok) return;
    const data = await response.json();
    if (Array.isArray(data?.handles)) applyAccount(data.handles, true, typeof data.account === 'string' ? data.account : '');
  } catch (e) {}
}

/**
 * @param {Item[]} items
 * @param {string[]} handles
 * @returns {Item[]}
 */
function mergeHandles(items, handles) {
  const seen = new Set(items.map((item) => item.h));
  const merged = items.slice();
  for (const handle of handles) {
    if (typeof handle === 'string' && handle && !seen.has(handle)) {
      seen.add(handle);
      merged.push({ h: handle, t: 0 });
    }
  }
  return merged;
}

const CoszusWishlist = {
  /** Saved handles, newest first */
  handles() {
    return read().map((item) => item.h);
  },
  /** @param {string} handle */
  has(handle) {
    return read().some((item) => item.h === handle);
  },
  /**
   * @param {string} handle
   * @param {string} [id]
   * @returns {boolean} true if now saved
   */
  toggle(handle, id) {
    const items = read();
    const index = items.findIndex((item) => item.h === handle);
    if (index > -1) {
      items.splice(index, 1);
      write(items);
      track('removed product from wishlist', handle);
      return false;
    }
    items.unshift({ h: handle, id, t: Date.now() });
    write(items);
    track('added product to wishlist', handle);
    return true;
  },
  /** @param {string} handle */
  remove(handle) {
    const items = read();
    const next = items.filter((item) => item.h !== handle);
    if (next.length === items.length) return;
    write(next);
    track('removed product from wishlist', handle);
  },
  /**
   * The customer metafield, rendered by the Wishlist page. With account sync on it's handled like
   * the app's answer (without sending anything back); otherwise it's added without moving anything
   * the visitor saved here.
   * @param {string[]} handles
   */
  merge(handles) {
    if (accountSync) return applyAccount(handles, false);
    const items = read();
    const merged = mergeHandles(items, handles);
    if (merged.length !== items.length) write(merged);
  },
};

// @ts-ignore
window.CoszusWishlist = CoszusWishlist;

/** @param {ParentNode} root */
function mark(root) {
  const saved = new Set(CoszusWishlist.handles());
  for (const button of root.querySelectorAll('[data-coszus-save]')) {
    if (!(button instanceof HTMLElement)) continue;
    button.setAttribute('aria-pressed', saved.has(button.dataset.coszusSave || '') ? 'true' : 'false');
  }
}

document.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-coszus-save]') : null;
  if (!(button instanceof HTMLElement)) return;
  event.preventDefault();
  event.stopPropagation();
  const handle = button.dataset.coszusSave;
  if (!handle) return;
  if (CoszusWishlist.toggle(handle, button.dataset.productId)) offerJoin(button);
});

/**
 * After a guest's first save: the Join the Family panel, once
 * @param {HTMLElement} button
 */
function offerJoin(button) {
  if (config.customer || !config.joinPanel || getFlag(JOIN)) return;
  setFlag(JOIN, 'shown');
  // Specifier from the theme's import map (snippets/scripts.liquid)
  // The panel shows what they just saved (snippets/coszus-wishlist-button.liquid adds these)
  const product = { title: button.dataset.productTitle || '', image: button.dataset.productImage || '' };
  import('@theme/coszus-join-panel').then((panel) => panel.openJoinPanel({ opener: button, product })).catch(() => {});
}

/**
 * Omnisend custom event for a signed-in customer who allowed marketing. Does nothing unless
 * Omnisend's script is loaded.
 * @param {string} event
 * @param {string} handle
 */
async function track(event, handle) {
  // @ts-ignore
  if (!window.Shopify?.customerPrivacy?.marketingAllowed?.()) return;
  // @ts-ignore
  const omnisend = window.omnisend;
  if (!config.customer || !omnisend || typeof omnisend.push !== 'function') return;
  try {
    // @ts-ignore
    const root = window.Shopify?.routes?.root || '/';
    const response = await fetch(`${root}products/${encodeURIComponent(handle)}.js`);
    if (!response.ok) return;
    const product = await response.json();
    const image = product.featured_image || '';
    omnisend.push([
      'track',
      event,
      {
        origin: 'api',
        properties: {
          product: {
            id: String(product.id),
            title: product.title,
            handle: product.handle,
            url: new URL(product.url || `${root}products/${handle}`, window.location.origin).href,
            imageUrl: image.startsWith('//') ? `https:${image}` : image,
            price: product.price / 100,
            // @ts-ignore
            currency: window.Shopify?.currency?.active || '',
          },
        },
      },
    ]);
  } catch (e) {}
}

document.addEventListener(CHANGE, () => mark(document));

// Another tab saved something
window.addEventListener('storage', (event) => {
  if (event.key === KEY) mark(document);
});

// Cards added later (Load more, filters, Best Sellers swapping in) get marked too
let pending = false;
const observer = new MutationObserver((records) => {
  if (pending) return;
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node instanceof Element && (node.matches('[data-coszus-save]') || node.querySelector('[data-coszus-save]'))) {
        pending = true;
        requestAnimationFrame(() => {
          pending = false;
          mark(document);
        });
        return;
      }
    }
  }
});

const idle = window.requestIdleCallback || ((/** @type {Function} */ callback) => setTimeout(callback, 1));
idle(() => {
  mark(document);
  observer.observe(document.body, { childList: true, subtree: true });
  if (accountSync) pullFromAccount();
});

// Back from a Join the Family sign-up made in the wishlist panel: let the join script finish it off
if (typeof window.location?.search === 'string' && window.location.search.includes('customer_posted=true')) {
  import('@theme/coszus-join').catch(() => {});
}
