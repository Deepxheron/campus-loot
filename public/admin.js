(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var events = [], editingId = null, openTickets = {};

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function api(url, opts) {
    opts = opts || {};
    opts.credentials = 'same-origin';
    if (opts.body && typeof opts.body !== 'string') { opts.body = JSON.stringify(opts.body); opts.headers = { 'Content-Type': 'application/json' }; }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var err = new Error(j.error || 'Request failed'); err.status = r.status; throw err; }
        return j;
      });
    });
  }
  function toLocalInput(iso) {
    var d = new Date(iso), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function status(e) {
    var n = Date.now();
    return n < Date.parse(e.start) ? 'Upcoming' : n < Date.parse(e.end) ? 'Live' : 'Ended';
  }
  function show(loggedIn) {
    $('login').hidden = loggedIn;
    $('app').hidden = !loggedIn;
    $('logout').hidden = !loggedIn;
  }

  /* login */
  $('loginForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    api('/api/admin/login', { method: 'POST', body: { password: $('pw').value } })
      .then(function () { $('pw').value = ''; show(true); load(); })
      .catch(function (e) { $('loginMsg').className = 'msg err'; $('loginMsg').textContent = e.message; });
  });
  $('logout').addEventListener('click', function () {
    api('/api/admin/logout', { method: 'POST' }).then(function () { show(false); });
  });

  /* list */
  function load() {
    loadRequests();
    loadSettings();
    return api('/api/admin/events').then(function (list) { events = list; render(); })
      .catch(function (e) { if (e.status === 401) show(false); });
  }

  /* payment requests */
  function fmtTime(iso) {
    return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  }
  function loadRequests() {
    return api('/api/admin/requests').then(function (list) {
      var pending = list.filter(function (r) { return r.status === 'pending'; });
      var done = list.filter(function (r) { return r.status !== 'pending'; }).slice(0, 8);
      $('reqCount').hidden = !pending.length;
      $('reqCount').textContent = pending.length + ' waiting';
      document.title = (pending.length ? '(' + pending.length + ') ' : '') + 'Campus Loot Admin';
      var row = function (r, acts) {
        return '<div class="trow" data-rid="' + esc(r.id) + '"><div style="flex:1;min-width:200px"><b>' + esc(r.name) + '</b> · ' + esc(r.event) + ' · ₹' + r.price +
          '<div class="small-note">Transaction ID <code>' + esc(r.utr) + '</code> · ' + esc(fmtTime(r.createdAt)) + '</div></div>' + acts + '</div>';
      };
      $('reqList').innerHTML =
        (pending.length ? pending.map(function (r) {
          return row(r, '<button class="btn ghost small" data-req="copy" data-utr="' + esc(r.utr) + '">Copy ID</button>' +
            '<button class="btn gold small" data-req="approve">Approve</button><button class="btn danger small" data-req="reject">Reject</button>');
        }).join('') : '<div class="empty">No payments waiting.</div>') +
        (done.length ? '<p class="small-note" style="margin-top:8px">Recently handled</p>' + done.map(function (r) {
          return row(r, '<span class="st ' + (r.status === 'approved' ? 'used' : '') + '" style="flex:none">' + (r.status === 'approved' ? 'Approved' : 'Rejected') + '</span>');
        }).join('') : '');
    }).catch(function (e) { if (e.status === 401) show(false); });
  }
  function reqSay(text, cls) { $('reqMsg').textContent = text; $('reqMsg').className = 'msg ' + (cls || ''); }
  $('reqRefresh').addEventListener('click', loadRequests);
  $('reqList').addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-req]');
    if (!t) return;
    var act = t.getAttribute('data-req'), rid = t.closest('[data-rid]') && t.closest('[data-rid]').getAttribute('data-rid');
    if (act === 'copy') {
      (navigator.clipboard ? navigator.clipboard.writeText(t.getAttribute('data-utr')) : Promise.reject()).then(
        function () { reqSay('Copied.', 'good'); }, function () { reqSay('Could not copy. Select the ID and copy it by hand.', 'err'); });
      return;
    }
    if (act === 'reject' && !confirm('Reject this payment?')) return;
    api('/api/admin/requests/' + encodeURIComponent(rid) + '/' + act, { method: 'POST' })
      .then(function () { reqSay(act === 'approve' ? 'Approved. Their video is unlocked.' : 'Rejected.', 'good'); load(); })
      .catch(function (e) { reqSay(e.message, 'err'); });
  });
  setInterval(function () { if (!$('app').hidden) loadRequests(); }, 20000);

  /* payment QR settings */
  function paySay(text, cls) { $('payMsg').textContent = text; $('payMsg').className = 'msg ' + (cls || ''); }
  function loadSettings() {
    return api('/api/admin/settings').then(function (s) {
      $('payName').value = s.payName;
      $('qrPreview').innerHTML = s.qrUrl ? '<img src="' + esc(s.qrUrl) + '" alt="Your payment QR">' : '<p class="small-note">No QR uploaded yet.</p>';
      $('rmQr').hidden = !s.qrUrl;
    }).catch(function () {});
  }
  $('saveName').addEventListener('click', function () {
    api('/api/admin/settings', { method: 'PUT', body: { payName: $('payName').value } })
      .then(function () { paySay('Saved.', 'good'); }).catch(function (e) { paySay(e.message, 'err'); });
  });
  $('qrFile').addEventListener('change', function (ev) {
    var f = ev.target.files[0];
    if (!f) return;
    var fd = new FormData(); fd.append('qr', f);
    fetch('/api/admin/qr', { method: 'POST', body: fd, credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'Upload failed'); }); })
      .then(function () { paySay('QR uploaded.', 'good'); loadSettings(); })
      .catch(function (e) { paySay(e.message, 'err'); });
    ev.target.value = '';
  });
  $('rmQr').addEventListener('click', function () {
    if (!confirm('Remove the QR from the site?')) return;
    api('/api/admin/qr', { method: 'DELETE' }).then(function () { paySay('QR removed.', 'good'); loadSettings(); })
      .catch(function (e) { paySay(e.message, 'err'); });
  });
  function render() {
    $('list').innerHTML = events.length ? events.map(function (e) {
      return '<article class="adm-ev" data-id="' + esc(e.id) + '">' +
        '<div class="row" style="justify-content:space-between"><h3>' + esc(e.title) + '</h3><span class="pill ' + (status(e) === 'Live' ? 'live' : status(e) === 'Upcoming' ? 'soon' : '') + '">' + status(e) + '</span></div>' +
        '<div class="meta"><span>' + esc(new Date(e.start).toLocaleString('en-IN')) + ' to ' + esc(new Date(e.end).toLocaleString('en-IN')) + '</span><span>' + e.sold + ' of ' + e.spots + ' tickets</span><span>Video: ' + (e.hasVideo ? 'uploaded' : 'none') + '</span></div>' +
        '<div class="row"><button class="btn ghost small" data-act="edit">Edit</button>' +
        '<button class="btn ghost small" data-act="tickets">Tickets</button>' +
        '<label class="btn ghost small" style="margin:0;cursor:pointer">' + (e.hasVideo ? 'Replace video' : 'Upload video') + '<input type="file" accept="video/mp4,video/webm,video/quicktime,video/x-m4v" data-act="video" hidden></label>' +
        (e.hasVideo ? '<button class="btn ghost small" data-act="rmvideo">Remove video</button>' : '') +
        '<button class="btn danger small" data-act="delete">Delete</button></div>' +
        '<div class="prog" hidden><i></i></div><p class="msg" data-role="msg" aria-live="polite"></p>' +
        '<div class="tickets" data-role="tickets" ' + (openTickets[e.id] ? '' : 'hidden') + '></div></article>';
    }).join('') : '<div class="empty">No events yet. Click New event.</div>';
    Object.keys(openTickets).forEach(function (id) { if (openTickets[id]) renderTickets(id); });
  }
  function cardOf(id) { return document.querySelector('.adm-ev[data-id="' + id + '"]'); }
  function say(id, text, cls) {
    var c = cardOf(id); if (!c) return;
    var m = c.querySelector('[data-role="msg"]'); m.textContent = text; m.className = 'msg ' + (cls || '');
  }

  /* form */
  function openForm(e) {
    editingId = e ? e.id : null;
    $('formTitle').textContent = e ? 'Edit event' : 'New event';
    var now = new Date(), later = new Date(Date.now() + 48 * 3600 * 1000);
    $('f-title').value = e ? e.title : '';
    $('f-kind').value = e ? e.kind : 'cash';
    $('f-prize').value = e ? e.prize : '';
    $('f-prizeValue').value = e ? e.prizeValue : 0;
    $('f-price').value = e ? e.price : 50;
    $('f-start').value = toLocalInput(e ? e.start : now);
    $('f-end').value = toLocalInput(e ? e.end : later);
    $('f-spots').value = e ? e.spots : 100;
    $('f-where').value = e ? e.where : '';
    $('f-blurb').value = e ? e.blurb : '';
    $('f-winner').value = e ? e.winner : '';
    $('formMsg').textContent = '';
    $('evForm').hidden = false;
    $('f-title').focus();
    $('evForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('newBtn').addEventListener('click', function () { openForm(null); });
  $('cancelBtn').addEventListener('click', function () { $('evForm').hidden = true; });
  $('evForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var body = {
      title: $('f-title').value, kind: $('f-kind').value, prize: $('f-prize').value, prizeValue: $('f-prizeValue').value,
      price: $('f-price').value, start: new Date($('f-start').value).toISOString(), end: new Date($('f-end').value).toISOString(),
      spots: $('f-spots').value, where: $('f-where').value, blurb: $('f-blurb').value, winner: $('f-winner').value
    };
    var req = editingId ? api('/api/admin/events/' + encodeURIComponent(editingId), { method: 'PUT', body: body }) : api('/api/admin/events', { method: 'POST', body: body });
    req.then(function () { $('evForm').hidden = true; return load(); })
      .catch(function (e) { $('formMsg').className = 'msg err'; $('formMsg').textContent = e.message; });
  });

  /* tickets */
  function renderTickets(id) {
    var box = cardOf(id).querySelector('[data-role="tickets"]');
    api('/api/admin/events/' + encodeURIComponent(id) + '/tickets').then(function (list) {
      var unused = list.filter(function (t) { return !t.devices; }).map(function (t) { return t.code; });
      box.innerHTML = '<div class="row"><input class="in" style="width:90px" type="number" min="1" max="200" value="1" data-role="count" aria-label="How many codes">' +
        '<input class="in" style="flex:1;min-width:140px" maxlength="80" placeholder="Note, e.g. buyer name" data-role="note" aria-label="Note for these codes">' +
        '<button class="btn gold small" data-act="gen">Create codes</button></div>' +
        '<div class="row"><span class="small-note">' + list.length + ' codes, ' + unused.length + ' unused</span>' +
        (unused.length ? '<button class="btn ghost small" data-act="copyunused" data-codes="' + esc(unused.join('\n')) + '">Copy unused codes</button>' : '') + '</div>' +
        '<div class="tlist">' + list.map(function (t) {
          return '<div class="trow"><code>' + esc(t.code) + '</code><span class="st ' + (t.devices ? 'used' : '') + '">' +
            (t.devices ? 'Used on ' + t.devices + (t.devices === 1 ? ' device' : ' devices') : 'Unused') + (t.note ? ' · ' + esc(t.note) : '') + '</span>' +
            '<button class="btn ghost small" data-act="copy" data-code="' + esc(t.code) + '">Copy</button>' +
            '<button class="btn danger small" data-act="deltick" data-code="' + esc(t.code) + '">Delete</button></div>';
        }).join('') + '</div>';
    }).catch(function (e) { say(id, e.message, 'err'); });
  }
  function copy(text, id) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(
      function () { say(id, 'Copied.', 'good'); },
      function () { say(id, 'Could not copy. Select the text and copy it by hand.', 'err'); });
  }

  /* upload with progress */
  function upload(id, file) {
    var c = cardOf(id), prog = c.querySelector('.prog'), bar = prog.querySelector('i');
    var fd = new FormData(); fd.append('video', file);
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/events/' + encodeURIComponent(id) + '/video');
    prog.hidden = false; bar.style.width = '0%'; say(id, 'Uploading...', '');
    xhr.upload.onprogress = function (e) { if (e.lengthComputable) bar.style.width = Math.round(e.loaded / e.total * 100) + '%'; };
    xhr.onload = function () {
      var j = {}; try { j = JSON.parse(xhr.responseText); } catch (x) { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) { load().then(function () { say(id, 'Video uploaded.', 'good'); }); }
      else { prog.hidden = true; say(id, j.error || 'Upload failed.', 'err'); }
    };
    xhr.onerror = function () { prog.hidden = true; say(id, 'Upload failed. Check your connection.', 'err'); };
    xhr.send(fd);
  }

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.getAttribute && t.getAttribute('data-act') === 'video' && t.files[0]) {
      upload(t.closest('.adm-ev').getAttribute('data-id'), t.files[0]);
    }
  });
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-act]');
    if (!t || t.tagName === 'INPUT') return;
    var card = t.closest('.adm-ev'), id = card && card.getAttribute('data-id'), act = t.getAttribute('data-act');
    var e = events.filter(function (x) { return x.id === id; })[0];
    if (act === 'edit') return openForm(e);
    if (act === 'tickets') {
      openTickets[id] = !openTickets[id];
      card.querySelector('[data-role="tickets"]').hidden = !openTickets[id];
      if (openTickets[id]) renderTickets(id);
      return;
    }
    if (act === 'gen') {
      var box = card.querySelector('[data-role="tickets"]');
      return api('/api/admin/events/' + encodeURIComponent(id) + '/tickets', { method: 'POST', body: { count: box.querySelector('[data-role="count"]').value, note: box.querySelector('[data-role="note"]').value } })
        .then(function (r) { return load().then(function () { say(id, r.codes.length + ' code(s) created.', 'good'); }); })
        .catch(function (e2) { say(id, e2.message, 'err'); });
    }
    if (act === 'copy') return copy(t.getAttribute('data-code'), id);
    if (act === 'copyunused') return copy(t.getAttribute('data-codes'), id);
    if (act === 'deltick') {
      if (!confirm('Delete this ticket code? Anyone holding it loses access.')) return;
      return api('/api/admin/tickets/' + encodeURIComponent(t.getAttribute('data-code')), { method: 'DELETE' }).then(load);
    }
    if (act === 'rmvideo') {
      if (!confirm('Remove the clue video?')) return;
      return api('/api/admin/events/' + encodeURIComponent(id) + '/video', { method: 'DELETE' }).then(load);
    }
    if (act === 'delete') {
      if (!confirm('Delete "' + e.title + '", its tickets and its video? This cannot be undone.')) return;
      return api('/api/admin/events/' + encodeURIComponent(id), { method: 'DELETE' }).then(load);
    }
  });

  api('/api/admin/me').then(function (r) { show(r.admin); if (r.admin) load(); }).catch(function () { show(false); });
})();
