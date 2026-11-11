'use strict';
/* Сервер журнала репетитора: аккаунты (учитель, ученик, родитель), курсы, синхронизация журнала, совместная доска.
   Запуск: ADMIN_TOKEN=... node server.js  (см. README.md в этой папке) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { createJournal } = require('./journal');
const { createAuth } = require('./auth');

const KINDS = new Set(['pen', 'line', 'rect', 'ellipse', 'note', 'text']);
const BGS = new Set(['dots', 'grid', 'plain', 'axes']);
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const ROOM_RE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_ROOMS = 2000, MAX_ELS = 5000, MAX_CLIENTS = 20, MAX_EL_BYTES = 300000, MAX_SET = 300, MAX_DEL = 2000;
const STATIC = { '/board.js': 'board.js', '/live.js': 'live.js', '/student.js': 'student.js', '/viewer.js': 'viewer.js' };
const CODE_RE = /^[A-HJ-NP-Z2-9]{8,12}$/;
const VK_RE = /^[A-Za-z0-9_-]{20,64}$/;
const SID_RE = /^(?!__proto__$)[A-Za-z0-9_-]{1,40}$/;
const TID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');

const safeEq = (a, b) => {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
};
const token = (n) => crypto.randomBytes(n).toString('base64url');

function start(opts) {
  opts = opts || {};
  const ADMIN = opts.adminToken || '';
  if (ADMIN.length < 16) throw new Error('ADMIN_TOKEN должен быть не короче 16 символов');
  const DATA = opts.dataDir || path.join(__dirname, 'data');
  const ROOMS_DIR = path.join(DATA, 'rooms');
  const PUBLIC = opts.publicDir || path.join(__dirname, 'public');
  fs.mkdirSync(ROOMS_DIR, { recursive: true });
  const auth = createAuth(DATA, { teacherInvite: opts.teacherInvite || '' });
  const TEACHERS_DIR = path.join(DATA, 'teachers');
  const journals = new Map();
  const getJournal = (tid) => {
    if (!TID_RE.test(tid)) return null;
    let j = journals.get(tid);
    if (!j) { j = createJournal(path.join(TEACHERS_DIR, tid)); journals.set(tid, j); }
    return j;
  };
  /* индексы: код курса -> (учитель, ученик, роль); ключ-ссылка -> учитель */
  const codeIdx = new Map(), vkIdx = new Map(), owned = new Map();
  function reindex(tid) {
    const old = owned.get(tid);
    if (old) old.forEach((k) => { if (k[0] === 'c') codeIdx.delete(k.slice(2)); else vkIdx.delete(k.slice(2)); });
    const keys = new Set();
    getJournal(tid).students().forEach((r) => {
      [['sc', 'student'], ['pc', 'parent']].forEach((f) => {
        const code = r[f[0]];
        if (typeof code === 'string' && CODE_RE.test(code) && !codeIdx.has(code)) { codeIdx.set(code, { t: tid, s: r.id, as: f[1] }); keys.add('c:' + code); }
      });
      if (typeof r.vk === 'string' && VK_RE.test(r.vk) && !vkIdx.has(r.vk)) { vkIdx.set(r.vk, tid); keys.add('v:' + r.vk); }
    });
    owned.set(tid, keys);
  }
  try { fs.readdirSync(TEACHERS_DIR).forEach((tid) => { if (TID_RE.test(tid)) reindex(tid); }); } catch (e) { /* ещё нет учителей */ }
  const makeLimiter = (windowMs) => {
    const m = new Map();
    const get = (ip) => {
      const now = Date.now();
      let h = m.get(ip);
      if (!h || now - h.t > windowMs) { h = { t: now, n: 0 }; m.set(ip, h); }
      if (m.size > 5000) m.forEach((v, k) => { if (now - v.t > windowMs) m.delete(k); });
      return h;
    };
    return { hit: (ip) => ++get(ip).n, count: (ip) => get(ip).n };
  };
  const reqLimit = makeLimiter(60000), failLimit = makeLimiter(60000);
  const regLimit = makeLimiter(3600000), loginIp = makeLimiter(600000), loginKey = makeLimiter(600000), joinFail = makeLimiter(600000);
  const clientIp = (req) => (opts.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || '';

  const rooms = new Map();
  const roomFile = (id) => path.join(ROOMS_DIR, id + '.json');

  function makeRoom(j) {
    const els = new Map();
    (Array.isArray(j.els) ? j.els : []).forEach((e) => { if (okEl(e)) els.set(e.id, e); });
    return {
      id: j.id, owner: typeof j.owner === 'string' ? j.owner : '', tk: j.tk, sk: j.sk, write: j.write !== false, bg: BGS.has(j.bg) ? j.bg : 'dots',
      els: els, clients: new Set(), seq: 0, dirty: false, timer: null, evict: null, deleted: false,
    };
  }
  function loadRoom(id) {
    if (typeof id !== 'string' || !ROOM_RE.test(id)) return null;
    if (rooms.has(id)) return rooms.get(id);
    try {
      const j = JSON.parse(fs.readFileSync(roomFile(id), 'utf8'));
      if (j.id !== id || typeof j.tk !== 'string' || typeof j.sk !== 'string') return null;
      const r = makeRoom(j);
      rooms.set(id, r);
      return r;
    } catch (e) { return null; }
  }
  function saveRoom(r) {
    if (!r.dirty || r.deleted) return;
    r.dirty = false;
    const f = roomFile(r.id), tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ id: r.id, owner: r.owner, tk: r.tk, sk: r.sk, write: r.write, bg: r.bg, els: Array.from(r.els.values()) }));
    fs.renameSync(tmp, f);
  }
  function persist(r) {
    r.dirty = true;
    if (r.timer) return;
    r.timer = setTimeout(() => { r.timer = null; try { saveRoom(r); } catch (e) { console.error('save', e.message); } }, 1000);
  }

  function okEl(e) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) return false;
    if (typeof e.id !== 'string' || !ID_RE.test(e.id) || !KINDS.has(e.k)) return false;
    try { return JSON.stringify(e).length <= MAX_EL_BYTES; } catch (err) { return false; }
  }

  /* ---------- HTTP ---------- */
  const STATUS = { invalid: 400, weak: 400, json: 400, auth: 401, forbidden: 403, invite: 403, none: 404, exists: 409, toobig: 413, rate: 429, full: 507 };
  const mkErr = (code, msg) => Object.assign(new Error(msg || code), { code: code });
  function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  function sendJson(res, code, obj, close) {
    const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (close) h.Connection = 'close';
    res.writeHead(code, h);
    res.end(JSON.stringify(obj));
  }
  const bearer = (req) => { const h = String(req.headers.authorization || ''); return h.slice(0, 7) === 'Bearer ' ? h.slice(7) : ''; };
  const isAdmin = (req) => { const t = bearer(req); return !!t && safeEq(t, ADMIN); };
  function readJson(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0, done = false;
      const chunks = [];
      req.on('data', (c) => {
        if (done) return;
        size += c.length;
        if (size > limit) { done = true; reject(mkErr('toobig', 'Слишком большой запрос.')); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (done) return;
        done = true;
        const t = Buffer.concat(chunks).toString('utf8');
        if (!t) { resolve({}); return; }
        try { const j = JSON.parse(t); resolve(j && typeof j === 'object' && !Array.isArray(j) ? j : {}); } catch (e) { reject(mkErr('json', 'Некорректный запрос.')); }
      });
      req.on('error', () => { if (!done) { done = true; reject(mkErr('json', 'Не удалось прочитать запрос.')); } });
    });
  }
  const pubAcc = (a) => ({ id: a.id, role: a.role, name: a.name, login: a.login });

  function courseSummary(a, mem) {
    const j = getJournal(mem.t), rec = j && j.studentRec(mem.s);
    if (!rec) return null;
    const t = auth.getById(mem.t), v = j.viewOf(rec);
    return Object.assign({ cid: mem.t + ':' + mem.s, as: mem.as, teacher: { name: t ? t.name : '' } }, v, { title: str(rec.title, 100) || 'Занятия' });
  }
  function myCourses(a) {
    const out = [];
    a.m.slice().forEach((mem) => {
      const c = courseSummary(a, mem);
      if (c) out.push(c); else auth.removeCourse(a.id, mem.t, mem.s);
    });
    return out;
  }
  function purgeTeacher(id) {
    const old = owned.get(id);
    if (old) old.forEach((k) => { if (k[0] === 'c') codeIdx.delete(k.slice(2)); else vkIdx.delete(k.slice(2)); });
    owned.delete(id);
    const j = journals.get(id);
    if (j) { try { j.flush(); } catch (e) { /* ignore */ } journals.delete(id); }
    try {
      fs.mkdirSync(path.join(DATA, 'teachers-deleted'), { recursive: true });
      fs.renameSync(path.join(TEACHERS_DIR, id), path.join(DATA, 'teachers-deleted', id + '-' + Date.now()));
    } catch (e) { /* нет данных */ }
  }

  async function route(req, res, u) {
    const p = u.pathname, m = req.method, ip = clientIp(req);
    const me = () => { const a = auth.session(bearer(req)); if (!a) throw mkErr('auth', 'Нужно войти в аккаунт.'); return a; };
    const teacher = () => { const a = me(); if (a.role !== 'teacher') throw mkErr('forbidden', 'Это действие только для учителя.'); return a; };

    /* --- администратор (по ключу сервера) --- */
    if (p.indexOf('/admin/') === 0) {
      if (!isAdmin(req)) throw mkErr('auth', 'Нужен ключ администратора.');
      if (p === '/admin/accounts' && m === 'GET') return sendJson(res, 200, { accounts: auth.listAccounts() });
      if (p === '/admin/reset' && m === 'POST') {
        const b = await readJson(req, 4096), a = auth.getByLogin(b.login);
        if (!a) throw mkErr('none', 'Такого логина нет.');
        return sendJson(res, 200, { login: a.login, password: await auth.setPassword(a.id, typeof b.password === 'string' && b.password ? b.password : '') });
      }
      const dm = p.match(/^\/admin\/accounts\/([^/]{1,64})$/);
      if (dm && m === 'DELETE') {
        const a = auth.getByLogin(decodeURIComponent(dm[1]));
        if (!a) throw mkErr('none', 'Такого логина нет.');
        if (a.role === 'teacher') purgeTeacher(a.id);
        auth.deleteAccount(a.id);
        return sendJson(res, 200, { ok: true });
      }
      throw mkErr('none');
    }

    /* --- регистрация и вход --- */
    if (p === '/auth/info' && m === 'GET') return sendJson(res, 200, { teacherInvite: !!opts.teacherInvite });
    if (p === '/auth/register' && m === 'POST') {
      if (regLimit.hit(ip) > 10) throw mkErr('rate', 'Слишком много регистраций с этого адреса. Попробуйте позже.');
      return sendJson(res, 201, await auth.register(await readJson(req, 4096)));
    }
    if (p === '/auth/login' && m === 'POST') {
      const b = await readJson(req, 4096), key = ip + '|' + String(b.login || '').toLowerCase().slice(0, 40);
      if (loginIp.count(ip) > 30 || loginKey.count(key) > 10) throw mkErr('rate', 'Слишком много попыток входа. Подождите 10 минут.');
      try { return sendJson(res, 200, await auth.login(b.login, b.password)); } catch (e) {
        if (e.code === 'auth') { loginIp.hit(ip); loginKey.hit(key); }
        throw e;
      }
    }
    if (p === '/auth/me' && m === 'GET') return sendJson(res, 200, { account: pubAcc(me()) });
    if (p === '/auth/logout' && m === 'POST') { auth.logout(bearer(req)); return sendJson(res, 200, { ok: true }); }
    if (p === '/auth/password' && m === 'POST') {
      const a = me(), b = await readJson(req, 4096);
      await auth.changePassword(a.id, b.old, b.new, bearer(req));
      return sendJson(res, 200, { ok: true });
    }

    /* --- учитель: журнал, комнаты доски, участники курса --- */
    if (p === '/api/sync' && m === 'POST') {
      const a = teacher(), b = await readJson(req, 5 * 1024 * 1024), j = getJournal(a.id);
      const out = j.sync(b.since, b.changes);
      reindex(a.id);
      const tomb = b.changes && Array.isArray(b.changes.tomb) ? b.changes.tomb : [];
      tomb.forEach((t) => { if (t && t.k === 'students' && typeof t.id === 'string' && SID_RE.test(t.id) && !j.studentRec(t.id)) auth.dropCourse(a.id, t.id); });
      return sendJson(res, 200, out);
    }
    if (p === '/api/rooms' && m === 'POST') {
      const a = teacher();
      await readJson(req, 1024);
      let count = 0;
      try { count = fs.readdirSync(ROOMS_DIR).length; } catch (e) { /* ignore */ }
      if (count >= MAX_ROOMS) throw mkErr('full', 'Достигнут лимит досок на сервере.');
      const id = token(16), tk = token(24), sk = token(24);
      const r = makeRoom({ id: id, owner: a.id, tk: tk, sk: sk, write: true, bg: 'dots', els: [] });
      rooms.set(id, r); r.dirty = true; saveRoom(r);
      return sendJson(res, 201, { id: id, tk: tk, sk: sk });
    }
    const rm = p.match(/^\/api\/rooms\/([A-Za-z0-9_-]{16,64})$/);
    if (rm && m === 'DELETE') {
      const a = teacher(), r = loadRoom(rm[1]);
      if (!r || r.owner !== a.id) throw mkErr('none', 'Доска не найдена.');
      r.deleted = true;
      r.clients.forEach((c) => { try { c.ws.close(4404, 'deleted'); } catch (e) { /* ignore */ } });
      rooms.delete(r.id);
      try { fs.unlinkSync(roomFile(r.id)); } catch (e) { /* ignore */ }
      return sendJson(res, 200, { ok: true });
    }
    const mm = p.match(/^\/api\/members\/([A-Za-z0-9_-]{1,40})(?:\/([A-Za-z0-9_-]{1,40})(?:\/(reset))?)?$/);
    if (mm) {
      const a = teacher(), sid = mm[1];
      if (!getJournal(a.id).studentRec(sid)) throw mkErr('none', 'Курс не найден.');
      const members = auth.membersOf(a.id, sid), target = mm[2] ? members.find((x) => x.id === mm[2]) : null;
      if (!mm[2] && m === 'GET') return sendJson(res, 200, { members: members });
      if (mm[2] && !target) throw mkErr('none', 'Участник не найден.');
      if (mm[3] === 'reset' && m === 'POST') return sendJson(res, 200, { password: await auth.setPassword(target.id) });
      if (!mm[3] && m === 'DELETE') { auth.removeCourse(target.id, a.id, sid); return sendJson(res, 200, { ok: true }); }
      throw mkErr('none');
    }

    /* --- ученик и родитель: мои курсы --- */
    if (p === '/api/join' && m === 'POST') {
      const a = me();
      if (a.role === 'teacher') throw mkErr('forbidden', 'Учитель создаёт курсы, а не присоединяется к ним.');
      if (joinFail.count(a.id) > 10) throw mkErr('rate', 'Слишком много неверных кодов. Подождите 10 минут.');
      const b = await readJson(req, 1024), code = String(b.code || '').toUpperCase().replace(/[\s-]/g, '');
      const e = CODE_RE.test(code) ? codeIdx.get(code) : null;
      if (!e || !getJournal(e.t).studentRec(e.s)) { joinFail.hit(a.id); throw mkErr('none', 'Код не найден. Проверьте, что он введён правильно.'); }
      if (e.as !== a.role) throw mkErr('forbidden', e.as === 'student' ? 'Это код для ученика. Родителю нужен родительский код.' : 'Это код для родителя. Ученику нужен ученический код.');
      if (!a.m.some((x) => x.t === e.t && x.s === e.s)) {
        if (auth.membersOf(e.t, e.s).length >= 10) throw mkErr('full', 'В этом курсе уже слишком много участников.');
        auth.addCourse(a.id, e.t, e.s, e.as);
      }
      const mem = a.m.find((x) => x.t === e.t && x.s === e.s);
      return sendJson(res, 200, { course: courseSummary(a, mem) });
    }
    if (p === '/api/my/courses' && m === 'GET') return sendJson(res, 200, { courses: myCourses(me()) });
    const cm = p.match(/^\/api\/my\/courses\/([A-Za-z0-9_-]{8,40}:[A-Za-z0-9_-]{1,40})(?:\/hw\/([A-Za-z0-9_-]{1,40})|\/(requests))?$/);
    if (cm) {
      const a = me(), mem = a.m.find((x) => x.t + ':' + x.s === cm[1]);
      if (!mem) throw mkErr('none', 'Курс не найден.');
      if (m === 'POST' && cm[3] === 'requests') {
        const b = await readJson(req, 2048), j = getJournal(mem.t);
        const x = j.addRequestOf(j.studentRec(mem.s), mem.as, b);
        if (x.err) throw mkErr('invalid', x.err);
        return sendJson(res, 201, x.req);
      }
      if (m === 'DELETE' && !cm[2] && !cm[3]) { auth.removeCourse(a.id, mem.t, mem.s); return sendJson(res, 200, { ok: true }); }
      if (m === 'POST' && cm[2]) {
        if (mem.as !== 'student') throw mkErr('forbidden', 'Родитель может только смотреть.');
        const b = await readJson(req, 1024), j = getJournal(mem.t);
        const h = j.markHwOf(j.studentRec(mem.s), cm[2], b.status);
        if (!h) throw mkErr('none', 'Задание не найдено или уже проверено.');
        return sendJson(res, 200, h);
      }
    }
    throw mkErr('none', 'Не найдено.');
  }

  function servePage(res, file, csp) {
    fs.readFile(path.join(PUBLIC, file), (err, buf) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex', 'Content-Security-Policy': csp,
      });
      res.end(buf);
    });
  }
  function handler(req, res) {
    let u;
    try { u = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); res.end(); return; }
    const p = u.pathname;
    if (/^\/(auth|api|admin)\//.test(p)) {
      if (p.indexOf('/admin/') !== 0) cors(res);
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
      route(req, res, u).catch((e) => {
        const code = e && e.code;
        if (STATUS[code]) sendJson(res, STATUS[code], { error: code, message: e.message }, code === 'toobig');
        else { console.error('route', e && e.message); sendJson(res, 500, { error: 'server', message: 'Ошибка сервера.' }); }
      });
      return;
    }
    /* страница ученика по ссылке без регистрации */
    const vm = p.match(/^\/v\/([A-Za-z0-9_-]{20,64})\/(data|hw\/([A-Za-z0-9_-]{1,40}))$/);
    if (vm) {
      const ip = clientIp(req);
      if (reqLimit.hit(ip) > 120 || failLimit.count(ip) > 20) { sendJson(res, 429, { error: 'rate' }); return; }
      const tid = vkIdx.get(vm[1]), j = tid ? getJournal(tid) : null;
      if (req.method === 'GET' && vm[2] === 'data') {
        const v = j && j.viewFor(vm[1]);
        if (!v) { failLimit.hit(ip); sendJson(res, 404, { error: 'none' }); return; }
        sendJson(res, 200, v);
        return;
      }
      if (req.method === 'POST' && vm[3]) {
        readJson(req, 2000).then((b) => {
          const h = j && j.markHw(vm[1], vm[3], b.status);
          if (!h) { failLimit.hit(ip); sendJson(res, 404, { error: 'none' }); return; }
          sendJson(res, 200, h);
        }, () => sendJson(res, 400, { error: 'json' }));
        return;
      }
      res.writeHead(405); res.end();
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    if (p === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
    if (STATIC[p]) {
      fs.readFile(path.join(PUBLIC, STATIC[p]), (err, buf) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        res.end(buf);
      });
      return;
    }
    if (/^\/s\/[A-Za-z0-9_-]{20,64}\/?$/.test(p)) {
      servePage(res, 'viewer.html', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      return;
    }
    if (/^\/r\/[A-Za-z0-9_-]{16,64}\/?$/.test(p)) {
      const host = /^[A-Za-z0-9.\-:\[\]]{1,255}$/.test(req.headers.host || '') ? req.headers.host : '';
      servePage(res, 'board.html', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' wss://" + host + ' ws://' + host + "; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Не найдено');
  }

  /* ---------- WebSocket ---------- */
  const server = http.createServer(handler);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  const sendTo = (c, msg) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); };
  const broadcast = (room, msg, except) => {
    const text = JSON.stringify(msg);
    room.clients.forEach((c) => { if (c !== except && c.ws.readyState === 1) c.ws.send(text); });
  };
  const peersMsg = (room) => ({ t: 'peers', list: Array.from(room.clients).map((c) => ({ id: c.id, role: c.role })) });

  function onOps(room, c, m) {
    if (c.role !== 'tutor' && !room.write) { sendTo(c, { t: 'deny' }); return; }
    const set = [], del = [];
    let bg;
    (Array.isArray(m.set) ? m.set.slice(0, MAX_SET) : []).forEach((e) => {
      if (!okEl(e)) return;
      if (!room.els.has(e.id) && room.els.size >= MAX_ELS) return;
      room.els.set(e.id, e); set.push(e);
    });
    (Array.isArray(m.del) ? m.del.slice(0, MAX_DEL) : []).forEach((id) => {
      if (typeof id === 'string' && room.els.delete(id)) del.push(id);
    });
    if (typeof m.bg === 'string' && BGS.has(m.bg) && m.bg !== room.bg) { room.bg = m.bg; bg = m.bg; }
    if (!set.length && !del.length && !bg) return;
    persist(room);
    broadcast(room, { t: 'ops', set: set, del: del, bg: bg }, c);
  }
  function onMessage(room, c, m) {
    switch (m.t) {
      case 'ops': onOps(room, c, m); break;
      case 'cur':
        if (typeof m.x === 'number' && typeof m.y === 'number' && isFinite(m.x) && isFinite(m.y)) broadcast(room, { t: 'cur', id: c.id, role: c.role, x: m.x, y: m.y }, c);
        break;
      case 'perm':
        if (c.role === 'tutor' && typeof m.write === 'boolean') { room.write = m.write; persist(room); broadcast(room, { t: 'perm', write: room.write }); }
        break;
    }
  }
  function onConnect(ws, u) {
    const room = loadRoom(u.searchParams.get('room'));
    const key = u.searchParams.get('key') || '';
    const role = room ? (safeEq(key, room.tk) ? 'tutor' : safeEq(key, room.sk) ? 'student' : null) : null;
    if (!role) { ws.send(JSON.stringify({ t: 'error', code: 'auth' })); ws.close(4401, 'auth'); return; }
    if (room.clients.size >= MAX_CLIENTS) { ws.send(JSON.stringify({ t: 'error', code: 'full' })); ws.close(4429, 'full'); return; }
    if (room.evict) { clearTimeout(room.evict); room.evict = null; }
    const c = { ws: ws, id: ++room.seq, role: role, t0: 0, n: 0, alive: true };
    room.clients.add(c);
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const now = Date.now();
      if (now - c.t0 > 1000) { c.t0 = now; c.n = 0; }
      if (++c.n > 150) { ws.close(1008, 'rate'); return; }
      let m;
      try { m = JSON.parse(data.toString('utf8')); } catch (e) { return; }
      if (!m || typeof m !== 'object') return;
      try { onMessage(room, c, m); } catch (e) { console.error('msg', e.message); }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      room.clients.delete(c);
      if (!room.deleted) broadcast(room, peersMsg(room));
      if (!room.clients.size && !room.deleted) {
        try { saveRoom(room); } catch (e) { /* ignore */ }
        room.evict = setTimeout(() => { if (!room.clients.size) rooms.delete(room.id); }, 10 * 60 * 1000);
        room.evict.unref();
      }
    });
    sendTo(c, { t: 'hello', role: role, id: c.id, write: room.write, bg: room.bg, els: Array.from(room.els.values()) });
    broadcast(room, peersMsg(room));
  }
  server.on('upgrade', (req, socket, head) => {
    let u;
    try { u = new URL(req.url, 'http://localhost'); } catch (e) { socket.destroy(); return; }
    if (u.pathname !== '/ws') { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, u));
  });
  const beat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) { ws.terminate(); return; }
      ws.isAlive = false;
      try { ws.ping(); } catch (e) { /* ignore */ }
    });
  }, 30000);
  beat.unref();
  wss.on('connection', (ws) => { ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; }); });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port === undefined ? 8080 : opts.port, opts.host || '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((done) => {
          clearInterval(beat);
          try { auth.flush(); journals.forEach((jj) => jj.flush()); } catch (e) { /* ignore */ }
          rooms.forEach((r) => { if (r.timer) clearTimeout(r.timer); if (r.evict) clearTimeout(r.evict); try { saveRoom(r); } catch (e) { /* ignore */ } });
          wss.clients.forEach((ws) => ws.terminate());
          server.close(() => done());
          if (server.closeAllConnections) server.closeAllConnections();
        }),
      });
    });
  });
}

module.exports = { start: start };

if (require.main === module) {
  start({
    adminToken: process.env.ADMIN_TOKEN || '',
    port: process.env.PORT ? Number(process.env.PORT) : 8080,
    host: process.env.HOST || '127.0.0.1',
    dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
    trustProxy: process.env.TRUST_PROXY === '1',
    teacherInvite: process.env.TEACHER_INVITE || '',
  }).then((s) => {
    console.log('Сервер доски запущен на порту ' + s.port);
    const stop = () => s.close().then(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
