/*
  Coszus bag drawer: close it a few seconds after Add to bag opens it (Theme settings > Bag drawer >
  "Close the bag after adding", on the drawer as data-auto-close; 0 = never).

  Only after a successful add, and only if the drawer is open by then (Horizon's cart-drawer.js
  opens it when "Auto-open cart drawer" is on). Opening the bag from the bag icon never starts it.
  Any sign the shopper is using the bag cancels it: moving the pointer over it, a touch, a scroll or a key
  press inside it. Focus moving into the drawer doesn't count, because Horizon puts it there on open.
*/

const CART_LINES_UPDATE = 'shopify:cart:lines-update';
// pointermove, not pointerenter: the drawer slides in under a still pointer after a quick add
const CANCEL_EVENTS = ['pointermove', 'pointerdown', 'touchstart', 'wheel', 'keydown'];

/** @type {number | undefined} */
let timer;
/** @type {AbortController | null} */
let watching = null;

function stop() {
  window.clearTimeout(timer);
  timer = undefined;
  watching?.abort();
  watching = null;
}

/** @param {HTMLElement & { isOpen?: boolean, close?: () => void }} drawer @param {number} seconds */
function start(drawer, seconds) {
  stop();
  const panel = drawer.querySelector('dialog') || drawer;
  watching = new AbortController();
  const { signal } = watching;

  for (const type of CANCEL_EVENTS) panel.addEventListener(type, stop, { signal, passive: true });
  panel.addEventListener('scroll', stop, { signal, passive: true, capture: true });
  drawer.addEventListener('theme-drawer:close', stop, { signal });

  timer = window.setTimeout(() => {
    stop();
    if (drawer.isOpen) drawer.close?.();
  }, seconds * 1000);
}

document.addEventListener(CART_LINES_UPDATE, (event) => {
  const update = /** @type {any} */ (event);
  if (update.action !== 'add') return;

  const drawer = /** @type {any} */ (document.getElementById('cart-drawer'));
  const seconds = Number(drawer?.dataset.autoClose || 0);
  if (!drawer || seconds <= 0) return;

  update.promise
    ?.then((/** @type {any} */ result) => {
      if (result?.detail?.didError) return;
      // cart-drawer.js opens the drawer in the same promise chain; check once it has run.
      // (A timeout, not requestAnimationFrame, which doesn't run in background tabs.)
      window.setTimeout(() => {
        if (drawer.isOpen) start(drawer, seconds);
      }, 0);
    })
    .catch(() => {});
});
