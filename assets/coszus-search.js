/*
  Coszus search panel (docs/HANDOFF.md section 3) on top of Horizon's predictive search.
  Horizon still fetches and renders the results (assets/predictive-search.js); this adds:

  1. the rotating placeholder ("Try 'Scuba set'"), only while the panel is open and empty,
     and never for reduced motion;
  2. recent searches, kept on the shopper's device (<coszus-search-recent>);
  3. popular / recent terms that run in the panel instead of leaving the page;
  4. matched letters in bold in the instant results;
  5. clearing the recently viewed products Horizon slips into the empty state, which the
     design doesn't show (and which would otherwise take over Tab in the empty panel).
*/

const RECENT_KEY = 'coszus:recent-searches';
const RECENT_MAX = 5;
const PLACEHOLDER_INTERVAL = 2800;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** @returns {string[]} */
function readRecent() {
  try {
    const value = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(value) ? value.filter((term) => typeof term === 'string' && term.trim()).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** @param {string[]} terms */
function writeRecent(terms) {
  try {
    if (terms.length) localStorage.setItem(RECENT_KEY, JSON.stringify(terms.slice(0, RECENT_MAX)));
    else localStorage.removeItem(RECENT_KEY);
  } catch {
    // Private mode or storage full: recent searches just don't stick
  }
  document.querySelectorAll('coszus-search-recent').forEach((element) => {
    if (element instanceof CoszusSearchRecent) element.render();
  });
}

/** @param {string} term */
function rememberSearch(term) {
  const clean = term.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (clean.length < 2) return;
  const lower = clean.toLowerCase();
  writeRecent([clean, ...readRecent().filter((saved) => saved.toLowerCase() !== lower)]);
}

/** Recent searches list in the empty panel. Morphs leave it alone (data-skip-subtree-update). */
class CoszusSearchRecent extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  render() {
    const terms = readRecent();
    this.replaceChildren();
    this.hidden = terms.length === 0;
    if (!terms.length) return;

    const header = document.createElement('div');
    header.className = 'coszus-search-recent__header';

    const heading = document.createElement('h3');
    heading.className = 'coszus-search__kicker';
    heading.textContent = this.dataset.heading || '';

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'coszus-search-recent__clear button-unstyled';
    clear.textContent = this.dataset.clear || '';
    if (this.dataset.clearLabel) clear.setAttribute('aria-label', this.dataset.clearLabel);
    clear.addEventListener('click', (event) => {
      event.stopPropagation();
      writeRecent([]);
      document.querySelector('#search-modal input[type="search"]')?.focus();
    });

    header.append(heading, clear);

    const list = document.createElement('ul');
    list.className = 'coszus-search-idle__terms list-unstyled';
    const searchUrl = this.dataset.searchUrl || '/search';

    for (const term of terms) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      const url = new URL(searchUrl, window.location.origin);
      url.searchParams.set('q', term);
      url.searchParams.set('options[prefix]', 'last');
      link.href = url.pathname + url.search;
      link.textContent = term;
      link.dataset.coszusSearchTerm = term;
      item.append(link);
      list.append(item);
    }

    this.append(header, list);
  }
}

if (!customElements.get('coszus-search-recent')) {
  customElements.define('coszus-search-recent', CoszusSearchRecent);
}

/** @param {string} value */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wraps the typed words in <mark> inside each instant result title.
 * @param {HTMLElement} results
 * @param {string} query
 */
function highlight(results, query) {
  const words = query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length >= 2)
    .map(escapeRegExp);
  const pattern = words.length ? new RegExp(`(${words.join('|')})`, 'gi') : null;

  results.querySelectorAll('[data-search-results] .predictive-search-results__card--product .resource-card__title').forEach((title) => {
    if (!(title instanceof HTMLElement)) return;
    const text = title.textContent || '';
    if (title.dataset.coszusMarked === query && title.querySelector('mark')) return;

    title.dataset.coszusMarked = query;
    if (!pattern) {
      if (title.querySelector('mark')) title.textContent = text;
      return;
    }

    const fragment = document.createDocumentFragment();
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (index > last) fragment.append(text.slice(last, index));
      const mark = document.createElement('mark');
      mark.textContent = match[0];
      fragment.append(mark);
      last = index + match[0].length;
    }
    if (last === 0) return;
    if (last < text.length) fragment.append(text.slice(last));
    title.replaceChildren(fragment);
  });
}

function init() {
  const modal = document.getElementById('search-modal');
  const dialog = modal?.querySelector('dialog');
  const component = modal?.querySelector('predictive-search-component');
  const input = component?.querySelector('input[type="search"]');
  const results = component?.querySelector('[ref="predictiveSearchResults"]');
  if (!modal || !dialog || !(component instanceof HTMLElement) || !(input instanceof HTMLInputElement)) return;

  /* 1. Rotating placeholder */
  const placeholders = (input.dataset.coszusPlaceholders || '')
    .split('|')
    .map((text) => text.trim())
    .filter(Boolean);
  let placeholderIndex = 0;
  /** @type {number | undefined} */
  let placeholderTimer;
  /** @type {number | undefined} */
  let fadeTimer;

  const stopPlaceholders = () => {
    window.clearInterval(placeholderTimer);
    window.clearTimeout(fadeTimer);
    placeholderTimer = undefined;
    input.classList.remove('coszus-search-input--fading');
  };

  const startPlaceholders = () => {
    stopPlaceholders();
    if (placeholders.length < 2 || reducedMotion.matches) return;
    placeholderTimer = window.setInterval(() => {
      if (input.value || !dialog.open) return;
      input.classList.add('coszus-search-input--fading');
      fadeTimer = window.setTimeout(() => {
        placeholderIndex = (placeholderIndex + 1) % placeholders.length;
        input.placeholder = placeholders[placeholderIndex] ?? '';
        input.classList.remove('coszus-search-input--fading');
      }, 300);
    }, PLACEHOLDER_INTERVAL);
  };

  new MutationObserver(() => {
    if (dialog.open) {
      startPlaceholders();
      modal.querySelectorAll('coszus-search-recent').forEach((element) => {
        if (element instanceof CoszusSearchRecent) element.render();
      });
    } else {
      stopPlaceholders();
      placeholderIndex = 0;
      input.placeholder = placeholders[0] ?? input.placeholder;
    }
  }).observe(dialog, { attributes: true, attributeFilter: ['open'] });

  reducedMotion.addEventListener('change', () => (dialog.open ? startPlaceholders() : stopPlaceholders()));

  /* 2 + 3. Recent searches, and terms that run in the panel */
  input.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Enter' && !event.isComposing) rememberSearch(input.value);
    },
    true
  );

  component.addEventListener('submit', () => rememberSearch(input.value), true);

  component.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const termLink = target?.closest('[data-coszus-search-term]');

    if (termLink instanceof HTMLElement) {
      // Plain clicks only: new-tab clicks keep the link
      if (event instanceof MouseEvent && (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)) return;
      event.preventDefault();
      const term = termLink.dataset.coszusSearchTerm || '';
      input.value = term;
      input.focus();
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: term }));
      return;
    }

    if (target?.closest('[data-search-results] a') && input.value.trim()) rememberSearch(input.value);
  });

  /* 4 + 5. Highlight results, empty the hidden recently viewed slot */
  if (results instanceof HTMLElement) {
    const tidy = () => {
      results.querySelectorAll('[data-coszus-hidden-products]').forEach((slot) => {
        if (slot.childElementCount) slot.replaceChildren();
      });
      highlight(results, input.value.trim());
    };
    new MutationObserver(tidy).observe(results, { childList: true, subtree: true, characterData: true });
    tidy();
  }
}

/* The results page counts as a search too */
if (window.location.pathname.endsWith('/search')) {
  const query = new URLSearchParams(window.location.search).get('q');
  if (query) rememberSearch(query);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
