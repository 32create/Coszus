/*
  Coszus product page (sections/coszus-product.liquid) and You might also like
  (sections/coszus-product-recommendations.liquid).

  - Size and option buttons pick the variant from the JSON in the section, then update the form's
    variant ID, price, Klarna (÷ 3) and Clearpay (÷ 4) splits, points, "Only X left", the button and the address.
  - Add to bag submits Horizon's product-form-component (bag drawer opens, count updates). It's a
    plain button, so nothing reaches Horizon's submit handler until a variant is chosen. With no
    size chosen it flags the sizes on desktop and opens the size sheet on mobile; picking a size
    in the sheet adds straight to the bag.
  - Size guide, size sheet and Worn by the family lightbox are native modal dialogs (Escape, focus
    trap and inert page come free).
  - Next-day countdown in UK time, gallery dots, sticky bar on mobile.
  - Complete the set size buttons submit their own product form.
*/

const MOBILE = '(max-width: 820px)';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** @param {Element | null} element @param {string} selector */
const closest = (element, selector) => (element instanceof Element ? element.closest(selector) : null);

class CoszusProduct extends HTMLElement {
  /** @type {Array<{id: number, available: boolean, options: string[], price: string, compare: string | null, split: string, split3: string, points: number, low: number | null}>} */
  variants = [];

  /** @type {Array<string | null>} */
  selected = [];

  #abort = new AbortController();
  /** @type {number | undefined} */
  #clock;
  /** @type {number | undefined} */
  #addedTimer;
  #lightboxIndex = 0;
  /** @type {HTMLButtonElement | null} Complete the set size button waiting for its cart result */
  #pendingSet = null;
  /** True while an Add to bag request from the main form is in flight (stops a second tap adding twice) */
  #adding = false;

  connectedCallback() {
    const { signal } = this.#abort;

    try {
      this.variants = JSON.parse(this.querySelector('[data-mp-variants]')?.textContent || '[]');
    } catch (error) {
      this.variants = [];
    }

    // An option with no buttons can't be chosen, so it starts chosen: a product without options
    // still reports one ("Default Title") but renders no buttons
    const optionCount = this.variants[0]?.options.length || 0;
    this.selected = Array.from({ length: optionCount }, (_, index) => {
      const pressed = this.querySelector(`[data-mp-option="${index}"][aria-pressed="true"]`);
      if (pressed instanceof HTMLElement) return pressed.dataset.mpValue || null;
      if (!this.querySelector(`[data-mp-option="${index}"]`)) return this.variants[0].options[index];
      return null;
    });

    this.addEventListener('click', this.#onClick, { signal });
    this.addEventListener('shopify:cart:lines-update', this.#onCartUpdate, { signal });
    this.addEventListener('shopify:cart:error', this.#onCartError, { signal });

    for (const dialog of this.querySelectorAll('dialog[data-mp-dialog]')) {
      dialog.addEventListener('cancel', this.#onCancel, { signal });
    }

    this.#setupGallery(signal);
    this.#setupSticky(signal);
    this.#setupNextDay();
    this.#update({ fromLoad: true });
  }

  disconnectedCallback() {
    this.#abort.abort();
    this.#abort = new AbortController();
    window.clearInterval(this.#clock);
    window.clearTimeout(this.#addedTimer);
    document.documentElement.classList.remove('coszus-scroll-lock');
  }

  get form() {
    return /** @type {HTMLFormElement | null} */ (this.querySelector('.coszus-product__form form'));
  }

  get addButton() {
    return /** @type {HTMLButtonElement | null} */ (this.querySelector('[data-mp-add]'));
  }

  get sizeIndex() {
    return this.dataset.sizeIndex === '' || this.dataset.sizeIndex === undefined ? -1 : Number(this.dataset.sizeIndex);
  }

  /** The variant for the current selection, or null while an option is unchosen */
  get variant() {
    if (this.selected.some((value) => value === null)) return null;
    return this.variants.find((variant) => variant.options.every((value, index) => value === this.selected[index])) || null;
  }

  /* ---------- Clicks ---------- */

  /** @param {MouseEvent} event */
  #onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const option = closest(target, '[data-mp-option]');
    if (option instanceof HTMLElement) {
      if (option.getAttribute('aria-disabled') === 'true') return;
      this.#select(Number(option.dataset.mpOption), option.dataset.mpValue || null);
      return;
    }

    const sheetValue = closest(target, '[data-mp-sheet-value]');
    if (sheetValue instanceof HTMLElement) {
      if (sheetValue.getAttribute('aria-disabled') === 'true') return;
      this.#select(this.sizeIndex, sheetValue.dataset.mpSheetValue || null);
      this.closeDialog(sheetValue.closest('dialog'));
      this.#add();
      return;
    }

    const opener = closest(target, '[data-mp-open]');
    if (opener instanceof HTMLElement) {
      const dialog = document.getElementById(opener.dataset.mpOpen || '');
      // The guide opens over the size sheet's place, not on top of it
      this.closeDialog(this.querySelector('dialog[data-mp-size-sheet][open]'), { instant: true });
      if (dialog instanceof HTMLDialogElement) this.openDialog(dialog, opener);
      return;
    }

    if (closest(target, '[data-mp-close]')) {
      this.closeDialog(target.closest('dialog'));
      return;
    }

    if (closest(target, '[data-mp-add]')) {
      this.#add();
      return;
    }

    if (closest(target, '[data-mp-sticky-add]')) {
      this.#add({ fromSticky: true });
      return;
    }

    const setButton = closest(target, '[data-mp-set-variant]');
    if (setButton instanceof HTMLButtonElement) {
      this.#addSet(setButton);
      return;
    }

    const photo = closest(target, '[data-mp-photo]');
    if (photo instanceof HTMLElement) {
      const photos = [...this.querySelectorAll('[data-mp-photo]')];
      this.#showPhoto(photos.indexOf(photo), photo);
      return;
    }

    const step = closest(target, '[data-mp-lightbox-step]');
    if (step instanceof HTMLElement) {
      this.#showPhoto(this.#lightboxIndex + Number(step.dataset.mpLightboxStep));
      return;
    }

    // Lightbox: a click on the dark area closes it
    if (target instanceof HTMLDialogElement && target.matches('[data-mp-lightbox]')) {
      this.closeDialog(target);
      return;
    }

    const dot = closest(target, '[data-mp-dot]');
    if (dot instanceof HTMLElement) {
      const track = this.querySelector('[data-mp-gallery]');
      const slide = this.querySelectorAll('[data-mp-slide]')[Number(dot.dataset.mpDot)];
      if (track instanceof HTMLElement && slide instanceof HTMLElement) {
        track.scrollTo({ left: slide.offsetLeft, behavior: reducedMotion() ? 'auto' : 'smooth' });
      }
    }
  };

  /** @param {number} index @param {string | null} value */
  #select(index, value) {
    if (index < 0 || index >= this.selected.length) return;
    this.selected[index] = value;
    this.#flagSizes(false);
    this.#update();
  }

  /* ---------- State → page ---------- */

  /** @param {{ fromLoad?: boolean }} [options] */
  #update({ fromLoad = false } = {}) {
    const variant = this.variant;

    // Pressed state and availability for every option value, given the other choices
    for (const button of this.querySelectorAll('[data-mp-option]')) {
      if (!(button instanceof HTMLElement)) continue;
      const index = Number(button.dataset.mpOption);
      const value = button.dataset.mpValue || '';
      button.setAttribute('aria-pressed', String(this.selected[index] === value));
      this.#setAvailable(button, this.#isAvailable(index, value));
    }

    for (const button of this.querySelectorAll('[data-mp-sheet-value]')) {
      if (!(button instanceof HTMLElement)) continue;
      const value = button.dataset.mpSheetValue || '';
      this.#setAvailable(button, this.#isAvailable(this.sizeIndex, value));
      const low = this.#lowFor(this.sizeIndex, value);
      const label = button.querySelector('[data-mp-sheet-low]');
      if (label) label.textContent = low ? this.#onlyLeft(low) : '';
    }

    if (variant) {
      const input = /** @type {HTMLInputElement | null} */ (this.form?.querySelector('input[name="id"]'));
      if (input) input.value = String(variant.id);

      this.#setText('[data-mp-price]', variant.price);
      this.#setText('[data-mp-sticky-price]', variant.price);
      this.#setText('[data-mp-split]', variant.split);
      this.#setText('[data-mp-split-3]', variant.split3);
      this.#setText('[data-mp-points]', String(variant.points));
      this.#setText('[data-mp-compare-value]', variant.compare || '');
      const compare = this.querySelector('[data-mp-compare]');
      if (compare instanceof HTMLElement) compare.hidden = !variant.compare;

      if (!fromLoad && this.selected.length) {
        const url = new URL(window.location.href);
        url.searchParams.set('variant', String(variant.id));
        window.history.replaceState(window.history.state, '', url.toString());
      }
    }

    // "Only X left" for the chosen size
    const low = this.querySelector('[data-mp-low]');
    if (low) low.textContent = variant?.low ? this.#onlyLeft(variant.low) : '';

    this.#renderButtons();
  }

  #renderButtons() {
    const variant = this.variant;
    const anyAvailable = this.variants.some((item) => item.available);
    let state = 'add';
    let text = this.dataset.textAdd || '';

    if (!anyAvailable) {
      state = 'sold-out';
      text = this.dataset.textSoldOut || '';
    } else if (!variant) {
      state = 'select';
      text = this.dataset.textSelect || '';
    } else if (!variant.available) {
      state = 'sold-out';
      text = this.dataset.textSoldOut || '';
    }

    if (this.#adding) return;

    const button = this.addButton;
    if (button && button.dataset.state !== 'added') {
      button.dataset.state = state;
      button.textContent = text;
      button.disabled = state === 'sold-out';
    }

    const sticky = this.querySelector('[data-mp-sticky-add]');
    if (sticky instanceof HTMLButtonElement) {
      sticky.textContent = text;
      sticky.disabled = state === 'sold-out';
    }
  }

  /** @param {number} index @param {string} value */
  #isAvailable(index, value) {
    return this.variants.some(
      (variant) =>
        variant.available &&
        variant.options[index] === value &&
        variant.options.every((other, i) => i === index || this.selected[i] === null || this.selected[i] === other)
    );
  }

  /** @param {number} index @param {string} value */
  #lowFor(index, value) {
    const match = this.variants.find(
      (variant) =>
        variant.options[index] === value &&
        variant.options.every((other, i) => i === index || this.selected[i] === null || this.selected[i] === other)
    );
    return match?.low || null;
  }

  /** @param {Element} button @param {boolean} available */
  #setAvailable(button, available) {
    if (available) button.removeAttribute('aria-disabled');
    else button.setAttribute('aria-disabled', 'true');
    const label = button.querySelector('[data-mp-sold-out-label]');
    if (label instanceof HTMLElement) label.hidden = available;
  }

  /** @param {number} count */
  #onlyLeft(count) {
    return (this.dataset.textOnlyLeft || '').replace('[count]', String(count));
  }

  /** @param {string} selector @param {string} text */
  #setText(selector, text) {
    for (const element of this.querySelectorAll(selector)) element.textContent = text;
  }

  /* ---------- Add to bag ---------- */

  /** @param {{ fromSticky?: boolean }} [options] */
  #add({ fromSticky = false } = {}) {
    const variant = this.variant;
    if (!variant) {
      this.#needSize(fromSticky);
      return;
    }
    if (!variant.available || this.#adding) return;
    this.#setError('');
    this.form?.requestSubmit();
  }

  /** @param {boolean} fromSticky */
  #needSize(fromSticky) {
    const sheet = this.querySelector('dialog[data-mp-size-sheet]');
    if (window.matchMedia(MOBILE).matches && sheet instanceof HTMLDialogElement) {
      this.openDialog(sheet, fromSticky ? this.querySelector('[data-mp-sticky-add]') : this.addButton);
      return;
    }

    this.#flagSizes(true);
    const row = this.querySelector('[data-mp-size-row]');
    row?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    const first = row?.querySelector('[data-mp-option]:not([aria-disabled="true"])');
    if (first instanceof HTMLElement) first.focus({ preventScroll: true });
    this.#setError(this.dataset.textChoose || '');
  }

  /** @param {boolean} on */
  #flagSizes(on) {
    this.querySelector('[data-mp-size-row]')?.classList.toggle('is-flagged', on);
    this.addButton?.toggleAttribute('data-need', on);
    if (!on) this.#setError('');
  }

  /** @param {string} message */
  #setError(message) {
    const error = this.querySelector('[data-mp-error]');
    if (!(error instanceof HTMLElement)) return;
    error.textContent = message;
    error.hidden = !message;
  }

  /** @param {Event & { promise?: Promise<any> }} event */
  #onCartUpdate = (event) => {
    const setForm = closest(/** @type {Element} */ (event.target), '.coszus-set__form');
    if (setForm) {
      this.#onSetResult(setForm, event);
      return;
    }

    const fromMain = closest(/** @type {Element} */ (event.target), '.coszus-product__form');
    if (fromMain && event.promise) this.#setAdding(true);
    event.promise
      ?.then((result) => {
        if (fromMain) this.#setAdding(false);
        if (result?.detail?.didError || !fromMain) {
          if (fromMain) this.#renderButtons();
          return;
        }
        const button = this.addButton;
        if (!button) return;
        button.dataset.state = 'added';
        button.textContent = this.dataset.textAdded || '';
        this.#renderButtons(); // puts the sticky button's label back; the main one keeps "Added"
        window.clearTimeout(this.#addedTimer);
        this.#addedTimer = window.setTimeout(() => {
          delete button.dataset.state;
          this.#renderButtons();
        }, 1600);
      })
      .catch(() => {
        if (!fromMain) return;
        this.#setAdding(false);
        this.#renderButtons();
      });
  };

  /**
   * Busy state for the main and sticky Add to bag buttons while the request is in flight.
   * @param {boolean} on
   */
  #setAdding(on) {
    this.#adding = on;
    for (const button of this.querySelectorAll('[data-mp-add], [data-mp-sticky-add]')) {
      if (on) {
        button.setAttribute('aria-busy', 'true');
        button.textContent = this.dataset.textAdding || '';
      } else {
        button.removeAttribute('aria-busy');
      }
    }
  }

  /** @param {Event} event */
  #onCartError = (event) => {
    const error = /** @type {any} */ (event);
    const message = error.error || error.detail?.description || '';

    const setForm = closest(/** @type {Element} */ (event.target), '.coszus-set__form');
    if (setForm) {
      this.#pendingSet = null;
      this.#setSetError(setForm, message);
      return;
    }

    if (!closest(/** @type {Element} */ (event.target), '.coszus-product__form')) return;
    this.#setError(message);
  };

  /**
   * A Complete the set add finished: tick the size only once it's really in the bag.
   * @param {Element} setForm @param {Event} event
   */
  #onSetResult(setForm, event) {
    const button = this.#pendingSet;
    if (!button || !setForm.contains(button)) return;
    /** @type {any} */ (event).promise
      ?.then((/** @type {any} */ result) => {
        if (this.#pendingSet !== button) return;
        this.#pendingSet = null;
        if (result?.detail?.didError) return; // the cart error event shows the message
        button.classList.add('is-added');
        window.setTimeout(() => button.classList.remove('is-added'), 1500);
      })
      .catch(() => {
        if (this.#pendingSet === button) this.#pendingSet = null;
      });
  }

  /** @param {Element} setForm @param {string} message */
  #setSetError(setForm, message) {
    const error = setForm.parentElement?.querySelector('[data-mp-set-error]');
    if (!(error instanceof HTMLElement)) return;
    error.textContent = message || this.dataset.textAddError || '';
    error.hidden = !error.textContent;
  }

  /** @param {HTMLFormElement} setForm */
  #clearSetError(setForm) {
    const error = setForm.parentElement?.querySelector('[data-mp-set-error]');
    if (!(error instanceof HTMLElement)) return;
    error.textContent = '';
    error.hidden = true;
  }

  /** @param {HTMLButtonElement} button */
  #addSet(button) {
    if (button.disabled) return;
    const form = button.closest('form');
    const input = /** @type {HTMLInputElement | null} */ (form?.querySelector('input[name="id"]'));
    if (!form || !input) return;
    input.value = button.dataset.mpSetVariant || '';
    const setForm = button.closest('.coszus-set__form');
    if (setForm) this.#clearSetError(setForm);
    this.#pendingSet = button;
    form.requestSubmit();
  }

  /* ---------- Dialogs ---------- */

  /** @param {HTMLDialogElement} dialog @param {Element | null} [opener] */
  openDialog(dialog, opener = null) {
    if (dialog.open) return;
    this.lastOpener = opener;
    dialog.showModal();
    document.documentElement.classList.add('coszus-scroll-lock');
    if (reducedMotion()) dialog.classList.add('is-open');
    else requestAnimationFrame(() => requestAnimationFrame(() => dialog.classList.add('is-open')));
  }

  /** @param {Element | null} dialog @param {{ instant?: boolean }} [options] */
  closeDialog(dialog, { instant = false } = {}) {
    if (!(dialog instanceof HTMLDialogElement) || !dialog.open) return;
    dialog.classList.remove('is-open');

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dialog.close();
      if (!this.querySelector('dialog[open]')) document.documentElement.classList.remove('coszus-scroll-lock');
      if (!instant && this.lastOpener instanceof HTMLElement && this.lastOpener.isConnected) {
        this.lastOpener.focus({ preventScroll: true });
      }
    };

    const panel = dialog.querySelector('.coszus-sheet__panel');
    if (instant || reducedMotion() || !panel) {
      finish();
    } else {
      panel.addEventListener('transitionend', finish, { once: true });
      window.setTimeout(finish, 450);
    }
  }

  /** @param {Event} event */
  #onCancel = (event) => {
    event.preventDefault();
    this.closeDialog(/** @type {Element} */ (event.currentTarget));
  };

  /** @param {number} index @param {Element | null} [opener] */
  #showPhoto(index, opener = null) {
    const photos = [...this.querySelectorAll('[data-mp-photo]')];
    const dialog = this.querySelector('dialog[data-mp-lightbox]');
    const image = this.querySelector('[data-mp-lightbox-img]');
    if (!photos.length || !(dialog instanceof HTMLDialogElement) || !(image instanceof HTMLImageElement)) return;

    this.#lightboxIndex = (index + photos.length) % photos.length;
    const photo = /** @type {HTMLElement} */ (photos[this.#lightboxIndex]);
    image.src = photo.dataset.mpPhoto || '';
    image.alt = photo.dataset.mpPhotoAlt || '';

    for (const step of dialog.querySelectorAll('[data-mp-lightbox-step]')) {
      if (step instanceof HTMLElement) step.hidden = photos.length < 2;
    }
    if (!dialog.open) this.openDialog(dialog, opener);
  }

  /* ---------- Gallery dots (mobile) ---------- */

  /** @param {AbortSignal} signal */
  #setupGallery(signal) {
    const track = this.querySelector('[data-mp-gallery]');
    const dots = [...this.querySelectorAll('[data-mp-dot]')];
    if (!(track instanceof HTMLElement) || dots.length < 2) return;

    let frame = 0;
    track.addEventListener(
      'scroll',
      () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const index = Math.round(track.scrollLeft / Math.max(track.clientWidth, 1));
          dots.forEach((dot, i) => {
            if (i === index) dot.setAttribute('aria-current', 'true');
            else dot.removeAttribute('aria-current');
          });
        });
      },
      { passive: true, signal }
    );
  }

  /* ---------- Sticky bar (mobile) ---------- */

  /** @param {AbortSignal} signal */
  #setupSticky(signal) {
    const bar = this.querySelector('[data-mp-sticky]');
    const button = this.addButton;
    if (!(bar instanceof HTMLElement) || !button) return;

    // Shown once the main button has scrolled up out of view, not before reaching it. A scroll
    // check rather than an IntersectionObserver, which never fires when a jump (fling, restored
    // scroll position) skips past a button that started below the fold.
    let frame = 0;
    let shown = false;
    const check = () => {
      frame = 0;
      const past = button.getBoundingClientRect().bottom < 0;
      if (past === shown) return;
      shown = past;
      bar.classList.toggle('is-visible', past);
      bar.toggleAttribute('inert', !past);
      bar.setAttribute('aria-hidden', String(!past));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    window.addEventListener('scroll', schedule, { passive: true, signal });
    window.addEventListener('resize', schedule, { passive: true, signal });
    signal.addEventListener('abort', () => cancelAnimationFrame(frame));
    check();
  }

  /* ---------- Next-day countdown (UK time) ---------- */

  #setupNextDay() {
    const line = this.querySelector('[data-mp-next-day][data-template]');
    if (!(line instanceof HTMLElement)) return;

    const fallback = line.innerHTML;
    const cutoff = Number(line.dataset.cutoff) || 14;
    const lastDay = Number(line.dataset.lastDay) || 4;
    const template = line.dataset.template || '';

    const tick = () => {
      const now = londonTime();
      if (!now) return;
      const minutesLeft = cutoff * 60 - (now.hour * 60 + now.minute);
      if (now.day >= 1 && now.day <= lastDay && minutesLeft > 0) {
        const hours = Math.floor(minutesLeft / 60);
        const minutes = minutesLeft % 60;
        const time = hours ? `${hours}h ${minutes}m` : `${minutes}m`;
        line.innerHTML = template.replace('[time]', time);
      } else {
        line.innerHTML = fallback;
      }
    };

    tick();
    this.#clock = window.setInterval(tick, 30000);
  }
}

/** Day of week (0 Sunday), hour and minute in the UK, whatever the visitor's time zone */
function londonTime() {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    /** @param {string} type */
    const get = (type) => parts.find((part) => part.type === type)?.value || '';
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return { day: days.indexOf(get('weekday')), hour: Number(get('hour')), minute: Number(get('minute')) };
  } catch (error) {
    return null;
  }
}

/* ---------- You might also like ---------- */

class CoszusRecommendations extends HTMLElement {
  #abort = new AbortController();

  connectedCallback() {
    if (this.querySelector('.coszus-recs__grid') || !this.dataset.url) return;

    // After the page's own work, so it never competes with the gallery
    const start = () => this.#load();
    if ('requestIdleCallback' in window) window.requestIdleCallback(start, { timeout: 2000 });
    else window.setTimeout(start, 200);
  }

  disconnectedCallback() {
    this.#abort.abort();
    this.#abort = new AbortController();
  }

  async #load() {
    try {
      const response = await fetch(this.dataset.url || '', { signal: this.#abort.signal });
      if (!response.ok) return;
      const html = new DOMParser().parseFromString(await response.text(), 'text/html');
      const fresh = html.querySelector('coszus-recommendations');
      if (!fresh || !fresh.querySelector('.coszus-recs__grid')) return;
      this.innerHTML = fresh.innerHTML;
      this.hidden = false;
    } catch (error) {
      // Aborted or offline: the section stays hidden
    }
  }
}

if (!customElements.get('coszus-product')) customElements.define('coszus-product', CoszusProduct);
if (!customElements.get('coszus-recommendations')) customElements.define('coszus-recommendations', CoszusRecommendations);
