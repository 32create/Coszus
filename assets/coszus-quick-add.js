/*
  Coszus quick add (snippets/coszus-quick-add.liquid).

  A size button sets the variant on Horizon's product-form-component and submits it, so adding
  behaves exactly like Horizon's own add to cart (bag drawer opens, bag count updates, cart events fire).
  When the card has a colour swatch, the size row follows the chosen colour.

  Touch and mobile: the card's "+" opens one shared size sheet (sold-out sizes greyed). The sheet
  is cloned from <template id="CoszusQuickSheet"> (snippets/scripts.liquid) on the first tap and
  filled from the size buttons already in the card, so nothing is fetched. Products without a size
  but with other choices (Colour only) get the same sheet with those; single-variant products add
  straight away. Errors show in the sheet (the cart's own message when it gives one); a successful
  add closes it.
*/

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** @type {QuickSheet | null} */
let sheet = null;

class CoszusQuickAdd extends HTMLElement {
  /** An add from this card is on its way, so its cart events are ours */
  pending = false;

  /** The cart already reported an error for this add, so don't replace it with the generic one */
  errorShown = false;

  connectedCallback() {
    this.addEventListener('click', this.#onClick);
    this.addEventListener('shopify:cart:lines-update', this.#onCartUpdate);
    this.addEventListener('shopify:cart:error', this.#onCartError);

    this.card = this.closest('product-card');
    if (this.dataset.groupOption && this.card) {
      this.card.addEventListener('change', this.#onSwatchChange);
    }
  }

  disconnectedCallback() {
    this.removeEventListener('click', this.#onClick);
    this.removeEventListener('shopify:cart:lines-update', this.#onCartUpdate);
    this.removeEventListener('shopify:cart:error', this.#onCartError);
    this.card?.removeEventListener('change', this.#onSwatchChange);
    if (sheet?.owner === this) sheet.close({ instant: true });
  }

  get form() {
    return this.querySelector('form');
  }

  /** The size buttons for the colour on show */
  get sizeButtons() {
    const row = this.querySelector('[data-group]:not([hidden])');
    return /** @type {HTMLButtonElement[]} */ ([...(row?.querySelectorAll('[data-coszus-quick-size]') || [])]);
  }

  /** @param {string} [variantId] Leave out to add the form's own variant (no size option) */
  add(variantId) {
    const form = this.form;
    const input = /** @type {HTMLInputElement | null} */ (form?.querySelector('input[name="id"]'));
    if (!form || !input) return false;
    if (variantId) input.value = variantId;
    this.pending = true;
    this.errorShown = false;
    form.requestSubmit();
    return true;
  }

  /** @param {MouseEvent} event */
  #onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const opener = /** @type {HTMLButtonElement | null} */ (target.closest('[data-coszus-quick-open]'));
    if (opener) {
      event.preventDefault();
      event.stopPropagation();
      this.#open(opener);
      return;
    }

    const button = /** @type {HTMLElement | null} */ (target.closest('[data-coszus-quick-size]'));
    if (!button || button.hasAttribute('disabled')) return;

    event.preventDefault();
    event.stopPropagation();
    this.add(button.dataset.coszusQuickSize || '');
  };

  /** @param {HTMLButtonElement} opener */
  #open(opener) {
    const sizes = this.sizeButtons;
    const title = opener.dataset.productTitle || '';
    const link = /** @type {HTMLAnchorElement | null} */ (this.closest('.coszus-card-wrap')?.querySelector('a.coszus-card'));

    // One variant: add straight away, and only show the sheet if it goes wrong
    if (sizes.length === 0) {
      if (opener.dataset.state === 'busy') return;
      opener.dataset.state = 'busy';
      opener.setAttribute('aria-busy', 'true');
      if (!this.add()) this.#resetOpener();
      return;
    }

    sheet ||= QuickSheet.create();
    sheet?.open({ owner: this, opener, title, url: link?.href || '', sizes, choose: opener.dataset.choose });
  }

  #resetOpener() {
    const opener = /** @type {HTMLElement | null} */ (this.querySelector('[data-coszus-quick-open]'));
    if (!opener) return;
    delete opener.dataset.state;
    opener.removeAttribute('aria-busy');
  }

  /** @param {Event & { promise?: Promise<any> }} event */
  #onCartUpdate = (event) => {
    if (!this.pending) return;
    event.promise
      ?.then((result) => {
        this.pending = false;
        if (result?.detail?.didError) return; // the cart error event shows the message
        this.#resetOpener();
        if (sheet?.owner === this) sheet.close();
      })
      .catch(() => {
        // Network failure. Horizon also fires a cart error; keep its message if it came first.
        this.pending = false;
        if (this.errorShown) return;
        if (sheet?.owner === this || this.querySelector('[data-coszus-quick-open][aria-busy]')) this.#showError('');
      });
  };

  /** @param {Event} event */
  #onCartError = (event) => {
    if (!this.pending) return;
    this.pending = false;
    const error = /** @type {any} */ (event);
    const message = error.detail?.description || error.error || '';
    if (message) this.errorShown = true;
    this.#showError(message);
  };

  /** @param {string} message */
  #showError(message) {
    const opener = /** @type {HTMLButtonElement | null} */ (this.querySelector('[data-coszus-quick-open]'));
    this.#resetOpener();
    if (sheet?.owner === this && sheet.isOpen) {
      sheet.error(message);
      return;
    }
    // Only errors from the "+" open the sheet (the desktop bar sits on Horizon's own messages)
    if (!opener || opener.offsetParent === null) return;
    sheet ||= QuickSheet.create();
    sheet?.open({ owner: this, opener, title: opener.dataset.productTitle || '', url: '', sizes: this.sizeButtons, choose: opener.dataset.choose });
    sheet?.error(message);
  }

  /** @param {Event} event */
  #onSwatchChange = (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'radio') return;
    if (input.dataset.optionName !== this.dataset.groupOption) return;

    for (const row of this.querySelectorAll('[data-group]')) {
      if (row instanceof HTMLElement) row.hidden = row.dataset.group !== input.value;
    }
  };
}

/** The one size sheet on the page, shared by every card */
class QuickSheet {
  /** @param {HTMLDialogElement} dialog */
  constructor(dialog) {
    this.dialog = dialog;
    this.sizes = /** @type {HTMLElement} */ (dialog.querySelector('[data-qs-sizes]'));
    this.product = /** @type {HTMLElement} */ (dialog.querySelector('[data-qs-product]'));
    this.errorLine = /** @type {HTMLElement} */ (dialog.querySelector('[data-qs-error]'));
    this.link = /** @type {HTMLAnchorElement | null} */ (dialog.querySelector('[data-qs-link]'));
    this.choose = /** @type {HTMLElement | null} */ (dialog.querySelector('[data-qs-choose]'));
    this.chooseSize = this.choose?.textContent?.trim() || '';
    /** @type {CoszusQuickAdd | null} */
    this.owner = null;
    /** @type {HTMLElement | null} */
    this.opener = null;

    dialog.addEventListener('click', this.#onClick);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });
  }

  static create() {
    const template = document.getElementById('CoszusQuickSheet');
    if (!(template instanceof HTMLTemplateElement)) return null;
    const dialog = template.content.firstElementChild?.cloneNode(true);
    if (!(dialog instanceof HTMLDialogElement)) return null;
    document.body.append(dialog);
    return new QuickSheet(dialog);
  }

  get isOpen() {
    return this.dialog.open;
  }

  /**
   * @param {{ owner: CoszusQuickAdd, opener: HTMLElement, title: string, url: string, sizes: HTMLButtonElement[], choose?: string }} options
   *   `choose` is the line under the title for non-size choices ("Choose a colour")
   */
  open({ owner, opener, title, url, sizes, choose }) {
    this.owner = owner;
    this.opener = opener;
    this.product.textContent = title;
    this.clearError();
    this.#setBusy(null);

    if (this.link) {
      this.link.hidden = !url;
      if (url) this.link.href = url;
    }

    const soldOut = this.dialog.dataset.textSoldOut || '';
    this.sizes.replaceChildren(
      ...sizes.map((source) => {
        const button = document.createElement('button');
        const size = source.textContent?.trim() || '';
        button.type = 'button';
        button.className = 'coszus-qs__size';
        button.textContent = size;
        button.dataset.variant = source.dataset.coszusQuickSize || '';
        if (source.disabled) {
          button.setAttribute('aria-disabled', 'true');
          button.setAttribute('aria-label', soldOut.replace('[size]', size));
        } else {
          button.setAttribute('aria-label', source.getAttribute('aria-label') || size);
        }
        return button;
      })
    );
    this.sizes.hidden = sizes.length === 0;
    this.sizes.classList.toggle('coszus-qs__sizes--options', Boolean(choose));
    if (this.choose) {
      this.choose.textContent = choose || this.chooseSize;
      this.choose.hidden = sizes.length === 0;
    }

    if (this.dialog.open) return;
    this.dialog.showModal();
    document.documentElement.classList.add('coszus-scroll-lock');
    if (reducedMotion()) this.dialog.classList.add('is-open');
    else requestAnimationFrame(() => requestAnimationFrame(() => this.dialog.classList.add('is-open')));
  }

  /** @param {{ instant?: boolean }} [options] */
  close({ instant = false } = {}) {
    const dialog = this.dialog;
    if (!dialog.open) return;
    dialog.classList.remove('is-open');

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      dialog.close();
      document.documentElement.classList.remove('coszus-scroll-lock');
      this.#setBusy(null);
      // Back to the "+", unless the bag drawer opened on top
      if (!instant && this.opener?.isConnected && !document.querySelector('dialog[open]')) {
        this.opener.focus({ preventScroll: true });
      }
      this.owner = null;
    };

    const panel = dialog.querySelector('.coszus-qs__panel');
    if (instant || reducedMotion() || !panel) {
      finish();
    } else {
      panel.addEventListener('transitionend', finish, { once: true });
      window.setTimeout(finish, 450);
    }
  }

  /** @param {string} message The cart's message, else the default "Couldn't add that" */
  error(message) {
    this.#setBusy(null);
    this.errorLine.textContent = message || this.dialog.dataset.textError || '';
    this.errorLine.hidden = !this.errorLine.textContent;
  }

  clearError() {
    this.errorLine.textContent = '';
    this.errorLine.hidden = true;
  }

  /** @param {HTMLElement | null} button */
  #setBusy(button) {
    for (const size of this.sizes.querySelectorAll('.coszus-qs__size')) {
      size.classList.toggle('is-busy', size === button);
    }
    if (button) this.dialog.setAttribute('aria-busy', 'true');
    else this.dialog.removeAttribute('aria-busy');
  }

  /** @param {MouseEvent} event */
  #onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest('[data-qs-close]')) {
      this.close();
      return;
    }

    const button = /** @type {HTMLElement | null} */ (target.closest('.coszus-qs__size'));
    if (!button || !this.owner) return;
    if (button.getAttribute('aria-disabled') === 'true' || this.dialog.hasAttribute('aria-busy')) return;

    this.clearError();
    this.#setBusy(button);
    if (!this.owner.add(button.dataset.variant || '')) this.error('');
  };
}

if (!customElements.get('coszus-quick-add')) {
  customElements.define('coszus-quick-add', CoszusQuickAdd);
}
