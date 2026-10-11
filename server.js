require('dotenv').config();
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const UPI_ID = process.env.UPI_ID || '';
const CONTACT = process.env.CONTACT || 'Message the organiser if you need help.';
const MAX_VIDEO_MB = Number(process.env.MAX_VIDEO_MB) || 300;
const MAX_DEVICES = Number(process.env.MAX_DEVICES) || 2;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const VIDEO_DIR = path.join(DATA_DIR, 'videos');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const HOUR = 3600 * 1000;

fs.mkdirSync(VIDEO_DIR, { recursive: true });

/* ---------- tiny JSON database ---------- */
let db = { events: [], tickets: [], requests: [], settings: { payName: 'Campus Loot', qrFile: '' } };
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
if (fs.existsSync(DB_FILE)) {
  const loaded = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  db = {
    events: loaded.events || [],
    tickets: loaded.tickets || [],
    requests: loaded.requests || [],
    settings: Object.assign({ payName: 'Campus Loot', qrFile: '' }, loaded.settings || {})
  };
} else {
  const now = Date.now();
  const iso = (h) => new Date(now + h * HOUR).toISOString();
  db.events = [
    { id: 'sample-lockbox', title: 'Library Lockbox Hunt', kind: 'cash', prize: '₹5,000 cash', prizeValue: 5000, price: 50, start: iso(-20), end: iso(50), spots: 120, where: 'Central library and nearby lawns', blurb: 'A sealed envelope is hidden somewhere students walk past every day. The video shows exactly where.', winner: '', videoFile: '' },
    { id: 'sample-canteen', title: 'Canteen Coupon Chase', kind: 'voucher', prize: '₹2,000 in food vouchers', prizeValue: 2000, price: 30, start: iso(150), end: iso(174), spots: 80, where: 'Canteen block and food court', blurb: 'Food vouchers hidden among the tables. Watch the clue, then run.', winner: '', videoFile: '' }
  ];
  save();
}

/* ---------- helpers ---------- */
function bad(message, status) { const e = new Error(message); e.status = status || 400; return e; }
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i < 0) return;
    try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch (e) { /* ignore bad cookie */ }
  });
  return out;
}
function safeEqual(a, b) {
  const A = crypto.createHash('sha256').update(a).digest();
  const B = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(A, B);
}
const hits = new Map();
function allow(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now); hits.set(key, arr); return true;
}
setInterval(() => hits.clear(), 30 * 60 * 1000).unref();

const sessions = new Map();
function isAdmin(req) {
  const exp = sessions.get(req.cookies.admin);
  return !!exp && exp > Date.now();
}
function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Please log in.' });
  next();
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function makeCode() {
  const pick = (n) => Array.from(crypto.randomBytes(n), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
  return 'LOOT-' + pick(4) + '-' + pick(4);
}
function newTicket(eventId, note, did) {
  let code;
  do { code = makeCode(); } while (db.tickets.some((t) => t.code === code));
  const now = new Date().toISOString();
  const t = { code, eventId, note: String(note || '').slice(0, 80), createdAt: now, redeemedAt: did ? now : null, devices: did ? [did] : [] };
  db.tickets.push(t);
  return t;
}
function findEvent(id) { return db.events.find((e) => e.id === id); }
/* A device owns a ticket when its device id is listed on a ticket for that event. */
function ticketFor(req, e) {
  return db.tickets.find((t) => t.eventId === e.id && t.devices.includes(req.did)) || null;
}
function requestFor(req, e) {
  const list = db.requests.filter((r) => r.eventId === e.id && r.did === req.did);
  return list.length ? list[list.length - 1] : null;
}
function soldCount(id) { return db.tickets.filter((t) => t.eventId === id).length; }

function clean(body) {
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const start = new Date(body.start), end = new Date(body.end);
  if (isNaN(start) || isNaN(end) || end <= start) throw bad('Check the start and end times. The end must be after the start.');
  const title = str(body.title, 80);
  if (!title) throw bad('Give the event a title.');
  return {
    title,
    kind: ['cash', 'voucher', 'mystery'].includes(body.kind) ? body.kind : 'cash',
    prize: str(body.prize, 80),
    prizeValue: Math.max(0, Math.round(Number(body.prizeValue) || 0)),
    price: Math.max(0, Math.round(Number(body.price) || 0)),
    start: start.toISOString(),
    end: end.toISOString(),
    spots: Math.max(1, Math.round(Number(body.spots) || 50)),
    where: str(body.where, 80),
    blurb: str(body.blurb, 300),
    winner: str(body.winner, 120)
  };
}
function removeFile(name) {
  if (!name) return;
  fs.promises.unlink(path.join(name.startsWith('qr-') ? DATA_DIR : VIDEO_DIR, path.basename(name))).catch(() => {});
}

/* ---------- app ---------- */
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; media-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
  });
  next();
});
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  req.cookies = parseCookies(req);
  let did = req.cookies.did;
  if (!/^[a-f0-9]{32}$/.test(did || '')) {
    did = crypto.randomBytes(16).toString('hex');
    res.cookie('did', did, { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: 365 * 24 * HOUR });
  }
  req.did = did;
  next();
});

/* ----- public API ----- */
app.get('/api/config', (req, res) => {
  res.json({
    payName: db.settings.payName,
    qrUrl: db.settings.qrFile ? '/api/payment-qr?v=' + encodeURIComponent(db.settings.qrFile) : '',
    upi: UPI_ID,
    contact: CONTACT
  });
});

app.get('/api/payment-qr', (req, res) => {
  if (!db.settings.qrFile) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=3600');
  res.sendFile(path.join(DATA_DIR, path.basename(db.settings.qrFile)));
});

app.get('/api/events', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(db.events.map((e) => {
    const r = requestFor(req, e);
    return {
      id: e.id, title: e.title, kind: e.kind, prize: e.prize, prizeValue: e.prizeValue, price: e.price,
      start: e.start, end: e.end, spots: e.spots, sold: soldCount(e.id), where: e.where, blurb: e.blurb,
      winner: e.winner, hasVideo: !!e.videoFile, owned: !!ticketFor(req, e),
      request: r ? r.status : null, requestId: r ? r.id : null
    };
  }));
});

/* A student says "I paid". Free events are approved on the spot. */
app.post('/api/requests', (req, res) => {
  if (!allow('req:' + req.ip, 10, 60 * 60 * 1000)) throw bad('Too many requests. Try again in a while.', 429);
  const b = req.body || {};
  const e = findEvent(String(b.eventId || ''));
  if (!e) throw bad('Event not found.', 404);
  if (Date.now() > Date.parse(e.end)) throw bad('This hunt has ended.');
  if (ticketFor(req, e)) throw bad('You already have a ticket for this hunt.');
  const name = String(b.name || '').trim().slice(0, 40);

  if (e.price === 0) {
    newTicket(e.id, name || 'Free entry', req.did);
    save();
    return res.json({ approved: true });
  }

  const utr = String(b.utr || '').replace(/\s+/g, '').toUpperCase();
  if (name.length < 2) throw bad('Enter your name or Instagram so we can find your payment.');
  if (!/^[A-Z0-9]{10,24}$/.test(utr)) throw bad('That transaction ID does not look right. In most UPI apps it is 12 digits.');
  const mine = requestFor(req, e);
  if (mine && mine.status === 'pending') throw bad('Your payment is already being checked.');
  if (db.requests.some((r) => r.utr === utr && r.status !== 'rejected')) throw bad('That transaction ID was already used.');

  const r = {
    id: crypto.randomBytes(3).toString('hex').toUpperCase(),
    eventId: e.id, name, utr, did: req.did, status: 'pending', createdAt: new Date().toISOString(), code: ''
  };
  db.requests.push(r);
  save();
  res.json({ id: r.id });
});

/* Fallback for people who were sent a ticket code directly. */
app.post('/api/redeem', (req, res) => {
  if (!allow('redeem:' + req.ip, 10, 10 * 60 * 1000)) throw bad('Too many tries. Wait a few minutes and try again.', 429);
  const eventId = String((req.body || {}).eventId || '');
  const code = String((req.body || {}).code || '').trim().toUpperCase();
  const e = findEvent(eventId);
  const t = e && db.tickets.find((t) => t.eventId === e.id && t.code === code);
  if (!e || !t) throw bad('That code does not match this event. Check it with the organiser.');
  if (Date.now() > Date.parse(e.end)) throw bad('This hunt has ended.');
  if (!t.devices.includes(req.did)) {
    if (t.devices.length >= MAX_DEVICES) throw bad('This ticket is already in use on ' + MAX_DEVICES + ' devices.');
    t.devices.push(req.did);
    if (!t.redeemedAt) t.redeemedAt = new Date().toISOString();
    save();
  }
  res.json({ ok: true });
});

app.get('/api/events/:id/video', (req, res) => {
  const e = findEvent(req.params.id);
  if (!e || !e.videoFile) return res.status(404).json({ error: 'No video yet.' });
  if (!ticketFor(req, e)) return res.status(403).json({ error: 'Ticket required.' });
  if (Date.now() > Date.parse(e.end)) return res.status(403).json({ error: 'This hunt has ended.' });
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(path.join(VIDEO_DIR, path.basename(e.videoFile)));
});

/* ----- admin API ----- */
app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) throw bad('Admin is switched off. Set ADMIN_PASSWORD in .env and restart the server.', 503);
  if (!allow('login:' + req.ip, 8, 15 * 60 * 1000)) throw bad('Too many attempts. Wait 15 minutes.', 429);
  if (!safeEqual(String((req.body || {}).password || ''), ADMIN_PASSWORD)) throw bad('Wrong password.', 401);
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, Date.now() + 12 * HOUR);
  res.cookie('admin', token, { httpOnly: true, sameSite: 'strict', secure: req.secure, maxAge: 12 * HOUR });
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  sessions.delete(req.cookies.admin);
  res.clearCookie('admin');
  res.json({ ok: true });
});
app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(req) }));

app.get('/api/admin/events', requireAdmin, (req, res) => {
  res.json(db.events.map((e) => ({ ...e, hasVideo: !!e.videoFile, videoFile: undefined, sold: soldCount(e.id) })));
});
app.post('/api/admin/events', requireAdmin, (req, res) => {
  const data = clean(req.body || {});
  const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'event';
  const e = { id: slug + '-' + crypto.randomBytes(2).toString('hex'), ...data, videoFile: '' };
  db.events.push(e);
  save();
  res.json({ id: e.id });
});
app.put('/api/admin/events/:id', requireAdmin, (req, res) => {
  const e = findEvent(req.params.id);
  if (!e) throw bad('Event not found.', 404);
  Object.assign(e, clean(req.body || {}));
  save();
  res.json({ ok: true });
});
app.delete('/api/admin/events/:id', requireAdmin, (req, res) => {
  const e = findEvent(req.params.id);
  if (!e) throw bad('Event not found.', 404);
  removeFile(e.videoFile);
  db.events = db.events.filter((x) => x.id !== e.id);
  db.tickets = db.tickets.filter((t) => t.eventId !== e.id);
  db.requests = db.requests.filter((r) => r.eventId !== e.id);
  save();
  res.json({ ok: true });
});

const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.m4v'];
const upload = multer({
  storage: multer.diskStorage({
    destination: VIDEO_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /^video\//.test(file.mimetype) && VIDEO_EXT.includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : bad('Upload an .mp4, .webm, .mov or .m4v video.'), ok);
  }
});
app.post('/api/admin/events/:id/video', requireAdmin, (req, res, next) => {
  if (!findEvent(req.params.id)) return next(bad('Event not found.', 404));
  next();
}, upload.single('video'), (req, res) => {
  const e = findEvent(req.params.id);
  if (!req.file) throw bad('No video received.');
  removeFile(e.videoFile);
  e.videoFile = req.file.filename;
  save();
  res.json({ ok: true });
});
app.delete('/api/admin/events/:id/video', requireAdmin, (req, res) => {
  const e = findEvent(req.params.id);
  if (!e) throw bad('Event not found.', 404);
  removeFile(e.videoFile);
  e.videoFile = '';
  save();
  res.json({ ok: true });
});

app.get('/api/admin/events/:id/tickets', requireAdmin, (req, res) => {
  res.json(db.tickets.filter((t) => t.eventId === req.params.id).map((t) => ({
    code: t.code, note: t.note, createdAt: t.createdAt, redeemedAt: t.redeemedAt || null, devices: t.devices.length
  })));
});
app.post('/api/admin/events/:id/tickets', requireAdmin, (req, res) => {
  const e = findEvent(req.params.id);
  if (!e) throw bad('Event not found.', 404);
  const count = Math.min(200, Math.max(1, Math.round(Number((req.body || {}).count) || 1)));
  const note = String((req.body || {}).note || '').trim().slice(0, 80);
  const made = [];
  for (let i = 0; i < count; i++) made.push(newTicket(e.id, note, null).code);
  save();
  res.json({ codes: made });
});
app.delete('/api/admin/tickets/:code', requireAdmin, (req, res) => {
  db.tickets = db.tickets.filter((t) => t.code !== req.params.code);
  save();
  res.json({ ok: true });
});

/* payment requests */
app.get('/api/admin/requests', requireAdmin, (req, res) => {
  res.json(db.requests.slice().reverse().map((r) => {
    const e = findEvent(r.eventId);
    return { id: r.id, event: e ? e.title : '(deleted event)', price: e ? e.price : 0, name: r.name, utr: r.utr, status: r.status, createdAt: r.createdAt, code: r.code };
  }));
});
app.post('/api/admin/requests/:id/approve', requireAdmin, (req, res) => {
  const r = db.requests.find((x) => x.id === req.params.id);
  if (!r) throw bad('Request not found.', 404);
  if (r.status === 'approved') return res.json({ ok: true, code: r.code });
  const e = findEvent(r.eventId);
  if (!e) throw bad('That event no longer exists.');
  const t = newTicket(e.id, r.name + ' · ' + r.utr, r.did);
  r.status = 'approved';
  r.code = t.code;
  save();
  res.json({ ok: true, code: t.code });
});
app.post('/api/admin/requests/:id/reject', requireAdmin, (req, res) => {
  const r = db.requests.find((x) => x.id === req.params.id);
  if (!r) throw bad('Request not found.', 404);
  if (r.status === 'approved') throw bad('Already approved. Delete its ticket code on the event to remove access.');
  r.status = 'rejected';
  save();
  res.json({ ok: true });
});

/* payment QR + settings */
const IMG_EXT = ['.png', '.jpg', '.jpeg', '.webp'];
const uploadQr = multer({
  storage: multer.diskStorage({
    destination: DATA_DIR,
    filename: (req, file, cb) => cb(null, 'qr-' + crypto.randomBytes(6).toString('hex') + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 3 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(png|jpeg|webp)$/.test(file.mimetype) && IMG_EXT.includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : bad('Upload a .png, .jpg or .webp image of your QR code.'), ok);
  }
});
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  res.json({ payName: db.settings.payName, qrUrl: db.settings.qrFile ? '/api/payment-qr?v=' + encodeURIComponent(db.settings.qrFile) : '' });
});
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  db.settings.payName = String((req.body || {}).payName || '').trim().slice(0, 40) || 'Campus Loot';
  save();
  res.json({ ok: true });
});
app.post('/api/admin/qr', requireAdmin, uploadQr.single('qr'), (req, res) => {
  if (!req.file) throw bad('No image received.');
  removeFile(db.settings.qrFile);
  db.settings.qrFile = req.file.filename;
  save();
  res.json({ ok: true });
});
app.delete('/api/admin/qr', requireAdmin, (req, res) => {
  removeFile(db.settings.qrFile);
  db.settings.qrFile = '';
  save();
  res.json({ ok: true });
});

/* ----- pages ----- */
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
  let message = err.message;
  if (err.code === 'LIMIT_FILE_SIZE') message = 'That file is too large.';
  if (status >= 500) { console.error(err); message = 'Something went wrong on the server.'; }
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log('Campus Loot is running at http://localhost:' + PORT);
  console.log('Admin page: http://localhost:' + PORT + '/admin' + (ADMIN_PASSWORD ? '' : '   (disabled: set ADMIN_PASSWORD in .env)'));
});
