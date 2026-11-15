/*
  Join the Family (snippets/coszus-join.liquid, docs/WISHLIST-APP.md "Join the Family").

  - <coszus-join>: the sign-up box. Email, optional "Shopping for" chips (and birthday in the
    footer). On submit the answers become customer tags: newsletter, source:footer|wishlist|rewards,
    shopping-for:men, birthday:DD-MM. It's Shopify's customer form, so the page reloads with
    ?customer_posted=true when it worked.
  - After that reload: straight to Shopify sign-in with the email filled in (login_hint) and back to
    this page (return_to), so a wishlist saved as a guest merges into the new account. With
    Theme settings > Join the Family > "Go to sign-in after joining" off, or on classic accounts,
    the box shows a thank-you and a sign-in button instead.
  - <dialog data-join-dialog>: the box as a small panel (wishlist, Points page). Native modal dialog,
    so focus stays inside and Escape closes it. [data-coszus-join-open="DialogId"] opens one, and
    so does #join on the end of a page's URL (the Points page: /pages/coszus-points#join).

  Loaded by the snippet, and by the wishlist panel (assets/coszus-join-panel.js) after a guest's
  first save. No API keys: everything goes through Shopify's own form and sign-in.
*/

const PENDING = 'coszus:join-pending';
export const STATE = 'coszus:join';

/** @returns {{ redirect: boolean, login: string | null, panel: string }} */
function readConfig() {
  try {
    const el = document.getElementById('CoszusJoinConfig');
    if (el?.textContent) return JSON.parse(el.textContent);
  } catch (e) {}
  return { redirect: false, login: null, panel: '' };
}

export const config = readConfig();

/** 'joined', 'dismissed' or 'shown' once the wishlist panel has been offered */
export function recall() {
  try {
    return localStorage.getItem(STATE) || '';
  } catch (e) {
    return '';
  }
}

/** @param {'joined' | 'dismissed' | 'shown'} value */
export function remember(value) {
  try {
    // Joined is final
    if (localStorage.getItem(STATE) !== 'joined') localStorage.setItem(STATE, value);
  } catch (e) {}
}

/** This page, without Shopify's ?customer_posted=true */
function returnPath() {
  const url = new URL(window.location.href);
  url.searchParams.delete('customer_posted');
  return url.pathname + url.search;
}

/**
 * Shopify customer accounts sign-in, back to this page, email filled in when known
 * @param {string} [email]
 */
export function signInUrl(email) {
  if (!config.login) return null;
  const params = new URLSearchParams({ return_to: returnPath() });
  if (email) params.set('login_hint', email);
  return `${config.login}?${params}`;
}

class CoszusJoin extends HTMLElement {
  connectedCallback() {
    const form = this.querySelector('form');
    const email = this.querySelector('input[type="email"]');
    if (!form || !(email instanceof HTMLInputElement)) return;

    // The panel is rendered from another URL, so point sign-in links back at this page
    this.#signInLinks();

    // Footer layout: email first, then birthday and "Shopping for" open together underneath
    const reveal = () => {
      const panel = this.querySelector('[data-signup-step="more"]');
      if (!panel || panel.classList.contains('is-open')) return;
      panel.classList.add('is-open');
      panel.removeAttribute('inert');
    };
    email.addEventListener('focus', reveal);
    email.addEventListener('input', reveal);

    const dateInputs = Array.from(this.querySelectorAll('[data-birthday]'));
    dateInputs.forEach((input, index) => {
      if (!(input instanceof HTMLInputElement)) return;
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '').slice(0, 2);
        const next = dateInputs[index + 1];
        if (input.value.length === 2 && next instanceof HTMLInputElement) next.focus();
      });
    });
    for (const chip of this.querySelectorAll('[data-interest]')) {
      chip.addEventListener('click', () => {
        chip.setAttribute('aria-pressed', String(chip.getAttribute('aria-pressed') !== 'true'));
      });
    }

    form.addEventListener('submit', () => {
      const tags = ['newsletter'];
      if (this.dataset.source) tags.push(`source:${this.dataset.source}`);
      const [day, month] = dateInputs.map((input) => /** @type {HTMLInputElement} */ (input).value.padStart(2, '0'));
      if (Number(day) >= 1 && Number(day) <= 31 && Number(month) >= 1 && Number(month) <= 12) {
        tags.push(`birthday:${day}-${month}`);
      }
      for (const chip of this.querySelectorAll('[data-interest][aria-pressed="true"]')) {
        tags.push(`shopping-for:${/** @type {HTMLElement} */ (chip).dataset.interest}`);
      }
      const field = form.querySelector('input[name="contact[tags]"]');
      if (field instanceof HTMLInputElement) field.value = tags.join(',');

      // Picked up when the page comes back (see afterJoin)
      try {
        sessionStorage.setItem(PENDING, JSON.stringify({ email: email.value.trim(), source: this.dataset.source || '' }));
      } catch (e) {}
    });
  }

  /** @param {string} [email] */
  #signInLinks(email) {
    const url = signInUrl(email);
    if (!url) return;
    for (const link of this.querySelectorAll('a[data-join-signin]')) link.setAttribute('href', url);
  }

  /**
   * The product they just saved, at the top of the wishlist panel
   * @param {{ title?: string, image?: string }} [product]
   */
  showSaved(product) {
    const saved = this.querySelector('[data-join-saved]');
    if (!(saved instanceof HTMLElement) || !product?.title) return;
    const title = saved.querySelector('[data-join-saved-title]');
    if (title) title.textContent = product.title;
    const image = saved.querySelector('[data-join-saved-image]');
    if (image instanceof HTMLImageElement) {
      if (product.image) image.src = product.image;
      image.hidden = !product.image;
    }
    saved.hidden = false;
  }

  /**
   * Thank-you state, with a sign-in button that fills in their email
   * @param {string} [email]
   */
  showDone(email) {
    const body = this.querySelector('[data-join-body]');
    const done = this.querySelector('[data-join-done]');
    if (!(done instanceof HTMLElement)) return;
    if (body instanceof HTMLElement) body.hidden = true;
    // The wishlist panel's "Don't lose it." and saved product give way to the thank-you
    const saved = this.querySelector('[data-join-saved]');
    if (saved instanceof HTMLElement) saved.hidden = true;
    const heading = this.querySelector('[data-heading-done]');
    if (heading instanceof HTMLElement && heading.dataset.headingDone) heading.textContent = heading.dataset.headingDone;
    done.hidden = false;
    this.#signInLinks(email);
    done.focus({ preventScroll: !this.closest('dialog') });
  }
}

if (!customElements.get('coszus-join')) customElements.define('coszus-join', CoszusJoin);

/**
 * Opens a join panel. Native modal: the page behind can't be reached and Escape closes it.
 * Closing it any way other than joining counts as "Not now".
 * @param {Element | null} dialog
 * @param {HTMLElement | null} [opener] - Gets focus back on close
 */
export function openDialog(dialog, opener = null) {
  if (!(dialog instanceof HTMLDialogElement) || dialog.open) return;
  dialog.showModal();
  dialog.addEventListener(
    'close',
    () => {
      remember('dismissed');
      if (opener?.isConnected) opener.focus();
    },
    { once: true }
  );
}

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  const dismiss = target.closest('[data-join-dismiss]');
  if (dismiss) {
    dismiss.closest('dialog')?.close();
    return;
  }

  // A click on the dimmed area outside the panel closes it
  if (target instanceof HTMLDialogElement && target.matches('[data-join-dialog]') && target.open) {
    const rect = target.getBoundingClientRect();
    const { clientX: x, clientY: y } = /** @type {MouseEvent} */ (event);
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) target.close();
    return;
  }

  const opener = target.closest('[data-coszus-join-open]');
  if (opener instanceof HTMLElement) {
    const dialog = document.getElementById(opener.dataset.coszusJoinOpen || '');
    if (dialog instanceof HTMLDialogElement) {
      event.preventDefault();
      openDialog(dialog, opener);
    }
  }
});

/** The page has come back from a successful Join (Shopify adds ?customer_posted=true) */
function afterJoin() {
  if (new URL(window.location.href).searchParams.get('customer_posted') !== 'true') return;
  /** @type {{ email?: string, source?: string } | null} */
  let pending = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING) || 'null');
    sessionStorage.removeItem(PENDING);
  } catch (e) {}
  if (!pending) return;
  remember('joined');

  const url = config.redirect ? signInUrl(pending.email) : null;
  if (url) {
    window.location.replace(url);
    return;
  }

  // Thank-you where they joined
  const box = document.querySelector(`coszus-join[data-source="${CSS.escape(pending.source || '')}"]`);
  if (box instanceof CoszusJoin) {
    openDialog(box.closest('dialog'));
    box.showDone(pending.email);
  } else if (pending.source === 'wishlist') {
    // The wishlist panel isn't on the page any more: bring it back as the thank-you
    import('@theme/coszus-join-panel').then((panel) => panel.openJoinPanel({ done: pending?.email || '' })).catch(() => {});
  }
}

afterJoin();

// /pages/coszus-points#join (Smile's Join button) opens the box straight away
const openFromHash = () => {
  if (window.location.hash !== '#join') return;
  openDialog(document.querySelector('dialog[data-join-dialog]'));
};
openFromHash();
window.addEventListener('hashchange', openFromHash);
