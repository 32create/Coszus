/* Coszus: quick add from product cards, toast, and the header height for sticky bars. */
(function () {
  var toastEl, toastT;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'cz-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('on'); }, 2400);
  }
  window.czToast = toast;

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cz-add]');
    if (!b || b.disabled || !b.dataset.czAdd) return;
    e.preventDefault();
    var drawer = document.querySelector('cart-drawer');
    var body = { items: [{ id: Number(b.dataset.czAdd), quantity: 1 }] };
    if (drawer && drawer.getSectionsToRender) {
      body.sections = drawer.getSectionsToRender().map(function (s) { return s.id; });
      body.sections_url = window.location.pathname;
    }
    b.classList.add('busy');
    fetch((window.routes && window.routes.cart_add_url ? window.routes.cart_add_url : '/cart/add') + '.js', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json(); }).then(function (res) {
      b.classList.remove('busy');
      if (res.status) { toast(res.description || 'Could not add that one'); return; }
      toast('Added ' + b.dataset.czName + (b.dataset.czSize ? ', size ' + b.dataset.czSize : ''));
      document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
      if (drawer && drawer.renderContents && res.sections) {
        var item = res.items && res.items[0];
        res.id = item ? item.id : null;
        if (drawer.classList.contains('is-empty')) drawer.classList.remove('is-empty');
        drawer.renderContents(res);
      }
    }).catch(function () { b.classList.remove('busy'); toast('Something went wrong, try again'); });
  });

  function setHd() {
    var hd = document.querySelector('.cz-hd');
    if (hd) document.documentElement.style.setProperty('--cz-hd-h', hd.offsetHeight + 'px');
  }
  window.addEventListener('resize', setHd, { passive: true });
  document.addEventListener('DOMContentLoaded', setHd);
})();
