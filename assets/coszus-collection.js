/*
  Coszus collection page (sections/coszus-collection.liquid).

  - Filter drawer: a native modal <dialog> (Escape, focus trap and inert page for free). Slides in
    from the right on desktop and up from the bottom on mobile with Coszus motion. Closing without
    "Show results" throws away unapplied changes.
  - Show results, Sort and "Clear filters" re-render the section with the Section Rendering API and
    update the address, so Back and shared links keep the filters.
  - Load more appends the next batch and updates "You've seen X of Y". The number of extra batches is
    kept in history.state, so Back from a product (or a reload) loads them again and returns to the
    same card: Horizon's assets/scroll-container.js saves the scroll position on pagehide.
  Without this script, sort and Load more still work as a form and a link.
*/

import { scrollTo, scrollContainerMediaQuery } from '@theme/scroll-container';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

class CoszusCollection extends HTMLElement {
  /** @type {AbortController | null} */
  #request = null;
  /** Counts apply() calls, so only the latest one clears aria-busy */
  #applyCount = 0;
  /** @type {string} */
  #filtersSnapshot = '';

  connectedCallback() {
    this.sectionId = this.dataset.sectionId || '';
    this.addEventListener('click', this.#onClick);
    this.addEventListener('change', this.#onChange);
    this.addEventListener('submit', this.#onSubmit);
    this.dialog?.addEventListener('cancel', this.#onCancel);
    window.addEventListener('popstate', this.#onPopState);

    if (!history.state?.coszusCollection) {
      history.replaceState({ ...(history.state || {}), coszusCollection: true }, '');
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.#restoreLoadedBatches(), { once: true });
    } else {
      this.#restoreLoadedBatches();
    }

    // The section's inline script sets data-view before the grid paints. This element can be
    // upgraded before its children are parsed, so read the stored choice here too and sync the
    // button once the section's markup exists.
    const syncView = () => {
      let stored = null;
      try {
        stored = localStorage.getItem('coszus:card-view');
      } catch {
        // Storage off: default view
      }
      this.#setView(this.dataset.view === 'model' || stored === 'model' ? 'model' : 'plain');
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', syncView, { once: true });
    } else {
      syncView();
    }
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.#onClick);
    this.removeEventListener('change', this.#onChange);
    this.removeEventListener('submit', this.#onSubmit);
    this.dialog?.removeEventListener('cancel', this.#onCancel);
    window.removeEventListener('popstate', this.#onPopState);
    document.documentElement.classList.remove('coszus-scroll-lock');

    // e.g. the theme editor re-renders the section: a pending fetch must not touch history later
    this.#request?.abort();
    this.#request = null;
  }

  /** @returns {HTMLDialogElement | null} */
  get dialog() {
    return this.querySelector('dialog.coszus-filter');
  }

  /** @returns {HTMLFormElement | null} */
  get form() {
    return this.querySelector('form[data-mc-filter-form]');
  }

  /* ---------- Events ---------- */

  /** @param {MouseEvent} event */
  #onClick = (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-mc-action]') : null;
    if (!(target instanceof HTMLElement)) return;

    switch (target.dataset.mcAction) {
      case 'open-filter':
        this.openFilter();
        break;
      case 'close-filter':
        this.closeFilter({ discard: true });
        break;
      case 'clear-filters':
        this.#clearForm();
        break;
      case 'clear-and-apply':
        if (target instanceof HTMLAnchorElement && !this.#isModifiedClick(event)) {
          event.preventDefault();
          this.apply(target.href);
        }
        break;
      case 'toggle-view':
        this.#setView(this.dataset.view === 'model' ? 'plain' : 'model', { remember: true });
        break;
      case 'load-more':
        if (target instanceof HTMLAnchorElement && !this.#isModifiedClick(event)) {
          event.preventDefault();
          this.loadMore(target);
        }
        break;
    }
  };

  /**
   * Plain (flat lays) or Model (model shots) photos on the cards. Remembered across collections.
   * @param {'plain' | 'model'} view
   * @param {{ remember?: boolean }} [options]
   */
  #setView(view, { remember = false } = {}) {
    this.dataset.view = view;

    this.querySelector('[data-mc-action="toggle-view"]')?.setAttribute('aria-checked', String(view === 'model'));

    if (!remember) return;
    try {
      localStorage.setItem('coszus:card-view', view);
    } catch {
      // Private mode or storage off: the toggle still works for this page
    }
  }

  /** @param {Event} event */
  #onChange = (event) => {
    const input = event.target;

    // Price bands are radios that fill the hidden min/max inputs Shopify reads
    if (input instanceof HTMLInputElement && input.type === 'radio' && input.closest('.coszus-filter')) {
      const group = input.closest('.coszus-filter__options');
      const gte = group?.querySelector('[data-mc-price="gte"]');
      const lte = group?.querySelector('[data-mc-price="lte"]');
      if (gte instanceof HTMLInputElement) gte.value = input.dataset.gte || '';
      if (lte instanceof HTMLInputElement) lte.value = input.dataset.lte || '';
    }
  };

  /** @param {SubmitEvent} event */
  #onSubmit = (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.hasAttribute('data-mc-filter-form')) return;

    event.preventDefault();
    this.#filtersSnapshot = '';
    this.closeFilter();
    this.apply(this.#urlFromForm(form));
  };

  /** @param {Event} event */
  #onCancel = (event) => {
    event.preventDefault();
    this.closeFilter({ discard: true });
  };

  /** @param {PopStateEvent} event */
  #onPopState = (event) => {
    if (!event.state?.coszusCollection) return;
    if (new URL(window.location.href).pathname !== this.#collectionPath()) return;
    // Back/forward between filter states: re-render, then bring back any batches that entry had loaded
    const href = window.location.href;
    this.apply(href, { push: false, scroll: false }).then(() => {
      if (window.location.href === href) this.#restoreLoadedBatches({ sameDocument: true });
    });
  };

  /* ---------- Filter drawer ---------- */

  openFilter() {
    const dialog = this.dialog;
    if (!dialog || dialog.open) return;

    this.#filtersSnapshot = this.querySelector('[data-mc-swap="filters"]')?.innerHTML || '';
    dialog.showModal();
    document.documentElement.classList.add('coszus-scroll-lock');
    // Next frame, so the panel starts off-screen and slides in
    requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add('is-open')));
  }

  /** @param {{ discard?: boolean }} [options] */
  closeFilter({ discard = false } = {}) {
    const dialog = this.dialog;
    if (!dialog || !dialog.open || !dialog.classList.contains('is-open')) return;

    dialog.classList.remove('is-open');
    const panel = dialog.querySelector('.coszus-filter__panel');

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dialog.close();
      document.documentElement.classList.remove('coszus-scroll-lock');

      if (discard && this.#filtersSnapshot) {
        const body = this.querySelector('[data-mc-swap="filters"]');
        if (body) body.innerHTML = this.#filtersSnapshot;
      }
      this.#filtersSnapshot = '';
    };

    if (reducedMotion() || !panel) {
      finish();
    } else {
      panel.addEventListener('transitionend', finish, { once: true });
      setTimeout(finish, 450);
    }
  }

  #clearForm() {
    const form = this.form;
    if (!form) return;

    for (const input of form.querySelectorAll('input')) {
      if (!(input instanceof HTMLInputElement)) continue;
      if (input.type === 'checkbox') input.checked = false;
      if (input.dataset.mcPrice) input.value = '';
      // Clear all resets filters, not the sort (data-mc-sort-option)
      if (input.type === 'radio' && !input.hasAttribute('data-mc-sort-option')) {
        input.checked = !input.dataset.gte && !input.dataset.lte;
      }
    }
  }

  /* ---------- Rendering ---------- */

  #collectionPath() {
    return this.form ? new URL(this.form.action).pathname : window.location.pathname;
  }

  /**
   * The drawer form always holds the applied filters (closing without "Show results" restores it),
   * plus the sort (the drawer's Sort radios).
   * @param {HTMLFormElement} form
   */
  #urlFromForm(form) {
    const url = new URL(form.action);

    for (const [name, value] of new FormData(form)) {
      if (typeof value !== 'string' || value === '') continue;
      if (name === 'sort_by' || name.startsWith('filter.')) url.searchParams.append(name, value);
    }
    return url.toString();
  }

  /** @param {string} url */
  async #fetchSection(url) {
    this.#request?.abort();
    this.#request = new AbortController();

    const requestUrl = new URL(url, window.location.origin);
    requestUrl.searchParams.set('section_id', this.sectionId);

    const response = await fetch(requestUrl, { signal: this.#request.signal, credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Collection request failed: ${response.status}`);

    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    const fresh = doc.querySelector(`coszus-collection[data-section-id="${this.sectionId}"]`);
    if (!fresh) throw new Error('Collection section missing from response');
    return fresh;
  }

  /**
   * Re-render the results for a filtered/sorted URL.
   * @param {string} url
   * @param {{ push?: boolean, scroll?: boolean }} [options]
   */
  async apply(url, { push = true, scroll = true } = {}) {
    const target = new URL(url, window.location.origin);
    target.searchParams.delete('page');
    target.searchParams.delete('section_id');

    const applyId = ++this.#applyCount;
    this.setAttribute('aria-busy', 'true');

    try {
      const fresh = await this.#fetchSection(target.toString());

      for (const part of this.querySelectorAll('[data-mc-swap]')) {
        if (!(part instanceof HTMLElement)) continue;
        const replacement = fresh.querySelector(`[data-mc-swap="${part.dataset.mcSwap}"]`);
        if (replacement) part.replaceWith(replacement);
      }

      if (push && target.toString() !== window.location.href) {
        history.pushState({ coszusCollection: true }, '', target.toString());
      }

      this.#announce(this.querySelector('[data-mc-swap="count"]')?.textContent?.trim() || '');

      const bar = this.querySelector('.coszus-collection__bar');
      if (scroll && bar && bar.getBoundingClientRect().top < 0) {
        bar.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error(error);
      window.location.href = target.toString();
    } finally {
      // A newer apply() aborted this one and is still loading: leave aria-busy to it
      if (applyId === this.#applyCount) this.removeAttribute('aria-busy');
    }
  }

  /**
   * Back (or reload) onto a page where Load more had been used: the browser rebuilds the page with
   * the first batch only, so load the same extra batches again, then go back to where the shopper was.
   */
  async #restoreLoadedBatches({ sameDocument = false } = {}) {
    const batches = Number(history.state?.coszusMore) || 0;
    const navigation = /** @type {PerformanceNavigationTiming | undefined} */ (performance.getEntriesByType('navigation')[0]);
    if (batches < 1) return;
    if (!sameDocument && (!navigation || !['back_forward', 'reload'].includes(navigation.type))) return;

    const savedScroll = history.state?.scrollTop;
    // Hold the browser's own restore on phones (the saved spot isn't there yet); desktop is already manual
    const native = history.scrollRestoration;
    if (!scrollContainerMediaQuery.matches) history.scrollRestoration = 'manual';

    try {
      for (let i = 0; i < batches; i++) {
        const link = this.querySelector('[data-mc-action="load-more"]');
        if (!(link instanceof HTMLAnchorElement)) break;
        await this.loadMore(link, { restoring: true });
      }
      if (Number.isFinite(savedScroll)) {
        requestAnimationFrame(() => scrollTo({ top: savedScroll, behavior: 'instant' }));
      }
    } catch {
      // A batch didn't load: the page keeps what it has
    } finally {
      if (!scrollContainerMediaQuery.matches) history.scrollRestoration = native;
    }
  }

  /**
   * @param {HTMLAnchorElement} link
   * @param {{ restoring?: boolean }} [options]
   */
  async loadMore(link, { restoring = false } = {}) {
    if (link.getAttribute('aria-disabled') === 'true') return;

    link.setAttribute('aria-disabled', 'true');
    if (!restoring) this.#announce(link.dataset.loadingText || '');

    try {
      const fresh = await this.#fetchSection(link.href);
      const grid = this.querySelector('[data-mc-grid]');
      const items = [...fresh.querySelectorAll('[data-mc-grid] > li')];
      if (!grid || items.length === 0) throw new Error('No products in next batch');

      grid.append(...items);

      if (!restoring) {
        const state = history.state || {};
        history.replaceState({ ...state, coszusMore: (Number(state.coszusMore) || 0) + 1 }, '');
      }

      // Update the progress in place, so the bar fills rather than jumps
      const more = this.querySelector('.coszus-collection__more');
      const freshMore = fresh.querySelector('.coszus-collection__more');
      const text = more?.querySelector('p');
      const freshText = freshMore?.querySelector('p');
      if (text && freshText) text.textContent = freshText.textContent;

      const bar = more?.querySelector('.coszus-collection__progress span');
      const freshBar = freshMore?.querySelector('.coszus-collection__progress span');
      if (bar instanceof HTMLElement && freshBar instanceof HTMLElement) bar.style.width = freshBar.style.width;

      const nextLink = freshMore?.querySelector('[data-mc-action="load-more"]');
      if (nextLink instanceof HTMLAnchorElement) {
        link.href = nextLink.href;
        link.removeAttribute('aria-disabled');
      } else {
        link.remove();
        // The button has gone, so move focus to the first new product rather than losing it
        const firstLink = items[0]?.querySelector('a[href]');
        if (!restoring && firstLink instanceof HTMLElement) firstLink.focus({ preventScroll: true });
      }

      if (!restoring) this.#announce(text?.textContent?.trim() || '');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error(error);
      // Restoring after Back: keep the page as it is rather than jumping to the next batch's URL
      if (restoring) {
        link.removeAttribute('aria-disabled');
        throw error;
      }
      window.location.href = link.href;
    }
  }

  /** @param {string} message */
  #announce(message) {
    const status = this.querySelector('[data-mc-status]');
    if (!status || !message) return;
    status.textContent = '';
    requestAnimationFrame(() => (status.textContent = message));
  }

  /** @param {MouseEvent} event */
  #isModifiedClick(event) {
    return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1;
  }
}

if (!customElements.get('coszus-collection')) {
  customElements.define('coszus-collection', CoszusCollection);
}
