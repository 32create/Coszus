/**
 * Coszus promo banner (sections/coszus-promo-banner.liquid).
 *
 * Plain JS, no libraries. The section renders the countdown digits on the server, so there is
 * nothing to wait for and nothing moves; this only keeps them ticking and swaps in the "done"
 * text, inside the same box, when the target time passes. It ticks once a second, or once a
 * minute (the seconds are hidden in CSS) for visitors who ask for reduced motion.
 *
 * <coszus-promo-banner data-hide-after="unix seconds"> also hides the whole banner once its
 * "Hide after" time passes while the page is open. The server already leaves it out on the next
 * load. Never in the theme editor, where the banner always shows so it can be styled.
 */
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const designMode = Boolean(window.Shopify && window.Shopify.designMode);

class CoszusPromoBanner extends HTMLElement {
  #timer = 0;

  connectedCallback() {
    const hideAfter = Number(this.dataset.hideAfter) * 1000;
    if (designMode || !hideAfter) return;

    const check = () => {
      if (Date.now() <= hideAfter) return;
      this.hidden = true;
      window.clearInterval(this.#timer);
    };
    check();
    this.#timer = window.setInterval(check, 60000);
  }

  disconnectedCallback() {
    window.clearInterval(this.#timer);
  }
}

class CoszusCountdown extends HTMLElement {
  #timer = 0;
  #end = 0;
  /** @type {Record<string, HTMLElement>} */
  #values = {};
  /** @type {HTMLElement | null} */
  #text = null;
  #lastMinute = -1;

  connectedCallback() {
    this.#end = Number(this.dataset.end) * 1000;
    if (!this.#end) return;

    for (const element of this.querySelectorAll('[data-unit]')) {
      if (element instanceof HTMLElement && element.dataset.unit) this.#values[element.dataset.unit] = element;
    }
    this.#text = this.querySelector('[data-countdown-text]');

    this.#tick();
    this.#start();
    reducedMotion.addEventListener('change', this.#restart);
    document.addEventListener('visibilitychange', this.#onVisibility);
  }

  disconnectedCallback() {
    this.#stop();
    reducedMotion.removeEventListener('change', this.#restart);
    document.removeEventListener('visibilitychange', this.#onVisibility);
  }

  #start() {
    const step = reducedMotion.matches ? 60000 : 1000;
    // First tick on the next whole second (or minute) so the digits change on the beat
    const delay = step - (Date.now() % step);
    this.#timer = window.setTimeout(() => {
      this.#tick();
      this.#timer = window.setInterval(this.#tick, step);
    }, delay);
  }

  #stop() {
    // Timeout and interval ids share one pool, so clearing both is safe whichever is live
    window.clearTimeout(this.#timer);
    window.clearInterval(this.#timer);
  }

  #restart = () => {
    this.#stop();
    this.#start();
  };

  // Browsers throttle timers in background tabs; catch up as soon as the tab is back
  #onVisibility = () => {
    if (document.visibilityState === 'visible') this.#tick();
  };

  #tick = () => {
    const remaining = Math.max(0, Math.floor((this.#end - Date.now()) / 1000));
    const parts = {
      days: Math.floor(remaining / 86400),
      hours: Math.floor((remaining % 86400) / 3600),
      minutes: Math.floor((remaining % 3600) / 60),
      seconds: remaining % 60,
    };

    for (const [unit, value] of Object.entries(parts)) {
      const element = this.#values[unit];
      if (!element) continue;
      const text = unit === 'days' && value > 99 ? String(value) : String(value).padStart(2, '0');
      if (element.textContent !== text) element.textContent = text;
    }

    // Screen readers get a sentence, refreshed once a minute, never the ticking seconds
    if (this.#text && parts.minutes !== this.#lastMinute) {
      this.#lastMinute = parts.minutes;
      this.#text.textContent = `${parts.days} days, ${parts.hours} hours, ${parts.minutes} minutes`;
    }

    if (remaining === 0) {
      this.setAttribute('data-done', '');
      this.#stop();
    }
  };
}

if (!customElements.get('coszus-promo-banner')) customElements.define('coszus-promo-banner', CoszusPromoBanner);
if (!customElements.get('coszus-countdown')) customElements.define('coszus-countdown', CoszusCountdown);
