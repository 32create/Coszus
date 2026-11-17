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

/* Countdown clocks: any element with data-cz-cd="2026-11-27T00:00:00Z" */
(function () {
  function pad(n) { return String(n).padStart(2, '0'); }
  function tick() {
    document.querySelectorAll('[data-cz-cd]').forEach(function (el) {
      var t = Date.parse(el.dataset.czCd); if (isNaN(t)) return;
      var left = Math.max(0, t - Date.now());
      var set = function (k, v) { var b = el.querySelector('[data-' + k + ']'); if (b) b.textContent = pad(v); };
      set('d', Math.floor(left / 864e5)); set('h', Math.floor(left / 36e5) % 24); set('m', Math.floor(left / 6e4) % 60); set('s', Math.floor(left / 1e3) % 60);
    });
  }
  document.addEventListener('DOMContentLoaded', function () { tick(); setInterval(tick, 1000); });
})();
