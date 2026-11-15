/**
 * Coszus header (sections/coszus-header.liquid).
 *
 * - Departments: stores the choice on <html data-coszus-department> and in localStorage, then fires
 *   `coszus:department-change` on document ({ detail: { department } }) for other sections.
 * - Mobile M / W / J are plain links to each department; this only keeps aria-current on the active one.
 * - Nav position is CSS only (position: sticky in sections/coszus-header.liquid). The only thing read
 *   here is whether it has stuck after a scroll: <html data-coszus-stuck> then paints the gap above
 *   the floating bar in the page colour, so the page doesn't show through above it.
 * - Side menu: native modal <dialog> (focus trap, Escape) with a Coszus slide-in.
 * - Points panel: disclosure under the coin. Escape, outside click and focus leaving close it.
 *   With data-smile on <coszus-points>, the coin opens Smile's own panel instead (SmileUI.openPanel,
 *   Smile's documented JS API) and this panel is only the fallback when Smile UI isn't on the page.
 *
 * Motion is CSS only (--coszus-motion tokens). Reduced motion zeroes it in coszus.css, and the
 * close steps below don't wait for transitions that won't run.
 */
const mobileQuery = window.matchMedia('(max-width: 820px)');
const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const STORAGE_KEY = 'coszus:department';

/**
 * Runs `callback` once `element` finishes its transition, or straight away with reduced motion.
 * @param {HTMLElement} element
 * @param {() => void} callback
 */
function afterTransition(element, callback) {
  if (reducedMotionQuery.matches) return callback();

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    element.removeEventListener('transitionend', onEnd);
    callback();
  };
  /** @param {TransitionEvent} event */
  const onEnd = (event) => {
    if (event.target === element) finish();
  };
  element.addEventListener('transitionend', onEnd);
  // Fallback if the transition never runs (element hidden, duration 0)
  setTimeout(finish, 600);
}

class CoszusHeader extends HTMLElement {
  /** @type {string[]} */
  #departments = [];
  /** @type {HTMLDialogElement | null} */
  #sideMenu = null;
  #stuckFrame = 0;

  connectedCallback() {
    this.#departments = (this.dataset.departments || '').split(',').filter(Boolean);
    this.#sideMenu = this.querySelector('dialog[data-side-menu]');

    this.addEventListener('click', this.#onClick);
    this.#sideMenu?.addEventListener('cancel', this.#onCancel);
    this.#sideMenu?.addEventListener('close', this.#onClose);
    this.#sideMenu?.addEventListener('change', this.#onChange);
    mobileQuery.addEventListener('change', this.#onBreakpoint);
    document.addEventListener('shopify:block:select', this.#onBlockSelect);
    // Capture, so scrolls of .page-wrapper (Horizon's scroller from 990px) count as well as the window's
    document.addEventListener('scroll', this.#onScroll, { passive: true, capture: true });

    this.#syncDepartment(document.documentElement.dataset.coszusDepartment);
    this.#onScroll();
  }

  disconnectedCallback() {
    mobileQuery.removeEventListener('change', this.#onBreakpoint);
    document.removeEventListener('shopify:block:select', this.#onBlockSelect);
    document.removeEventListener('scroll', this.#onScroll, { capture: true });
    cancelAnimationFrame(this.#stuckFrame);
    delete document.documentElement.dataset.coszusStuck;
  }

  /* ---------- Stuck: the page has scrolled and the nav is held at the top ---------- */

  #onScroll = () => {
    if (this.#stuckFrame) return;
    this.#stuckFrame = requestAnimationFrame(() => {
      this.#stuckFrame = 0;
      const section = this.closest('.coszus-header-section') || this;
      const scroller = document.querySelector('.page-wrapper');
      const scrolled = window.scrollY > 0 || (scroller ? scroller.scrollTop > 0 : false);
      const stuck = scrolled && section.getBoundingClientRect().top <= 0.5;
      document.documentElement.toggleAttribute('data-coszus-stuck', stuck);
    });
  };

  /* ---------- Departments ---------- */

  /** @param {string} department */
  setDepartment(department) {
    if (!this.#departments.includes(department)) return;

    document.documentElement.dataset.coszusDepartment = department;
    try {
      localStorage.setItem(STORAGE_KEY, department);
    } catch (_) {
      // Storage blocked (private mode): the choice lasts for this page only
    }
    this.#syncDepartment(department);
    document.dispatchEvent(new CustomEvent('coszus:department-change', { detail: { department } }));
  }

  /** @param {string | undefined} department */
  #syncDepartment(department) {
    this.querySelectorAll('button[data-department]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.getAttribute('data-department') === department));
    });
  }

  /* ---------- Clicks ---------- */

  /** @param {MouseEvent} event */
  #onClick = (event) => {
    const target = /** @type {Element} */ (event.target);

    if (target.closest('[data-side-menu-open]')) return this.openSideMenu();
    if (target.closest('[data-side-menu-close]')) return this.closeSideMenu();

    if (target.closest('[data-side-menu-search]')) {
      this.closeSideMenu({ instant: true });
      /** @type {any} */ (document.querySelector('#search-modal'))?.showDialog?.();
      return;
    }

    const department = target.closest('[data-department]');
    if (department instanceof HTMLButtonElement) {
      this.setDepartment(department.dataset.department ?? '');
      return;
    }

    // Department links open the collection; remember the choice for the next page
    if (department instanceof HTMLAnchorElement) {
      try {
        localStorage.setItem(STORAGE_KEY, department.dataset.department ?? '');
      } catch (_) {}
      return;
    }

    // Following a link from the side menu: shut it so it isn't open on back/forward
    if (target.closest('a[href]') && this.#sideMenu?.contains(target)) {
      this.closeSideMenu({ instant: true });
    }
  };

  /* ---------- Side menu ---------- */

  openSideMenu() {
    const dialog = this.#sideMenu;
    if (!dialog || dialog.open) return;

    dialog.showModal();
    this.#setExpanded(true);
    // Start from off-screen, then slide in
    dialog.getBoundingClientRect();
    dialog.setAttribute('data-open', '');

    const active = dialog.querySelector('[aria-pressed="true"]');
    if (active instanceof HTMLElement) active.focus();
  }

  /** @param {{ instant?: boolean }} [options] */
  closeSideMenu({ instant = false } = {}) {
    const dialog = this.#sideMenu;
    if (!dialog?.open) return;

    dialog.removeAttribute('data-open');
    this.#setExpanded(false);

    const panel = dialog.querySelector('.coszus-side-menu__panel');
    const finish = () => {
      // Reopened while closing: leave it open
      if (!dialog.hasAttribute('data-open') && dialog.open) dialog.close();
    };

    if (instant || !(panel instanceof HTMLElement)) finish();
    else afterTransition(panel, finish);
  }

  /** @param {Event} event */
  #onCancel = (event) => {
    event.preventDefault();
    this.closeSideMenu();
  };

  // Closed some other way (browser forced Escape, form method=dialog): reset state
  #onClose = () => {
    this.#sideMenu?.removeAttribute('data-open');
    this.#setExpanded(false);
    const burger = this.querySelector('[data-side-menu-open]');
    if (burger instanceof HTMLElement && !document.activeElement?.closest('dialog[open]')) burger.focus();
  };

  /** @param {boolean} expanded */
  #setExpanded(expanded) {
    this.querySelector('[data-side-menu-open]')?.setAttribute('aria-expanded', String(expanded));
  }

  /** @param {Event} event */
  #onChange = (event) => {
    const select = event.target;
    if (select instanceof HTMLSelectElement && select.name === 'country_code') select.form?.submit();
  };

  // The side menu is mobile only and the Points panel desktop only
  #onBreakpoint = () => {
    if (!mobileQuery.matches) this.closeSideMenu({ instant: true });
  };

  /* ---------- Theme editor ---------- */

  /** @param {Event} event */
  #onBlockSelect = (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !this.contains(target)) return;

    const department = target.closest('[data-department]');
    if (department instanceof HTMLElement) this.setDepartment(department.dataset.department ?? '');
  };
}

class CoszusPoints extends HTMLElement {
  /** @type {HTMLButtonElement | null} */
  #button = null;
  /** @type {HTMLElement | null} */
  #panel = null;

  connectedCallback() {
    this.#button = this.querySelector('[data-points-toggle]');
    this.#panel = this.querySelector('[data-points-panel]');

    this.#button?.addEventListener('click', this.#toggle);
    this.querySelector('[data-points-close]')?.addEventListener('click', this.#closeAndFocus);
    this.addEventListener('focusout', this.#onFocusOut);
    mobileQuery.addEventListener('change', this.#onBreakpoint);
    document.addEventListener('shopify:block:select', this.#onBlockSelect);
    document.addEventListener('shopify:block:deselect', this.#onBlockDeselect);
  }

  disconnectedCallback() {
    this.close();
    mobileQuery.removeEventListener('change', this.#onBreakpoint);
    document.removeEventListener('shopify:block:select', this.#onBlockSelect);
    document.removeEventListener('shopify:block:deselect', this.#onBlockDeselect);
  }

  get isOpen() {
    return this.#panel?.hasAttribute('data-open') ?? false;
  }

  open() {
    if (this.isOpen || !this.#panel) return;
    // The sharp coin, only fetched by someone who opens the panel
    const coin = this.#panel.querySelector('img[data-src-large]');
    if (coin instanceof HTMLImageElement) {
      coin.src = coin.dataset.srcLarge ?? coin.src;
      coin.removeAttribute('data-src-large');
    }
    this.#panel.setAttribute('data-open', '');
    this.#button?.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', this.#onKeydown);
    document.addEventListener('click', this.#onDocumentClick, true);
  }

  close() {
    if (!this.isOpen || !this.#panel) return;
    this.#panel.removeAttribute('data-open');
    this.#button?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', this.#onKeydown);
    document.removeEventListener('click', this.#onDocumentClick, true);
  }

  #toggle = () => {
    if (this.#openSmile()) return;
    if (this.isOpen) this.close();
    else this.open();
  };

  /**
   * With data-smile="<deep link>", opens Smile's panel and returns true. Returns false when Smile UI
   * isn't on the page (embed off, blocked, not loaded yet), so the theme's own panel opens instead.
   */
  #openSmile() {
    const deepLink = this.dataset.smile;
    const smile = /** @type {any} */ (window).SmileUI;
    if (deepLink === undefined || !smile || typeof smile.openPanel !== 'function') return false;
    this.close();
    const open = () => smile.openPanel({ deep_link: deepLink || 'home' });
    if (typeof smile.ready === 'function') smile.ready().then(open, open);
    else open();
    return true;
  }

  #closeAndFocus = () => {
    this.close();
    this.#button?.focus();
  };

  /** @param {KeyboardEvent} event */
  #onKeydown = (event) => {
    if (event.key !== 'Escape') return;
    const hadFocus = this.contains(document.activeElement);
    this.close();
    if (hadFocus) this.#button?.focus();
  };

  /** @param {MouseEvent} event */
  #onDocumentClick = (event) => {
    if (!this.contains(/** @type {Node} */ (event.target))) this.close();
  };

  /** @param {FocusEvent} event */
  #onFocusOut = (event) => {
    const next = event.relatedTarget;
    if (next instanceof Node && !this.contains(next)) this.close();
  };

  #onBreakpoint = () => {
    if (mobileQuery.matches) this.close();
  };

  /** @param {Event} event */
  #onBlockSelect = (event) => {
    if (event.target instanceof Node && this.contains(event.target)) this.open();
  };

  /** @param {Event} event */
  #onBlockDeselect = (event) => {
    if (event.target instanceof Node && this.contains(event.target)) this.close();
  };
}

if (!customElements.get('coszus-header')) customElements.define('coszus-header', CoszusHeader);
if (!customElements.get('coszus-points')) customElements.define('coszus-points', CoszusPoints);
