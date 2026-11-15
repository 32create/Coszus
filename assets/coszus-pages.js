/*
  Coszus other pages (Task 7, docs/FOUNDATIONS.md "Other pages").

  - <coszus-wishlist>: renders the saved products on the Wishlist page.
  - <coszus-tabs>: side tabs on the Help and Account pages. Each tab is a link to its panel's
    #id, so links from anywhere (footer, side menu, FAQ answers) open the right tab, and with no
    JavaScript every panel simply shows in order.
  - <coszus-points-card>: the Account page's points card. Filled by Smile once it's connected (see below).
  - <coszus-founder-video>: click to play the Founder Talks video with sound and controls.
  - [data-coszus-open-search]: opens the header's search panel (falls back to the search page).
*/

/* ---------- Wishlist page ---------- */

class CoszusWishlistPage extends HTMLElement {
  connectedCallback() {
    this.grid = /** @type {HTMLElement | null} */ (this.querySelector('[data-wishlist-grid]'));
    this.empty = /** @type {HTMLElement | null} */ (this.querySelector('[data-wishlist-empty]'));
    this.count = this.querySelector('[data-wishlist-count]');
    if (!this.grid) return;

    this.addEventListener('click', this.#onClick);
    document.addEventListener('coszus:wishlist-change', this.#onChange);

    if (this.#api) this.#start();
    else window.addEventListener('load', () => this.#start(), { once: true });
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.#onClick);
    document.removeEventListener('coszus:wishlist-change', this.#onChange);
  }

  /** @returns {any} */
  get #api() {
    // @ts-ignore
    return window.CoszusWishlist;
  }

  #start() {
    const api = this.#api;
    if (!api) return this.#update([]);

    // The signed-in customer's saved products (custom.wishlist), merged into the browser list
    const account = this.querySelector('script[data-wishlist-account]');
    if (account?.textContent) {
      try {
        api.merge(JSON.parse(account.textContent));
      } catch (e) {}
    }
    this.#render(api.handles());
  }

  /** @param {string[]} handles */
  async #render(handles) {
    const grid = this.grid;
    if (!grid) return;
    grid.replaceChildren();
    this.#update(handles);
    if (handles.length === 0) {
      grid.setAttribute('aria-busy', 'false');
      return;
    }

    // One slot per product, in saved order, filled as each one arrives
    const slots = handles.map((handle) => {
      const slot = document.createElement('div');
      slot.className = 'coszus-wishlist__slot';
      slot.dataset.slot = handle;
      grid.append(slot);
      return slot;
    });

    const root = this.dataset.root || '/';
    let next = 0;
    const worker = async () => {
      while (next < handles.length) {
        const index = next++;
        const handle = handles[index];
        const slot = slots[index];
        if (!handle || !slot) continue;
        try {
          const response = await fetch(
            `${root}products/${encodeURIComponent(handle)}?section_id=coszus-wishlist-item`
          );
          if (response.status === 404) {
            // Deleted or unpublished: drop it from the list
            slot.remove();
            this.#api?.remove(handle);
            continue;
          }
          if (!response.ok) throw new Error(String(response.status));
          const html = await response.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const item = doc.querySelector('[data-wishlist-item]');
          if (item) slot.replaceWith(document.importNode(item, true));
          else slot.remove();
        } catch (e) {
          slot.remove();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, handles.length) }, worker));
    grid.setAttribute('aria-busy', 'false');
    this.#update([], true);
  }

  /**
   * @param {string[]} handles
   * @param {boolean} [done] - Count what's on the page rather than what's saved
   */
  #update(handles, done = false) {
    const shown = this.grid ? this.grid.querySelectorAll('[data-wishlist-item]').length : 0;
    const total = done ? shown : handles.length;
    if (this.count) {
      const template = total === 1 ? this.dataset.countOne : this.dataset.countOther;
      this.count.textContent = total > 0 && template ? template.replace('[count]', String(total)) : '';
    }
    if (this.grid) this.grid.hidden = total === 0;
    if (this.empty) this.empty.hidden = total > 0;
  }

  /** @param {MouseEvent} event */
  #onClick = (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-wishlist-remove]') : null;
    if (!(button instanceof HTMLElement)) return;
    const handle = button.dataset.wishlistRemove;
    if (!handle) return;
    const item = button.closest('[data-wishlist-item]');
    const next = item?.nextElementSibling || item?.previousElementSibling;
    item?.remove();
    this.#api?.remove(handle);
    // Keep keyboard focus in the grid
    const focusTarget = next?.querySelector('[data-wishlist-remove]');
    if (focusTarget instanceof HTMLElement) focusTarget.focus();
  };

  /** Saved or removed somewhere else (another tab, the account sync): drop anything no longer saved */
  #onChange = (/** @type {Event} */ event) => {
    const handles = /** @type {CustomEvent} */ (event).detail?.handles;
    if (!Array.isArray(handles) || !this.grid) return;
    const saved = new Set(handles);
    const shown = new Set();
    for (const item of this.grid.querySelectorAll('[data-wishlist-item]')) {
      if (!(item instanceof HTMLElement)) continue;
      const handle = item.dataset.wishlistItem || '';
      if (saved.has(handle)) shown.add(handle);
      else item.remove();
    }
    // New handles (from the account) re-render the list
    if (handles.some((handle) => !shown.has(handle)) && this.grid.getAttribute('aria-busy') === 'false') {
      this.#render(handles);
      return;
    }
    this.#update(handles, this.grid.getAttribute('aria-busy') === 'false');
  };
}

if (!customElements.get('coszus-wishlist')) customElements.define('coszus-wishlist', CoszusWishlistPage);

/* ---------- Side tabs (Help, Account) ---------- */

class CoszusTabs extends HTMLElement {
  connectedCallback() {
    this.links = Array.from(this.querySelectorAll('[data-tab-link]'));
    this.panels = Array.from(this.querySelectorAll('[data-tab-panel]'));
    if (this.panels.length === 0) return;

    this.addEventListener('click', this.#onClick);
    window.addEventListener('hashchange', this.#onHash);
    this.#show(this.#fromHash() || this.panels[0]?.id || '', false);
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.#onClick);
    window.removeEventListener('hashchange', this.#onHash);
  }

  /** The panel for the address's #hash: a panel's own id, or anything inside one (e.g. the contact form after sending) */
  #fromHash() {
    let id = '';
    try {
      id = decodeURIComponent(location.hash.slice(1)).split('?')[0];
    } catch {
      return '';
    }
    if (!id) return '';
    const target = document.getElementById(id);
    const panel = target?.closest('[data-tab-panel]');
    return panel && this.contains(panel) ? panel.id : '';
  }

  /**
   * @param {string} id
   * @param {boolean} focus
   */
  #show(id, focus) {
    for (const panel of this.panels || []) {
      if (panel instanceof HTMLElement) panel.hidden = panel.id !== id;
    }
    for (const link of this.links || []) {
      const on = link.getAttribute('href') === `#${id}`;
      link.classList.toggle('is-active', on);
      if (on) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    this.classList.add('is-ready');
    if (focus) {
      const panel = document.getElementById(id);
      panel?.focus({ preventScroll: true });
    }
  }

  /** @param {MouseEvent} event */
  #onClick = (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
    if (!(link instanceof HTMLAnchorElement)) return;
    const id = link.getAttribute('href')?.slice(1) || '';
    if (!this.panels?.some((panel) => panel.id === id)) return;
    event.preventDefault();
    history.replaceState(null, '', `#${id}`);
    this.#show(id, !link.hasAttribute('data-tab-link'));
    if (!link.hasAttribute('data-tab-link')) {
      // A link inside a panel (e.g. "See Delivery"): bring the tabs into view
      this.scrollIntoView({ block: 'start' });
    }
  };

  #onHash = () => {
    const id = this.#fromHash();
    if (id) this.#show(id, true);
  };
}

if (!customElements.get('coszus-tabs')) customElements.define('coszus-tabs', CoszusTabs);

/* ---------- Pills (Help size guide: Men / Women / Juniors) ---------- */

document.addEventListener('click', (event) => {
  const pill = event.target instanceof Element ? event.target.closest('[data-pill]') : null;
  if (!(pill instanceof HTMLElement)) return;
  const group = pill.parentElement;
  const scope = group?.parentElement;
  if (!group || !scope) return;
  for (const button of group.querySelectorAll('[data-pill]')) {
    button.setAttribute('aria-pressed', button === pill ? 'true' : 'false');
  }
  for (const panel of scope.querySelectorAll('[data-pill-panel]')) {
    if (!(panel instanceof HTMLElement)) continue;
    panel.toggleAttribute('data-pill-hidden', panel.dataset.pillPanel !== pill.dataset.pill);
  }
});

/* ---------- Points card (Account page) ----------
  Hook for Coszus Rewards (Smile). assets/coszus-smile.js reads the balance from Smile.js and fires
    document.dispatchEvent(new CustomEvent('coszus:points', { detail: { balance: 650, progress: 50, left: 50, value: 5 } }))
  (or sets window.CoszusPoints to that before this runs). `text` overrides the line under the balance;
  without it the card builds the line from its data-points-text-template ([left], [value], [balance]).
  Every field is optional. Until then the card shows the earning rate. */

class CoszusPointsCard extends HTMLElement {
  connectedCallback() {
    document.addEventListener('coszus:points', this.#onPoints);
    // @ts-ignore
    if (window.CoszusPoints) this.#fill(window.CoszusPoints);
  }

  disconnectedCallback() {
    document.removeEventListener('coszus:points', this.#onPoints);
  }

  #onPoints = (/** @type {Event} */ event) => this.#fill(/** @type {CustomEvent} */ (event).detail || {});

  /** @param {{ balance?: number, progress?: number, text?: string, left?: number, value?: number }} data */
  #fill(data) {
    const balance = this.querySelector('[data-points-balance]');
    const bar = this.querySelector('[data-points-bar]');
    const text = this.querySelector('[data-points-text]');
    if (balance instanceof HTMLElement && typeof data.balance === 'number') {
      const label = document.createElement('span');
      label.textContent = ' points';
      balance.replaceChildren(String(data.balance), label);
      balance.hidden = false;
    }
    if (bar instanceof HTMLElement && typeof data.progress === 'number') {
      bar.style.setProperty('--points-progress', `${Math.max(0, Math.min(100, data.progress))}%`);
      bar.hidden = false;
    }
    if (!(text instanceof HTMLElement)) return;
    if (data.text) {
      text.textContent = data.text;
    } else if (typeof data.left === 'number' && this.dataset.pointsTextTemplate) {
      text.textContent = this.dataset.pointsTextTemplate
        .replace('[left]', String(data.left))
        .replace('[value]', data.value === undefined ? '' : String(data.value))
        .replace('[balance]', data.balance === undefined ? '' : String(data.balance));
    }
  }
}

if (!customElements.get('coszus-points-card')) customElements.define('coszus-points-card', CoszusPointsCard);

/* ---------- Founder Talks video ---------- */

class CoszusFounderVideo extends HTMLElement {
  connectedCallback() {
    this.querySelector('[data-video-play]')?.addEventListener('click', this.#play, { once: true });
  }

  #play = () => {
    const video = this.querySelector('video');
    const button = this.querySelector('[data-video-play]');
    if (!video) return;
    video.controls = true;
    video.preload = 'auto';
    video.play().catch(() => {});
    if (button instanceof HTMLElement) button.hidden = true;
    video.focus();
  };
}

if (!customElements.get('coszus-founder-video')) customElements.define('coszus-founder-video', CoszusFounderVideo);

/* ---------- Open search ---------- */

document.addEventListener('click', (event) => {
  const trigger = event.target instanceof Element ? event.target.closest('[data-coszus-open-search]') : null;
  if (!trigger) return;
  /** @type {any} */
  const modal = document.querySelector('#search-modal');
  if (typeof modal?.showDialog !== 'function') return;
  event.preventDefault();
  modal.showDialog();
});
