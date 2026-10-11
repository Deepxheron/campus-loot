(function () {
  'use strict';
  var KIND = { cash: 'Cash Treasure', voucher: 'Voucher Treasure', mystery: 'Mystery Box' };
  var LANES = [
    { key: 'cash', cls: '', ic: '₹', t: 'Cash Treasure', d: 'Real cash in a sealed envelope. Biggest prizes, smallest crowds.' },
    { key: 'voucher', cls: 'v', ic: '%', t: 'Voucher Treasure', d: 'Food, store and cafe vouchers hidden around campus.' },
    { key: 'mystery', cls: 'm', ic: '?', t: 'Mystery Box', d: 'Cash, vouchers or something else. You find out when you open it.' }
  ];
  var events = [], config = { payName: 'Campus Loot', qrUrl: '', upi: '', contact: '', gateway: false }, tab = 'ongoing';
  var ov = document.getElementById('ov'), modal = document.getElementById('modal'), lastFocus = null, pollTimer = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function inr(n) { return '₹' + Number(n).toLocaleString('en-IN'); }
  function status(e) {
    var now = Date.now();
    if (now < Date.parse(e.start)) return 'upcoming';
    return now < Date.parse(e.end) ? 'ongoing' : 'past';
  }
  function when(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' +
      d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
  }
  function left(ms) {
    var t = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(t / 86400), h = Math.floor(t % 86400 / 3600),
      m = Math.floor(t % 3600 / 60), s = t % 60, p = function (n) { return String(n).padStart(2, '0'); };
    return (d ? d + 'd ' : '') + p(h) + ':' + p(m) + ':' + p(s);
  }
  function getJSON(url) {
    return fetch(url, { credentials: 'same-origin' }).then(function (r) { return r.json(); });
  }
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, j: j }; }); });
  }
  function byId(id) { return events.filter(function (e) { return e.id === id; })[0]; }

  function renderSummary() {
    var live = 0, pool = 0, counts = { cash: 0, voucher: 0, mystery: 0 };
    events.forEach(function (e) {
      var s = status(e);
      if (s === 'ongoing') live++;
      if (s !== 'past') { pool += e.prizeValue || 0; counts[e.kind]++; }
    });
    document.getElementById('liveCount').textContent = live + (live === 1 ? ' hunt live now' : ' hunts live now');
    document.getElementById('poolTotal').textContent = inr(pool);
    ['ongoing', 'upcoming', 'past'].forEach(function (k) {
      document.getElementById('c-' + k).textContent = events.filter(function (e) { return status(e) === k; }).length;
    });
    document.getElementById('lanes').innerHTML = LANES.map(function (l) {
      var n = counts[l.key];
      return '<div class="lane ' + l.cls + '"><div class="ic">' + l.ic + '</div><h3>' + l.t + '</h3><p>' + l.d +
        '</p><div class="n">' + n + (n === 1 ? ' hunt' : ' hunts') + ' open or coming</div></div>';
    }).join('');
  }

  function card(e) {
    var st = status(e), pct = Math.min(100, Math.round(e.sold / e.spots * 100));
    var pill = st === 'ongoing' ? '<span class="pill live">Live now</span>' : st === 'upcoming' ? '<span class="pill soon">Upcoming</span>' : '<span class="pill">Ended</span>';
    var timeFact = st === 'ongoing'
      ? '<div class="fact"><small>Ends in</small><b class="gold" data-end="' + Date.parse(e.end) + '">' + left(Date.parse(e.end) - Date.now()) + '</b></div>'
      : st === 'upcoming'
        ? '<div class="fact"><small>Starts</small><b>' + esc(when(e.start)) + '</b></div>'
        : '<div class="fact"><small>Ended</small><b>' + esc(when(e.end)) + '</b></div>';
    var foot = '';
    if (st !== 'past') {
      if (e.owned) {
        foot = '<span class="has">&#10003; Ticket unlocked</span><button class="btn gold" data-watch="' + esc(e.id) + '">Watch clue video</button>';
      } else if (e.request === 'pending') {
        foot = '<span class="has wait">Checking your payment</span><button class="btn ghost" data-status="' + esc(e.id) + '">See status</button>';
      } else if (e.request === 'rejected') {
        foot = '<span class="has bad">Payment not matched</span><button class="btn gold" data-buy="' + esc(e.id) + '">Try again</button>';
      } else {
        foot = '<button class="btn gold" data-buy="' + esc(e.id) + '">Get ticket · ' + (e.price ? inr(e.price) : 'Free') + '</button>' +
          '<button class="btn ghost" data-watch="' + esc(e.id) + '">Watch clue video</button>';
      }
    }
    return '<article class="ev"><div class="ev-top">' + pill + '<span class="kind">' + esc(KIND[e.kind]) + '</span></div>' +
      '<h3>' + esc(e.title) + '</h3><p class="blurb">' + esc(e.blurb) + '</p>' +
      '<div class="facts"><div class="fact"><small>Prize</small><b class="gold">' + esc(e.prize) + '</b></div>' + timeFact +
      '<div class="fact"><small>Ticket</small><b>' + (e.price ? inr(e.price) : 'Free') + '</b></div></div>' +
      (st !== 'past'
        ? '<div><div class="barlbl"><span>' + esc(e.where) + '</span><span>' + e.sold + ' of ' + e.spots + ' tickets</span></div><div class="bar"><i style="width:' + pct + '%"></i></div></div>'
        : '') +
      (st === 'past' && e.winner ? '<p class="winner">' + esc(e.winner) + '</p>' : '') +
      (foot ? '<div class="ev-foot">' + foot + '</div>' : '') + '</article>';
  }

  function renderGrid() {
    var list = events.filter(function (e) { return status(e) === tab; });
    list.sort(function (a, b) { return tab === 'past' ? Date.parse(b.end) - Date.parse(a.end) : Date.parse(a.start) - Date.parse(b.start); });
    document.getElementById('grid').innerHTML = list.length ? list.map(card).join('') : '<div class="empty">Nothing here right now. Check the other tabs.</div>';
    var tabs = document.querySelectorAll('.tabs button');
    for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute('aria-selected', tabs[i].getAttribute('data-tab') === tab ? 'true' : 'false');
  }

  function render() { renderSummary(); renderGrid(); }

  function refresh() {
    return getJSON('/api/events').then(function (list) {
      if (Array.isArray(list)) { events = list; render(); }
    }).catch(function () {});
  }

  /* modal */
  function stopPoll() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
  function openModal(html) {
    stopPoll();
    lastFocus = lastFocus || document.activeElement;
    modal.innerHTML = html;
    ov.hidden = false;
    var f = modal.querySelector('input,button');
    if (f) f.focus();
  }
  function closeModal() {
    stopPoll();
    ov.hidden = true;
    modal.innerHTML = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
    lastFocus = null;
  }
  ov.addEventListener('click', function (ev) { if (ev.target === ov) closeModal(); });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape' && !ov.hidden) closeModal(); });

  /* buying a ticket: scan, say who paid, wait for the green light */
  function buy(id, forceQr) {
    var e = byId(id);
    if (!e) return;
    if (config.gateway && e.price && !forceQr) return payOnline(id);
    var free = !e.price;
    var qr = config.qrUrl
      ? '<div class="qrbox"><img src="' + esc(config.qrUrl) + '" alt="Payment QR code"><p>Scan with any UPI app</p></div>'
      : '<p class="pay-text">' + (config.upi ? 'Pay by UPI to <span class="upi">' + esc(config.upi) + '</span>.' : 'Ask the organiser how to pay. ' + esc(config.contact)) + '</p>';
    var payStep = free ? '' :
      '<li><b>Pay ' + inr(e.price) + '</b> to <b>' + esc(config.payName) + '</b>.' + qr + '</li>';
    var nameLabel = free ? 'Your name (optional)' : 'Your name or Instagram';
    var utrField = free ? '' :
      '<label for="utr">UPI transaction ID</label>' +
      '<input class="in code" type="text" id="utr" placeholder="12-digit number" maxlength="24" inputmode="text" autocomplete="off" spellcheck="false">' +
      '<p class="hint">After paying, open the payment in your UPI app and copy the transaction ID. Some apps call it UTR or reference number.</p>';
    openModal('<button class="btn ghost small x" data-close>Close</button><h3 id="mTitle">' + esc(e.title) + '</h3>' +
      '<p class="muted">' + (free ? 'Free entry' : 'Ticket ' + inr(e.price)) + '. No sign-up needed.</p>' +
      '<ol class="steps2">' + payStep +
      '<li><b>' + (free ? 'Get your ticket' : 'Tell us who paid') + '</b>' +
      '<form id="reqForm" autocomplete="off"><label for="pname">' + nameLabel + '</label>' +
      '<input class="in" type="text" id="pname" maxlength="40" placeholder="e.g. Aarav or @aarav.k">' + utrField +
      '<p class="msg" id="msg" aria-live="polite"></p>' +
      '<button class="btn gold block" type="submit">' + (free ? 'Get my ticket' : 'I have paid') + '</button></form></li>' +
      (free ? '' : '<li>We check your payment and the clue video unlocks on this page. It usually takes a few minutes.</li>') + '</ol>' +
      '<button class="btn ghost small" data-showcode="' + esc(e.id) + '">I already have a ticket code</button>');
    document.getElementById('reqForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var m = document.getElementById('msg'), btn = ev.target.querySelector('button');
      var body = { eventId: id, name: document.getElementById('pname').value };
      if (!free) body.utr = document.getElementById('utr').value;
      btn.disabled = true;
      postJSON('/api/requests', body).then(function (res) {
        if (!res.ok) { m.className = 'msg err'; m.textContent = res.j.error || 'Something went wrong. Try again.'; btn.disabled = false; return; }
        return refresh().then(function () { if (res.j.approved) watch(id); else waiting(id); });
      }).catch(function () { m.className = 'msg err'; m.textContent = 'Could not reach the server. Try again.'; btn.disabled = false; });
    });
  }

  /* online payment: one tap to pay, then straight back here with the video unlocked */
  function payOnline(id) {
    var e = byId(id);
    if (!e) return;
    openModal('<button class="btn ghost small x" data-close>Close</button><h3 id="mTitle">' + esc(e.title) + '</h3>' +
      '<p class="muted">Ticket ' + inr(e.price) + '. No sign-up needed.</p>' +
      '<div class="pay"><b>Pay instantly</b><ol><li>Tap <b>Pay</b> and finish with UPI, card or netbanking.</li>' +
      '<li>You come straight back here and your clue video unlocks by itself.</li></ol>' +
      '<p class="small-note">The payment page is run by Razorpay. It asks for a phone number or email so it can send your payment receipt.</p></div>' +
      '<form id="payForm" autocomplete="off"><label for="pname">Your name or Instagram (optional)</label>' +
      '<input class="in" type="text" id="pname" maxlength="40" placeholder="e.g. Aarav or @aarav.k">' +
      '<p class="msg" id="msg" aria-live="polite"></p>' +
      '<button class="btn gold block" type="submit">Pay ' + inr(e.price) + ' instantly</button></form>' +
      '<button class="btn ghost small" data-showcode="' + esc(e.id) + '">I already have a ticket code</button>');
    document.getElementById('payForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var m = document.getElementById('msg'), btn = ev.target.querySelector('button');
      btn.disabled = true;
      m.className = 'msg'; m.textContent = 'Opening the payment page...';
      postJSON('/api/pay', { eventId: id, name: document.getElementById('pname').value }).then(function (res) {
        if (!res.ok || !res.j.url) { m.className = 'msg err'; m.textContent = res.j.error || 'Could not start the payment. Try again.'; btn.disabled = false; return; }
        window.location.href = res.j.url;
      }).catch(function () { m.className = 'msg err'; m.textContent = 'Could not reach the server. Try again.'; btn.disabled = false; });
    });
  }

  /* back from the payment page: confirm it, then unlock */
  function confirming(orderId) {
    openModal('<button class="btn ghost small x" data-close>Close</button><h3 id="mTitle">Confirming your payment</h3>' +
      '<div class="spin" aria-hidden="true"></div>' +
      '<p>This takes a few seconds. Your clue video opens by itself.</p>');
    var tries = 0;
    function check() {
      tries++;
      getJSON('/api/orders/' + orderId).then(function (o) {
        if (o.status === 'paid') {
          stopPoll();
          return refresh().then(function () { watch(o.eventId); });
        }
        if (o.status === 'failed' || o.error) {
          stopPoll();
          openModal('<button class="btn ghost small x" data-close>Close</button><h3 id="mTitle">Payment not completed</h3>' +
            '<p class="muted">No money was taken, or the payment link expired. You can try again from the event card.</p>');
          return;
        }
        if (tries >= 40) {
          stopPoll();
          openModal('<button class="btn ghost small x" data-close>Close</button><h3 id="mTitle">Still confirming</h3>' +
            '<p class="muted">If money left your account, your ticket appears within a few minutes. Refresh this page to check, or message us: ' + esc(config.contact) + '</p>');
        }
      }).catch(function () {});
    }
    pollTimer = setInterval(check, 3000);
    check();
  }
  function checkReturn() {
    var id = null;
    try { id = new URLSearchParams(window.location.search).get('paid'); } catch (x) { id = null; }
    if (!id || !/^[a-f0-9]{16}$/.test(id)) return;
    try { history.replaceState(null, '', window.location.pathname); } catch (x) { /* ignore */ }
    confirming(id);
  }

  function waiting(id) {
    var e = byId(id);
    if (!e) return;
    openModal('<button class="btn ghost small x" data-close>Close</button><h3 id="mTitle">Payment sent</h3>' +
      '<div class="spin" aria-hidden="true"></div>' +
      '<p>We are checking your payment for <b>' + esc(e.title) + '</b>. Keep this page open and your video unlocks by itself.</p>' +
      '<p class="small-note">You can close this and come back. Your request is saved on this device' + (e.requestId ? ' (reference ' + esc(e.requestId) + ')' : '') + '.</p>');
    pollTimer = setInterval(function () {
      refresh().then(function () {
        var n = byId(id);
        if (!n || ov.hidden) return stopPoll();
        if (n.owned) { stopPoll(); watch(id); }
        else if (n.request === 'rejected') {
          stopPoll();
          openModal('<button class="btn ghost small x" data-close>Close</button><h3 id="mTitle">Payment not matched</h3>' +
            '<p class="muted">We could not find that payment. Check the transaction ID and try again, or message us: ' + esc(config.contact) + '</p>' +
            '<button class="btn gold block" data-buy="' + esc(id) + '">Try again</button>');
        }
      });
    }, 6000);
  }

  function codeForm(id) {
    var e = byId(id);
    if (!e) return;
    openModal('<button class="btn ghost small x" data-close>Close</button><h3 id="mTitle">Ticket code</h3>' +
      '<p class="muted">Enter the code you were sent for <b>' + esc(e.title) + '</b>.</p>' +
      '<form id="codeForm" autocomplete="off"><label for="code">Ticket code</label>' +
      '<input class="in code" type="text" id="code" placeholder="LOOT-XXXX-XXXX" maxlength="16" spellcheck="false">' +
      '<p class="msg" id="msg" aria-live="polite"></p>' +
      '<button class="btn gold block" type="submit">Unlock video</button></form>');
    document.getElementById('codeForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var m = document.getElementById('msg'), btn = ev.target.querySelector('button');
      btn.disabled = true;
      postJSON('/api/redeem', { eventId: id, code: document.getElementById('code').value }).then(function (res) {
        if (!res.ok) { m.className = 'msg err'; m.textContent = res.j.error || 'Could not check that code.'; btn.disabled = false; return; }
        return refresh().then(function () { watch(id); });
      }).catch(function () { m.className = 'msg err'; m.textContent = 'Could not reach the server. Try again.'; btn.disabled = false; });
    });
  }

  function watch(id) {
    var e = byId(id);
    if (!e) return;
    if (!e.owned) {
      openModal('<button class="btn ghost small x" data-close>Close</button><h3 id="mTitle">Clue video is locked</h3>' +
        '<p class="muted">Only ticket holders for <b>' + esc(e.title) + '</b> can watch the video that shows where the treasure is hidden.</p>' +
        '<button class="btn gold block" data-buy="' + esc(e.id) + '">Get ticket · ' + (e.price ? inr(e.price) : 'Free') + '</button>');
      return;
    }
    var body = e.hasVideo
      ? '<div class="player"><video controls playsinline preload="metadata" controlsList="nodownload" disablepictureinpicture src="/api/events/' + encodeURIComponent(e.id) + '/video"></video></div>'
      : '<div class="player"><div class="ph"><b>The video is not up yet</b>The organiser has not uploaded it. Check back soon.</div></div>';
    openModal('<button class="btn ghost small x" data-close>Close</button><h3 id="mTitle">' + esc(e.title) + '</h3>' + body +
      (e.code ? '<div class="pay"><b>Your ticket code: <span class="upi">' + esc(e.code) + '</span></b>' +
        '<p class="small-note">Save it. To watch on another phone, tap "I already have a ticket code" on this hunt and enter it. Show it to the organiser to claim the prize.</p></div>' : '') +
      '<p class="small-note">Please do not share this video or your code.</p>');
  }

  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-buy],[data-buyqr],[data-watch],[data-close],[data-tab],[data-status],[data-showcode]');
    if (!t) return;
    if (t.hasAttribute('data-close')) return closeModal();
    if (t.hasAttribute('data-tab')) { tab = t.getAttribute('data-tab'); return renderGrid(); }
    if (!lastFocus) lastFocus = t;
    if (t.hasAttribute('data-buy')) return buy(t.getAttribute('data-buy'));
    if (t.hasAttribute('data-buyqr')) return buy(t.getAttribute('data-buyqr'), true);
    if (t.hasAttribute('data-watch')) return watch(t.getAttribute('data-watch'));
    if (t.hasAttribute('data-status')) return waiting(t.getAttribute('data-status'));
    if (t.hasAttribute('data-showcode')) return codeForm(t.getAttribute('data-showcode'));
  });

  setInterval(function () {
    var els = document.querySelectorAll('[data-end]');
    for (var i = 0; i < els.length; i++) els[i].textContent = left(Number(els[i].getAttribute('data-end')) - Date.now());
  }, 1000);
  setInterval(function () { if (ov.hidden) refresh(); }, 30000);

  getJSON('/api/config').then(function (c) {
    config = c;
    document.getElementById('contact').textContent = 'Questions about tickets: ' + c.contact;
  }).catch(function () {});
  refresh().then(checkReturn);
})();
