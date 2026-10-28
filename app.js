(() => {
  const $ = (s) => document.querySelector(s);
  const rupees = (p) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(p / 100);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let products = [];
  let config = { shippingPaise: 6000, freeShippingAbovePaise: 99900, shopName: 'Oil Shop' };
  let cart = {};
  try { cart = JSON.parse(localStorage.getItem('cart') || '{}'); } catch { cart = {}; }
  let pending = null; // an order created on the server but not paid yet

  const save = () => { try { localStorage.setItem('cart', JSON.stringify(cart)); } catch { /* private mode */ } };
  const toast = (msg) => {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    setTimeout(() => t.classList.remove('on'), 2200);
  };

  async function api(path, opts) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  /* ---------- catalogue ---------- */
  function renderProducts() {
    const grid = $('#grid');
    if (!products.length) { grid.innerHTML = '<p class="empty">No oils are available right now. Please check back soon.</p>'; return; }
    grid.innerHTML = products.map((p) => {
      const out = p.stock <= 0;
      const low = !out && p.stock <= 10;
      return `<article class="card">
        <div class="bottle">${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.name)}" loading="lazy">` : '<svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true"><path d="M26 6h12v8l6 10v30a4 4 0 0 1-4 4H24a4 4 0 0 1-4-4V24l6-10z" fill="#d9a21b"/></svg>'}</div>
        <div class="body">
          <h3>${esc(p.name)}</h3>
          <div class="size">${esc(p.size)}</div>
          <p class="desc">${esc(p.description)}</p>
          ${low ? `<div class="low">Only ${p.stock} left</div>` : ''}
          <div class="row">
            <span class="price">${rupees(p.pricePaise)}</span>
            <button class="btn" data-add="${p.id}" ${out ? 'disabled' : ''}>${out ? 'Out of stock' : 'Add to cart'}</button>
          </div>
        </div>
      </article>`;
    }).join('');
  }

  /* ---------- cart ---------- */
  function totals() {
    let subtotal = 0;
    for (const [id, qty] of Object.entries(cart)) {
      const p = products.find((x) => x.id === Number(id));
      if (p) subtotal += p.pricePaise * qty;
    }
    const shipping = subtotal === 0 || subtotal >= config.freeShippingAbovePaise ? 0 : config.shippingPaise;
    return { subtotal, shipping, total: subtotal + shipping };
  }

  function cleanCart() {
    for (const id of Object.keys(cart)) {
      const p = products.find((x) => x.id === Number(id));
      if (!p || p.stock <= 0) delete cart[id];
      else cart[id] = Math.min(cart[id], p.stock, 20);
    }
  }

  function renderCart() {
    const ids = Object.keys(cart);
    $('#cartCount').textContent = ids.reduce((n, id) => n + cart[id], 0);
    $('#lines').innerHTML = ids.length
      ? ids.map((id) => {
          const p = products.find((x) => x.id === Number(id));
          if (!p) return '';
          return `<div class="line">
            <div><div class="nm">${esc(p.name)}</div><div class="sz">${esc(p.size)} · ${rupees(p.pricePaise)}</div></div>
            <div style="text-align:right"><b>${rupees(p.pricePaise * cart[id])}</b></div>
            <div class="qty"><button data-dec="${id}" aria-label="Decrease">−</button><output>${cart[id]}</output><button data-inc="${id}" aria-label="Increase">+</button></div>
            <button class="icon-btn" style="font-size:.9rem;justify-self:end" data-del="${id}">Remove</button>
          </div>`;
        }).join('')
      : '<p class="empty">Your cart is empty. Add an oil to get started.</p>';
    const t = totals();
    $('#sSub').textContent = rupees(t.subtotal);
    $('#sShip').textContent = t.shipping ? rupees(t.shipping) : (t.subtotal ? 'Free' : '₹0');
    $('#sTotal').textContent = rupees(t.total);
    $('#checkout').disabled = !ids.length;
    save();
  }

  function setCart(open) {
    $('#drawer').classList.toggle('on', open);
    $('#scrim').classList.toggle('on', open);
    $('#drawer').setAttribute('aria-hidden', String(!open));
  }

  function change(id, delta) {
    const p = products.find((x) => x.id === Number(id));
    if (!p) return;
    const next = (cart[id] || 0) + delta;
    if (next <= 0) delete cart[id];
    else if (next > Math.min(p.stock, 20)) toast(`Only ${Math.min(p.stock, 20)} available`);
    else cart[id] = next;
    renderCart();
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.add) { change(t.dataset.add, 1); toast('Added to cart'); }
    else if (t.dataset.inc) change(t.dataset.inc, 1);
    else if (t.dataset.dec) change(t.dataset.dec, -1);
    else if (t.dataset.del) { delete cart[t.dataset.del]; renderCart(); }
  });
  $('#openCart').onclick = () => setCart(true);
  $('#closeCart').onclick = () => setCart(false);
  $('#scrim').onclick = () => setCart(false);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setCart(false); });

  /* ---------- checkout ---------- */
  const dlg = $('#dlg');
  const showForm = () => { $('#formView').hidden = false; $('#resultView').hidden = true; };
  const showResult = (html) => { $('#formView').hidden = true; const r = $('#resultView'); r.hidden = false; r.innerHTML = html; };

  $('#checkout').onclick = () => {
    setCart(false);
    $('#dTotal').textContent = rupees(totals().total);
    $('#formErr').textContent = '';
    showForm();
    dlg.showModal();
  };
  $('#dCancel').onclick = () => { dlg.close(); setCart(true); };

  function openRazorpay(order) {
    const options = {
      key: order.keyId,
      amount: order.amountPaise,
      currency: 'INR',
      name: config.shopName,
      description: `Order ${order.orderNo}`,
      order_id: order.razorpayOrderId,
      prefill: { name: order.customer.name, email: order.customer.email || '', contact: order.customer.phone },
      theme: { color: '#2f5233' },
      handler: async (resp) => {
        try {
          const r = await api('/api/payments/verify', { method: 'POST', body: JSON.stringify(resp) });
          pending = null; cart = {}; renderCart(); loadProducts();
          showResult(`<div class="ok-box"><div class="big">Payment received. Thank you!</div>
            <p>Your order number is</p><p><code class="order">${esc(r.orderNo)}</code></p>
            <p>Use this number and your mobile number to <a href="/track">track your order</a>.</p>
            <div class="actions" style="justify-content:center"><button class="btn" id="doneBtn" type="button">Continue shopping</button></div></div>`);
        } catch {
          // Payment went through at Razorpay but our confirmation call failed. The webhook will still confirm it.
          pending = null; cart = {}; renderCart();
          showResult(`<div class="ok-box"><div class="big">Payment received</div>
            <p>We could not confirm it instantly, but your payment is safe. Order <code class="order">${esc(order.orderNo)}</code> will be confirmed within a few minutes.</p>
            <div class="actions" style="justify-content:center"><button class="btn" id="doneBtn" type="button">Close</button></div></div>`);
        }
        $('#doneBtn').onclick = () => dlg.close();
      },
      modal: {
        ondismiss: () => {
          showResult(`<div class="ok-box"><div class="big">Payment not completed</div>
            <p>Your order <code class="order">${esc(order.orderNo)}</code> is held for 30 minutes. Your bank has not been charged unless you saw a success message.</p>
            <div class="actions" style="justify-content:center">
              <button class="btn ghost" id="closeBtn" type="button">Close</button>
              <button class="btn" id="retryBtn" type="button">Try payment again</button></div></div>`);
          $('#closeBtn').onclick = () => dlg.close();
          $('#retryBtn').onclick = () => openRazorpay(order);
        },
      },
    };
    // Show only net banking if ONLY_METHOD=netbanking in .env (the Razorpay dashboard is the authoritative control).
    if (order.onlyMethod === 'netbanking') {
      options.config = { display: { hide: ['card', 'upi', 'wallet', 'emi', 'paylater'].map((method) => ({ method })) } };
    }
    const rzp = new Razorpay(options);
    rzp.on('payment.failed', (r) => toast(r.error && r.error.description ? r.error.description : 'Payment failed. Please try again.'));
    rzp.open();
  }

  $('#form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#formErr'); err.textContent = '';
    const btn = $('#payBtn'); btn.disabled = true; btn.textContent = 'Preparing payment…';
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const items = Object.entries(cart).map(([productId, quantity]) => ({ productId: Number(productId), quantity }));
      pending = await api('/api/orders', { method: 'POST', body: JSON.stringify({ customer: f, items }) });
      openRazorpay(pending);
    } catch (ex) {
      err.textContent = ex.message;
      loadProducts(); // stock may have changed
    } finally {
      btn.disabled = false; btn.textContent = 'Pay now';
    }
  });

  /* ---------- boot ---------- */
  async function loadProducts() {
    try {
      products = await api('/api/products');
      cleanCart(); renderProducts(); renderCart();
    } catch {
      $('#grid').innerHTML = '<p class="empty">Could not load oils. Please refresh the page.</p>';
    }
  }
  (async () => {
    try {
      config = await api('/api/config');
      $('#freeAbove').textContent = rupees(config.freeShippingAbovePaise);
    } catch { /* defaults */ }
    await loadProducts();
  })();
})();
