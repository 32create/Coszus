/**
 * Coszus top bar marquee (sections/coszus-top-bar.liquid).
 *
 * The CSS animation does the scrolling. This only makes the loop seamless on any screen width:
 * it repeats the messages until the track is wider than the screen plus one set, then moves the
 * track by exactly one set at a constant speed (px per second, from the section settings).
 * CSS pauses it on hover and focus. Reduced motion is handled in CSS. Copies stay clickable (not
 * inert): the message on screen is usually a copy, so its links must work.
 */
const mobileQuery = window.matchMedia('(max-width: 820px)');

class CoszusTopBar extends HTMLElement {
  /** @type {ResizeObserver | undefined} */
  #observer;
  #frame = 0;

  connectedCallback() {
    this.#observer = new ResizeObserver(() => this.#schedule());
    this.#observer.observe(this);
    mobileQuery.addEventListener('change', this.#schedule);
    document.fonts?.ready.then(this.#schedule);
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    mobileQuery.removeEventListener('change', this.#schedule);
    cancelAnimationFrame(this.#frame);
  }

  #schedule = () => {
    cancelAnimationFrame(this.#frame);
    this.#frame = requestAnimationFrame(() => this.#layout());
  };

  #layout() {
    const track = this.querySelector('.coszus-top-bar__track');
    const group = track?.querySelector('.coszus-top-bar__group:not([data-copy])');
    if (!(track instanceof HTMLElement) || !(group instanceof HTMLElement)) return;

    const setWidth = group.getBoundingClientRect().width;
    const viewportWidth = this.clientWidth;
    if (!setWidth || !viewportWidth) return;

    // One set scrolls out while the rest fill the screen behind it
    const needed = Math.max(2, Math.ceil(viewportWidth / setWidth) + 1);
    const copies = track.querySelectorAll('.coszus-top-bar__group');

    for (let i = copies.length; i < needed; i++) {
      const copy = /** @type {HTMLElement} */ (group.cloneNode(true));
      copy.dataset.copy = '';
      copy.setAttribute('aria-hidden', 'true');
      copy.removeAttribute('aria-label');
      copy.querySelectorAll('a').forEach((link) => link.setAttribute('tabindex', '-1'));
      copy
        .querySelectorAll('[data-shopify-editor-block]')
        .forEach((el) => el.removeAttribute('data-shopify-editor-block'));
      track.append(copy);
    }

    const speed = Number(mobileQuery.matches ? this.dataset.speedMobile : this.dataset.speedDesktop) || 30;

    track.style.setProperty('--top-bar-shift', `${setWidth}px`);
    track.style.setProperty('--top-bar-duration', `${(setWidth / speed).toFixed(2)}s`);
  }
}

if (!customElements.get('coszus-top-bar')) customElements.define('coszus-top-bar', CoszusTopBar);
