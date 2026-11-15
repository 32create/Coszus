/*
  The wishlist's Join the Family panel (docs/WISHLIST-APP.md "Join the Family").

  Only loaded after a guest's first save (assets/coszus-wishlist.js), or to say thanks after they
  joined from it. Fetches sections/coszus-join-panel.liquid with the Section Rendering API, so no
  page carries the panel's markup until it's needed. The save itself has already happened.
*/

import { config, openDialog, remember } from '@theme/coszus-join';

const ID = 'CoszusJoinDialog-wishlist';

/** @type {Promise<HTMLDialogElement | null> | null} */
let loading = null;

/** @returns {Promise<HTMLDialogElement | null>} */
function load() {
  const existing = document.getElementById(ID);
  if (existing instanceof HTMLDialogElement) return Promise.resolve(existing);
  if (!config.panel) return Promise.resolve(null);
  // @ts-ignore
  const root = window.Shopify?.routes?.root || '/';
  loading ||= fetch(`${root}?section_id=${encodeURIComponent(config.panel)}`)
    .then((response) => (response.ok ? response.text() : ''))
    .then((html) => {
      const dialog = new DOMParser().parseFromString(html, 'text/html').getElementById(ID);
      if (!(dialog instanceof HTMLDialogElement)) return null;
      document.body.append(dialog);
      return dialog;
    })
    .catch(() => null)
    .finally(() => {
      loading = null;
    });
  return loading;
}

/**
 * @param {{ opener?: HTMLElement | null, done?: string, product?: { title?: string, image?: string } }} [options]
 *   opener: the bookmark that was tapped (focus goes back to it). done: show the thank-you for this email.
 *   product: what they just saved, shown at the top ("Saved ✓").
 */
export async function openJoinPanel({ opener = null, done, product } = {}) {
  const dialog = await load();
  if (!dialog) return;
  const box = dialog.querySelector('coszus-join');
  if (done === undefined) {
    remember('shown');
    // @ts-ignore
    box?.showSaved?.(product);
  }
  openDialog(dialog, opener);
  // @ts-ignore
  if (done !== undefined) box?.showDone?.(done);
}
