(() => {
  const $ = (s) => document.querySelector(s);
  const rupees = (p) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(p / 100);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STEPS = ['PAID', 'PACKED', 'SHIPPED', 'DELIVERED'];
  const LABEL = { PENDING_PAYMENT: 'Awaiting payment', PAID: 'Paid', PACKED: 'Packed', SHIPPED: 'Shipped', DELIVERED: 'Delivered', CANCELLED: 'Cancelled' };

  const params = new URLSearchParams(location.search);
  if (params.get('orderNo')) $('#t-no').value = params.get('orderNo');

  $('#tf').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#tErr').textContent = ''; $('#result').innerHTML = '';
    const q = new URLSearchParams({ orderNo: $('#t-no').value.trim(), phone: $('#t-ph').value.trim() });
    try {
      const res = await fetch('/api/orders/track?' + q);
      const o = await res.json();
      if (!res.ok) throw new Error(o.error || 'Could not find that order');
      const idx = STEPS.indexOf(o.status);
      const steps = o.status === 'CANCELLED' || o.status === 'PENDING_PAYMENT' ? '' :
        `<ol class="steps">${STEPS.map((s, i) => `<li class="${i <= idx ? 'done' : ''}">${LABEL[s]}</li>`).join('')}</ol>`;
      $('#result').innerHTML = `<div class="panel">
        <p><span class="pill ${esc(o.status)}">${esc(LABEL[o.status])}</span> &nbsp; Order <b>${esc(o.orderNo)}</b>, placed ${new Date(o.createdAt).toLocaleString('en-IN')}</p>
        ${steps}
        ${o.trackingInfo ? `<p><b>Courier details:</b> ${esc(o.trackingInfo)}</p>` : ''}
        <div class="tablewrap"><table><thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead><tbody>
          ${o.items.map((i) => `<tr><td>${esc(i.name)} (${esc(i.size)})</td><td>${i.quantity}</td><td>${rupees(i.linePaise)}</td></tr>`).join('')}
          <tr><td colspan="2">Delivery</td><td>${o.shippingPaise ? rupees(o.shippingPaise) : 'Free'}</td></tr>
          <tr><td colspan="2"><b>Total</b></td><td><b>${rupees(o.totalPaise)}</b></td></tr>
        </tbody></table></div>
        <p class="sub" style="margin-top:14px">Delivering to ${esc(o.name)}, ${esc(o.address)}, ${esc(o.city)}, ${esc(o.state)} ${esc(o.pincode)}</p>
      </div>`;
    } catch (ex) {
      $('#tErr').textContent = ex.message;
    }
  });
})();
