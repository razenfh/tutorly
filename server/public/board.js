(function () {
'use strict';

/* Доска к уроку в стиле Miro: бесконечное полотно, объекты можно выбирать, двигать и менять размер.
   Хранится список объектов и положение камеры: {v:2, bg, view:{x,y,z}, els:[...]} */

const INK = [['#111827', 'Чёрный'], ['#2446C8', 'Синий'], ['#C23A33', 'Красный'], ['#176F49', 'Зелёный'], ['#B9660B', 'Оранжевый']];
const FILLS = [[null, 'Без заливки'], ['#FFF1A8', 'Жёлтый'], ['#FFD3DC', 'Розовый'], ['#CFE4FF', 'Голубой'], ['#CDEFD8', 'Зелёный'], ['#FFDDB8', 'Оранжевый']];
const WIDTHS = [[2, 'Тонкая'], [4, 'Средняя'], [8, 'Толстая']];
const TOOLS = [['select', 'Выбрать', 'V'], ['hand', 'Рука', 'H'], ['pen', 'Ручка', 'P'], ['line', 'Линия', 'L'], ['arrow', 'Стрелка', 'Shift+L'],
  ['rect', 'Прямоугольник', 'R или S'], ['ellipse', 'Овал', 'O'], ['text', 'Текст', 'T'], ['note', 'Стикер', 'N'], ['eraser', 'Ластик', 'E']];
const BGS = [['dots', 'Точки'], ['grid', 'Клетка'], ['plain', 'Чистый фон'], ['axes', 'Оси координат']];
const KEYS = { KeyV: 'select', KeyH: 'hand', KeyP: 'pen', KeyL: 'line', KeyS: 'rect', KeyR: 'rect', KeyO: 'ellipse', KeyT: 'text', KeyN: 'note', KeyE: 'eraser' };
const FONT = '"Golos Text", system-ui, "Segoe UI", sans-serif';
const NOTE_FILL = '#FFF1A8';
const ZMIN = 0.1, ZMAX = 4;

const $ = (id) => document.getElementById(id);
const num = (v) => typeof v === 'number' && isFinite(v);
const rnd = (n) => Math.round(n * 10) / 10;
const isColor = (c) => typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c);
let st = null;
let attached = false;
let drawQueued = false;
let clipboard = null; // общий буфер для всех досок
let uidN = 0;
const nid = () => 'e' + Date.now().toString(36) + (uidN++).toString(36) + Math.random().toString(36).slice(2, 4);
const hasText = (el) => el.k === 'text' || el.k === 'note' || el.k === 'rect' || el.k === 'ellipse';

/* ---------- геометрия ---------- */
function dist2seg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
let mctx = null;
function measure() {
  if (!mctx) mctx = document.createElement('canvas').getContext('2d');
  return mctx;
}
function wrap(ctx, text, maxW) {
  const out = [];
  String(text).split('\n').forEach((par) => {
    if (!par) { out.push(''); return; }
    let line = '';
    par.split(' ').forEach((word) => {
      const test = line ? line + ' ' + word : word;
      if (!line || ctx.measureText(test).width <= maxW) line = test;
      else { out.push(line); line = word; }
    });
    out.push(line);
  });
  return out;
}
function textBox(el) {
  const ctx = measure();
  ctx.font = el.s + 'px ' + FONT;
  const lines = String(el.t || '').split('\n');
  let w = 0;
  lines.forEach((l) => { w = Math.max(w, ctx.measureText(l).width); });
  return { x: el.x, y: el.y, w: Math.max(w, el.s * 0.6), h: lines.length * el.s * 1.25 };
}
function bbox(el) {
  switch (el.k) {
    case 'pen': {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      for (let i = 0; i < el.p.length; i += 2) {
        x1 = Math.min(x1, el.p[i]); x2 = Math.max(x2, el.p[i]);
        y1 = Math.min(y1, el.p[i + 1]); y2 = Math.max(y2, el.p[i + 1]);
      }
      const pad = el.sw / 2 + 1;
      return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
    }
    case 'line': {
      const pad = el.sw / 2 + 1;
      const x1 = Math.min(el.a[0], el.b[0]), y1 = Math.min(el.a[1], el.b[1]);
      return { x: x1 - pad, y: y1 - pad, w: Math.abs(el.b[0] - el.a[0]) + pad * 2, h: Math.abs(el.b[1] - el.a[1]) + pad * 2 };
    }
    case 'text': return textBox(el);
    default: return { x: el.x, y: el.y, w: el.w, h: el.h };
  }
}
function hit(el, x, y, tol) {
  switch (el.k) {
    case 'pen': {
      const m = el.sw / 2 + tol, p = el.p;
      if (p.length < 4) return Math.hypot(x - p[0], y - p[1]) <= m;
      for (let i = 2; i < p.length; i += 2) if (dist2seg(x, y, p[i - 2], p[i - 1], p[i], p[i + 1]) <= m) return true;
      return false;
    }
    case 'line': return dist2seg(x, y, el.a[0], el.a[1], el.b[0], el.b[1]) <= el.sw / 2 + tol;
    case 'note': return x >= el.x - tol && x <= el.x + el.w + tol && y >= el.y - tol && y <= el.y + el.h + tol;
    case 'rect': {
      if (el.f) return x >= el.x - tol && x <= el.x + el.w + tol && y >= el.y - tol && y <= el.y + el.h + tol;
      const m = el.sw / 2 + tol, x2 = el.x + el.w, y2 = el.y + el.h;
      return dist2seg(x, y, el.x, el.y, x2, el.y) <= m || dist2seg(x, y, x2, el.y, x2, y2) <= m ||
        dist2seg(x, y, x2, y2, el.x, y2) <= m || dist2seg(x, y, el.x, y2, el.x, el.y) <= m;
    }
    case 'ellipse': {
      const cx = el.x + el.w / 2, cy = el.y + el.h / 2, rx = el.w / 2, ry = el.h / 2;
      if (rx < 1 || ry < 1) return false;
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (el.f) return d <= 1 + tol / Math.min(rx, ry);
      return Math.abs(d - 1) * Math.min(rx, ry) <= el.sw / 2 + tol;
    }
    case 'text': {
      const b = textBox(el);
      return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
    }
  }
  return false;
}
function copyEl(el) { return JSON.parse(JSON.stringify(el)); }
function moveEl(el, o, dx, dy) {
  if (el.k === 'pen') el.p = o.p.map((v, i) => v + (i % 2 ? dy : dx));
  else if (el.k === 'line') { el.a = [o.a[0] + dx, o.a[1] + dy]; el.b = [o.b[0] + dx, o.b[1] + dy]; }
  else { el.x = o.x + dx; el.y = o.y + dy; }
}
/* h: 'nw' | 'ne' | 'sw' | 'se' для рамки, 'a' | 'b' для концов линии; o: копия объекта в начале */
function resizeEl(el, o, h, px, py) {
  if (el.k === 'line') { if (h === 'a') el.a = [px, py]; else el.b = [px, py]; return; }
  const b = o._b;
  const fx = h.indexOf('w') >= 0 ? b.x + b.w : b.x;
  const fy = h.indexOf('n') >= 0 ? b.y + b.h : b.y;
  if (el.k === 'text') {
    const sc = Math.max(0.2, Math.max(Math.abs(px - fx) / b.w, Math.abs(py - fy) / b.h));
    el.s = Math.max(8, Math.min(400, o.s * sc));
    el.x = h.indexOf('w') >= 0 ? fx - b.w * sc : fx;
    el.y = h.indexOf('n') >= 0 ? fy - b.h * sc : fy;
    return;
  }
  const nx = Math.min(px, fx), ny = Math.min(py, fy);
  const nw = Math.max(10, Math.abs(px - fx)), nh = Math.max(10, Math.abs(py - fy));
  const ox = h.indexOf('w') >= 0 ? fx - nw : fx, oy = h.indexOf('n') >= 0 ? fy - nh : fy;
  void nx; void ny;
  if (el.k === 'pen') {
    el.p = o.p.map((v, i) => (i % 2 ? oy + (v - b.y) * nh / b.h : ox + (v - b.x) * nw / b.w));
  } else { el.x = ox; el.y = oy; el.w = nw; el.h = nh; }
}

/* ---------- чтение сохранённых данных ---------- */
function cleanEl(e) {
  if (!e || typeof e !== 'object') return null;
  const base = { id: typeof e.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(e.id) ? e.id : nid(), k: e.k };
  const c = isColor(e.c) ? e.c : INK[0][0];
  const sw = num(e.sw) ? Math.max(1, Math.min(30, e.sw)) : 4;
  const f = isColor(e.f) ? e.f : null;
  switch (e.k) {
    case 'pen':
      if (!Array.isArray(e.p) || e.p.length < 2 || e.p.length % 2 || !e.p.every(num)) return null;
      return Object.assign(base, { c: c, sw: sw, p: e.p.slice() });
    case 'line':
      if (!Array.isArray(e.a) || !Array.isArray(e.b) || !num(e.a[0]) || !num(e.a[1]) || !num(e.b[0]) || !num(e.b[1])) return null;
      return Object.assign(base, { c: c, sw: sw, a: [e.a[0], e.a[1]], b: [e.b[0], e.b[1]], ar: !!e.ar });
    case 'rect': case 'ellipse': case 'note':
      if (![e.x, e.y, e.w, e.h].every(num) || e.w < 1 || e.h < 1) return null;
      return Object.assign(base, { c: c, sw: sw, f: e.k === 'note' ? (f || NOTE_FILL) : f, x: e.x, y: e.y, w: e.w, h: e.h,
        s: num(e.s) ? Math.max(8, Math.min(200, e.s)) : (e.k === 'note' ? 26 : 24), t: typeof e.t === 'string' ? e.t.slice(0, 5000) : '' });
    case 'text':
      if (!num(e.x) || !num(e.y) || typeof e.t !== 'string') return null;
      return Object.assign(base, { c: c, x: e.x, y: e.y, t: e.t.slice(0, 5000), s: num(e.s) ? Math.max(8, Math.min(400, e.s)) : 28 });
  }
  return null;
}
function sanitizeData(d) {
  const out = { bg: 'dots', view: null, els: [] };
  if (!d || typeof d !== 'object') return out;
  if (Array.isArray(d.pages)) { // старый формат: листы кладём друг под другом
    d.pages.forEach((p, i) => {
      if (!p || !Array.isArray(p.els)) return;
      if (i === 0 && BGS.some((b) => b[0] === p.bg)) out.bg = p.bg;
      const oy = i * 1100;
      p.els.forEach((e) => {
        if (!e || typeof e !== 'object') return;
        let n = null;
        if (e.k === 'pen' && Array.isArray(e.p)) n = { k: 'pen', c: e.c, sw: e.w, p: e.p.map((v, j) => (j % 2 ? v + oy : v)) };
        else if (e.k === 'line' && Array.isArray(e.a) && Array.isArray(e.b)) n = { k: 'line', c: e.c, sw: e.w, a: [e.a[0], e.a[1] + oy], b: [e.b[0], e.b[1] + oy] };
        else if ((e.k === 'rect' || e.k === 'ellipse') && Array.isArray(e.a) && Array.isArray(e.b)) {
          n = { k: e.k, c: e.c, sw: e.w, x: Math.min(e.a[0], e.b[0]), y: Math.min(e.a[1], e.b[1]) + oy, w: Math.abs(e.b[0] - e.a[0]), h: Math.abs(e.b[1] - e.a[1]), f: null, t: '' };
        } else if (e.k === 'text') n = { k: 'text', c: e.c, x: e.x, y: e.y + oy, s: e.s, t: e.t };
        const c = n && cleanEl(n);
        if (c) out.els.push(c);
      });
    });
    return out;
  }
  if (BGS.some((b) => b[0] === d.bg)) out.bg = d.bg;
  if (d.view && num(d.view.x) && num(d.view.y) && num(d.view.z)) out.view = { x: d.view.x, y: d.view.y, z: Math.max(ZMIN, Math.min(ZMAX, d.view.z)) };
  if (Array.isArray(d.els)) {
    const seen = {};
    d.els.forEach((e) => {
      const c = cleanEl(e);
      if (!c) return;
      if (seen[c.id]) c.id = nid();
      seen[c.id] = 1;
      out.els.push(c);
    });
  }
  return out;
}

/* ---------- рисование ---------- */
function drawBg(ctx, bg, x, y, w, h, z) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  if (bg === 'plain') return;
  let base = 40;
  while (base * z < 14) base *= 2;
  const x0 = Math.floor(x / base) * base, y0 = Math.floor(y / base) * base;
  if (bg === 'dots') {
    ctx.fillStyle = '#b7c2d4';
    const r = 1.6 / Math.max(z, 0.5);
    for (let gx = x0; gx <= x + w; gx += base) for (let gy = y0; gy <= y + h; gy += base) ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
    return;
  }
  ctx.strokeStyle = '#d3dcea'; ctx.lineWidth = 1 / z; ctx.lineCap = 'butt';
  ctx.beginPath();
  for (let gx = x0; gx <= x + w; gx += base) { ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); }
  for (let gy = y0; gy <= y + h; gy += base) { ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); }
  ctx.stroke();
  if (bg === 'axes') {
    ctx.strokeStyle = '#111827'; ctx.fillStyle = '#111827'; ctx.lineWidth = 2 / z;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + w, 0); ctx.moveTo(0, y); ctx.lineTo(0, y + h); ctx.stroke();
    const a = 10 / z;
    ctx.beginPath(); ctx.moveTo(x + w, 0); ctx.lineTo(x + w - 2 * a, -a * 0.6); ctx.lineTo(x + w - 2 * a, a * 0.6); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(-a * 0.6, y + 2 * a); ctx.lineTo(a * 0.6, y + 2 * a); ctx.closePath(); ctx.fill();
    if (base * z >= 14) {
      const every = base * z < 28 ? 2 : 1;
      ctx.font = (12 / z) + 'px ' + FONT; ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      for (let gx = x0; gx <= x + w; gx += base) {
        const n = Math.round(gx / 40);
        if (!n || Math.round(gx / base) % every) continue;
        ctx.fillText(String(n), gx, 4 / z);
      }
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (let gy = y0; gy <= y + h; gy += base) {
        const n = Math.round(gy / 40);
        if (!n || Math.round(gy / base) % every) continue;
        ctx.fillText(String(-n), -5 / z, gy);
      }
      ctx.textAlign = 'left';
    }
  }
}
function drawBoxText(ctx, el) {
  if (!el.t) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(el.x, el.y, el.w, el.h); ctx.clip();
  ctx.font = el.s + 'px ' + FONT; ctx.fillStyle = el.c; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  const lines = wrap(ctx, el.t, Math.max(10, el.w - 24)), lh = el.s * 1.25;
  const y = el.y + Math.max(6, (el.h - lines.length * lh) / 2);
  lines.forEach((l, i) => ctx.fillText(l, el.x + el.w / 2, y + i * lh));
  ctx.restore();
}
function drawEl(ctx, el, skipText) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = el.c; ctx.fillStyle = el.c; ctx.lineWidth = el.sw || 1;
  switch (el.k) {
    case 'pen': {
      const p = el.p;
      if (p.length < 4) { ctx.beginPath(); ctx.arc(p[0], p[1], el.sw / 2, 0, Math.PI * 2); ctx.fill(); break; }
      ctx.beginPath(); ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length - 2; i += 2) ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
      ctx.lineTo(p[p.length - 2], p[p.length - 1]);
      ctx.stroke();
      break;
    }
    case 'line': {
      const ax = el.a[0], ay = el.a[1], bx = el.b[0], by = el.b[1];
      ctx.beginPath(); ctx.moveTo(ax, ay);
      if (el.ar) {
        const ang = Math.atan2(by - ay, bx - ax), len = Math.max(14, el.sw * 4.5);
        const l2 = Math.hypot(bx - ax, by - ay);
        if (l2 > len * 0.8) {
          ctx.lineTo(bx - Math.cos(ang) * len * 0.5, by - Math.sin(ang) * len * 0.5); ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx - len * Math.cos(ang - 0.45), by - len * Math.sin(ang - 0.45));
          ctx.lineTo(bx - len * Math.cos(ang + 0.45), by - len * Math.sin(ang + 0.45));
          ctx.closePath(); ctx.fill();
          break;
        }
      }
      ctx.lineTo(bx, by); ctx.stroke();
      break;
    }
    case 'rect':
      if (el.f) { ctx.fillStyle = el.f; ctx.fillRect(el.x, el.y, el.w, el.h); }
      ctx.strokeRect(el.x, el.y, el.w, el.h);
      if (!skipText) drawBoxText(ctx, el);
      break;
    case 'ellipse':
      ctx.beginPath(); ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
      if (el.f) { ctx.fillStyle = el.f; ctx.fill(); }
      ctx.stroke();
      if (!skipText) drawBoxText(ctx, el);
      break;
    case 'note':
      ctx.save();
      ctx.shadowColor = 'rgba(17,24,39,.22)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      ctx.fillStyle = el.f || NOTE_FILL; ctx.fillRect(el.x, el.y, el.w, el.h);
      ctx.restore();
      if (!skipText) drawBoxText(ctx, el);
      break;
    case 'text':
      if (skipText) break;
      ctx.font = el.s + 'px ' + FONT; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
      String(el.t).split('\n').forEach((l, i) => ctx.fillText(l, el.x, el.y + i * el.s * 1.25));
      break;
  }
}

/* ---------- состояние, камера ---------- */
const byId = (id) => st.els.find((e) => e.id === id) || null;
const selEls = () => st.sel.map(byId).filter(Boolean);
const toS = (x, y) => [(x - st.view.x) * st.view.z, (y - st.view.y) * st.view.z];
function scr(e) {
  const r = $('boardCanvas').getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
const wld = (s) => [s[0] / st.view.z + st.view.x, s[1] / st.view.z + st.view.y];

function selRect(els) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  els.forEach((el) => { const b = bbox(el); x1 = Math.min(x1, b.x); y1 = Math.min(y1, b.y); x2 = Math.max(x2, b.x + b.w); y2 = Math.max(y2, b.y + b.h); });
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
function handlesOf(el) {
  if (el.k === 'line') return [{ n: 'a', p: toS(el.a[0], el.a[1]) }, { n: 'b', p: toS(el.b[0], el.b[1]) }];
  const b = bbox(el);
  return [{ n: 'nw', p: toS(b.x, b.y) }, { n: 'ne', p: toS(b.x + b.w, b.y) }, { n: 'sw', p: toS(b.x, b.y + b.h) }, { n: 'se', p: toS(b.x + b.w, b.y + b.h) }];
}
function handleAt(s) {
  const sel = selEls();
  if (sel.length !== 1) return null;
  const hs = handlesOf(sel[0]);
  for (let i = 0; i < hs.length; i++) if (Math.hypot(s[0] - hs[i].p[0], s[1] - hs[i].p[1]) <= 10) return hs[i].n;
  return null;
}
function topHit(p) {
  const tol = 6 / st.view.z;
  for (let i = st.els.length - 1; i >= 0; i--) if (hit(st.els[i], p[0], p[1], tol)) return st.els[i];
  return null;
}

function resize() {
  if (!st) return;
  const stage = $('boardStage'), cv = $('boardCanvas');
  const r = stage.getBoundingClientRect();
  st.w = Math.max(50, r.width); st.h = Math.max(50, r.height);
  st.dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(st.w * st.dpr); cv.height = Math.round(st.h * st.dpr);
  draw();
}
function curEl() {
  const d = st.drag;
  if (!d) return null;
  if (d.t === 'pen') return d.el;
  if (d.t === 'create') return d.el || null;
  return null;
}
function draw() {
  if (!st || !st.w) return;
  const cv = $('boardCanvas'), ctx = cv.getContext('2d'), v = st.view, dpr = st.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, st.w, st.h);
  ctx.save();
  ctx.scale(v.z, v.z); ctx.translate(-v.x, -v.y);
  drawBg(ctx, st.bg, v.x, v.y, st.w / v.z, st.h / v.z, v.z);
  const editId = st.edit ? st.edit.id : null;
  st.els.forEach((el) => drawEl(ctx, el, el.id === editId));
  const c = curEl();
  if (c) drawEl(ctx, c, false);
  ctx.restore();
  drawOverlay(ctx);
  if (st.edit) layoutTa();
}
function drawOverlay(ctx) {
  const sel = st.edit ? [] : selEls();
  ctx.save();
  if (sel.length) {
    ctx.strokeStyle = '#2563eb'; ctx.fillStyle = '#ffffff'; ctx.lineWidth = 1.5;
    if (sel.length === 1 && sel[0].k === 'line') {
      /* у линии только концы */
    } else {
      const b = sel.length === 1 ? bbox(sel[0]) : selRect(sel);
      const a = toS(b.x, b.y);
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(a[0] - 3, a[1] - 3, b.w * st.view.z + 6, b.h * st.view.z + 6);
      ctx.setLineDash([]);
    }
    if (sel.length === 1) {
      handlesOf(sel[0]).forEach((h) => {
        ctx.beginPath();
        if (sel[0].k === 'line') ctx.arc(h.p[0], h.p[1], 6, 0, Math.PI * 2);
        else ctx.rect(h.p[0] - 5, h.p[1] - 5, 10, 10);
        ctx.fill(); ctx.stroke();
      });
    }
  }
  const d = st.drag;
  if (d && d.t === 'marquee') {
    const a = toS(d.a[0], d.a[1]), b = toS(d.b[0], d.b[1]);
    ctx.fillStyle = 'rgba(37,99,235,.08)'; ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1;
    ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
  }
  if (st.sync) {
    const now = Date.now();
    Object.keys(st.sync.cursors).forEach((id) => {
      const c = st.sync.cursors[id];
      if (now - c.t > 6000) return;
      const q = toS(c.x, c.y), col = c.role === 'tutor' ? '#2446C8' : '#D9731A', name = c.role === 'tutor' ? 'Репетитор' : 'Ученик';
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(q[0], q[1]); ctx.lineTo(q[0] + 4, q[1] + 16); ctx.lineTo(q[0] + 10, q[1] + 11); ctx.closePath(); ctx.fill();
      ctx.font = '600 12px ' + FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      const w = ctx.measureText(name).width + 12;
      ctx.fillRect(q[0] + 12, q[1] + 12, w, 20);
      ctx.fillStyle = '#ffffff'; ctx.fillText(name, q[0] + 18, q[1] + 22);
    });
  }
  ctx.restore();
}
function schedDraw() {
  if (st && st.sync) st.sync.touched = true;
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}
function zoomLabel() { const e = $('zLabel'); if (e && st) e.textContent = Math.round(st.view.z * 100) + '%'; }
function viewChanged() { draw(); zoomLabel(); scheduleSave(); }
function zoomAt(f, cx, cy) {
  const v = st.view, nz = Math.max(ZMIN, Math.min(ZMAX, v.z * f));
  if (nz === v.z) return;
  const wx = cx / v.z + v.x, wy = cy / v.z + v.y;
  v.z = nz; v.x = wx - cx / nz; v.y = wy - cy / nz;
  viewChanged();
}
function fitSel() {
  const sel = selEls();
  if (!sel.length) { fit(); return; }
  const b = selRect(sel);
  const z = Math.max(ZMIN, Math.min(ZMAX, Math.min(st.w / (b.w + 120), st.h / (b.h + 120))));
  st.view = { z: z, x: b.x + b.w / 2 - st.w / 2 / z, y: b.y + b.h / 2 - st.h / 2 / z };
  viewChanged();
}
function fit() {
  if (!st) return;
  if (!st.els.length) { st.view = { x: -st.w / 2, y: -st.h / 2, z: 1 }; viewChanged(); return; }
  const b = selRect(st.els);
  const z = Math.max(ZMIN, Math.min(2, Math.min(st.w / (b.w + 120), st.h / (b.h + 120))));
  st.view = { z: z, x: b.x + b.w / 2 - st.w / 2 / z, y: b.y + b.h / 2 - st.h / 2 / z };
  viewChanged();
}

/* ---------- история ---------- */
const snap = () => JSON.stringify(st.els);
function pushSnap() { const h = st.hist; h.u.push(snap()); if (h.u.length > 60) h.u.shift(); h.r = []; }
function restore(text) {
  let next = JSON.parse(text);
  if (st.sync) { // при совместной работе отмена не трогает то, что нарисовали другие
    const ri = st.sync.remote, have = {};
    next.forEach((e) => { have[e.id] = 1; });
    st.els.forEach((e) => {
      if (!ri.has(e.id)) return;
      if (have[e.id]) next = next.map((x) => (x.id === e.id ? e : x)); else next.push(e);
    });
  }
  st.els = next;
  st.sel = st.sel.filter((id) => byId(id));
}
function undo() { commitEdit(); const h = st.hist; if (!h.u.length) return; h.r.push(snap()); restore(h.u.pop()); changed(); }
function redo() { commitEdit(); const h = st.hist; if (!h.r.length) return; h.u.push(snap()); restore(h.r.pop()); changed(); }
const hasContent = () => st.els.length > 0;
const serialize = () => JSON.stringify({ v: 2, bg: st.bg, view: { x: rnd(st.view.x), y: rnd(st.view.y), z: Math.round(st.view.z * 1000) / 1000 }, els: st.els });

function setStatus(t) { const e = $('boardSaved'); if (e) e.textContent = t; }
function scheduleSave() {
  st.dirty = true; setStatus('Сохраняется…');
  clearTimeout(st.timer);
  st.timer = setTimeout(flush, 600);
}
function flush() {
  if (!st || !st.dirty) return Promise.resolve();
  st.dirty = false;
  clearTimeout(st.timer);
  const s = st, text = serialize(), has = hasContent();
  return window.api.boardSave(s.id, text).then(
    () => { if (st === s) setStatus('Сохранено'); if (s.onContent) s.onContent(has); },
    () => { if (st === s) setStatus('Не удалось сохранить'); });
}
function changed() { if (st.sync) st.sync.touched = true; draw(); scheduleSave(); updateUi(); }

/* ---------- действия над выделением ---------- */
function delSel() {
  const ids = st.sel.slice();
  if (!ids.length) return;
  pushSnap();
  st.els = st.els.filter((e) => ids.indexOf(e.id) < 0);
  st.sel = [];
  changed();
}
function copySel() {
  const els = selEls();
  if (els.length) { clipboard = els.map(copyEl); st.pasteN = 0; }
}
function pasteClip(offset) {
  if (!clipboard || !clipboard.length) return;
  st.pasteN = (st.pasteN || 0) + 1;
  const d = offset || 30 * st.pasteN;
  pushSnap();
  const made = clipboard.map((o) => {
    const c = copyEl(o); c.id = nid();
    moveEl(c, o, d, d);
    return c;
  });
  made.forEach((c) => st.els.push(c));
  st.sel = made.map((c) => c.id);
  changed();
}
function dupSel() { copySel(); pasteClip(30); }
function toFront(back) {
  const sel = selEls();
  if (!sel.length) return;
  pushSnap();
  const ids = sel.map((e) => e.id), rest = st.els.filter((e) => ids.indexOf(e.id) < 0), mine = st.els.filter((e) => ids.indexOf(e.id) >= 0);
  st.els = back ? mine.concat(rest) : rest.concat(mine);
  changed();
}
function setStyle(prop, val) {
  if (prop === 'c') st.color = val; else if (prop === 'f') st.fill = val; else st.width = val;
  const ok = (el) => (prop === 'c' ? true : prop === 'f' ? (el.k === 'rect' || el.k === 'ellipse' || (el.k === 'note' && val)) : el.k !== 'text' && el.k !== 'note');
  const target = selEls().filter((el) => ok(el) && el[prop] !== val);
  if (target.length) { pushSnap(); target.forEach((el) => { el[prop] = val; }); changed(); } else updateUi();
}

/* ---------- текст на объектах ---------- */
function editEl() { const e = st.edit; return e ? (e.proto || byId(e.id)) : null; }
function layoutTa() {
  const e = st.edit, el = editEl(), ta = $('boardText');
  if (!e || !el) return;
  const z = st.view.z, p = toS(el.x, el.y);
  ta.hidden = false;
  ta.style.fontSize = (el.s * z) + 'px';
  ta.style.color = el.c;
  ta.style.left = p[0] + 'px'; ta.style.top = p[1] + 'px';
  if (el.k === 'text') {
    const b = textBox({ s: el.s, t: ta.value, x: 0, y: 0 });
    ta.style.textAlign = 'left'; ta.style.paddingTop = '0px'; ta.style.paddingLeft = '0px'; ta.style.paddingRight = '0px';
    ta.style.width = Math.max(180, b.w * z + el.s * z) + 'px';
    ta.style.height = (b.h * z + 6) + 'px';
  } else {
    const ctx = measure(); ctx.font = el.s + 'px ' + FONT;
    const lines = wrap(ctx, ta.value || ' ', Math.max(10, el.w - 24)).length;
    ta.style.textAlign = 'center';
    ta.style.width = el.w * z + 'px'; ta.style.height = el.h * z + 'px';
    ta.style.paddingLeft = ta.style.paddingRight = (12 * z) + 'px';
    ta.style.paddingTop = Math.max(4, (el.h - lines * el.s * 1.25) / 2 * z) + 'px';
  }
}
function startEdit(el, opts) {
  commitEdit();
  const proto = opts && opts.proto ? el : null;
  st.edit = { id: el.id, proto: proto, fresh: !!(opts && opts.fresh) };
  const ta = $('boardText');
  ta.value = el.t || '';
  $('boardSym').hidden = false;
  st.sel = proto ? [] : [el.id];
  draw();
  setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
}
function closeEdit() {
  st.edit = null;
  $('boardText').hidden = true; $('boardSym').hidden = true;
}
function commitEdit() {
  if (!st || !st.edit) return;
  const e = st.edit, t = $('boardText').value.replace(/\s+$/, '');
  closeEdit();
  if (e.proto) {
    if (t.trim()) {
      pushSnap();
      e.proto.t = t; st.els.push(e.proto); st.sel = [e.proto.id];
      st.tool = 'select';
      changed();
    } else { st.tool = 'select'; draw(); updateUi(); }
    return;
  }
  const el = byId(e.id);
  if (!el) { draw(); return; }
  if (e.fresh && st.tool !== 'select') st.tool = 'select';
  if (t !== (el.t || '')) {
    if (!e.fresh) pushSnap();
    el.t = t;
    if (el.k === 'text' && !t.trim()) { st.els = st.els.filter((x) => x !== el); st.sel = st.sel.filter((id) => id !== el.id); }
    changed();
  } else { draw(); updateUi(); }
}
function newText(p) {
  const proto = { id: nid(), k: 'text', c: st.color, x: rnd(p[0]), y: rnd(p[1]), s: st.width * 8 + 12, t: '' };
  startEdit(proto, { proto: true });
}

/* ---------- создание объектов ---------- */
function mk(kind, a, b, shift) {
  const c = st.color, sw = st.width;
  if (kind === 'line' || kind === 'arrow') {
    let q = b;
    if (shift) {
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy), ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      q = [a[0] + len * Math.cos(ang), a[1] + len * Math.sin(ang)];
    }
    return { id: nid(), k: 'line', c: c, sw: sw, a: [rnd(a[0]), rnd(a[1])], b: [rnd(q[0]), rnd(q[1])], ar: kind === 'arrow' };
  }
  let w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
  let x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
  if (shift) { const m = Math.max(w, h); w = h = m; x = b[0] < a[0] ? a[0] - m : a[0]; y = b[1] < a[1] ? a[1] - m : a[1]; }
  const note = kind === 'note';
  return { id: nid(), k: kind, c: c, sw: sw, f: note ? (st.fill || NOTE_FILL) : st.fill, x: rnd(x), y: rnd(y), w: rnd(w), h: rnd(h), s: note ? 26 : 24, t: '' };
}
function finishCreate(d, shift) {
  const kind = d.kind;
  const small = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]) * st.view.z < 6;
  if (kind === 'line' || kind === 'arrow') {
    if (small) return;
    pushSnap(); st.els.push(mk(kind, d.a, d.b, shift)); changed();
    return;
  }
  let el;
  if (small) {
    const dim = kind === 'note' ? [200, 200] : kind === 'rect' ? [180, 120] : [160, 120];
    el = mk(kind, [d.a[0] - dim[0] / 2, d.a[1] - dim[1] / 2], [d.a[0] + dim[0] / 2, d.a[1] + dim[1] / 2], false);
  } else {
    el = mk(kind, d.a, d.b, shift);
    if (el.w < 30) el.w = 30;
    if (el.h < 30) el.h = 30;
  }
  pushSnap();
  st.els.push(el);
  st.sel = [el.id];
  st.tool = 'select';
  changed();
  if (kind === 'note') startEdit(el, { fresh: true });
}

/* ---------- указатель ---------- */
function eraseAt(p, d) {
  const tol = 10 / st.view.z;
  const keep = st.els.filter((el) => !hit(el, p[0], p[1], tol));
  if (keep.length !== st.els.length) {
    if (!d.snapped) { pushSnap(); d.snapped = true; }
    st.els = keep;
    st.sel = st.sel.filter((id) => byId(id));
    changed();
  }
}
function cursorFor() {
  if (st.space || st.tool === 'hand') return st.drag && st.drag.t === 'pan' ? 'grabbing' : 'grab';
  if (st.tool === 'text') return 'text';
  if (st.tool === 'eraser') return 'cell';
  if (st.tool === 'select') return 'default';
  return 'crosshair';
}
function onDown(e) {
  if (!st) return;
  if (e.button === 2) return;
  e.preventDefault();
  commitEdit();
  const cv = $('boardCanvas');
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  const s = scr(e), p = wld(s);
  if (e.button === 1 || st.space || st.tool === 'hand' || st.readonly) {
    st.drag = { t: 'pan', sx: s[0], sy: s[1], vx: st.view.x, vy: st.view.y };
    cv.style.cursor = 'grabbing';
    return;
  }
  const tool = st.tool;
  if (tool === 'select') {
    const hn = handleAt(s);
    if (hn) {
      const el = selEls()[0], o = copyEl(el); o._b = bbox(el);
      st.drag = { t: 'resize', id: el.id, h: hn, o: o, moved: false, s0: s };
      return;
    }
    const h = topHit(p);
    if (h) {
      if (e.shiftKey) {
        st.sel = st.sel.indexOf(h.id) >= 0 ? st.sel.filter((id) => id !== h.id) : st.sel.concat(h.id);
        updateUi(); draw();
        return;
      }
      if (st.sel.indexOf(h.id) < 0) st.sel = [h.id];
      const orig = {};
      selEls().forEach((el) => { orig[el.id] = copyEl(el); });
      st.drag = { t: 'move', orig: orig, p0: p, s0: s, moved: false, hitId: h.id, shift: e.shiftKey };
      updateUi(); draw();
      return;
    }
    if (!e.shiftKey) st.sel = [];
    st.drag = { t: 'marquee', a: p, b: p, keep: e.shiftKey ? st.sel.slice() : [] };
    updateUi(); draw();
    return;
  }
  st.sel = [];
  if (tool === 'text') { newText(p); updateUi(); return; }
  if (tool === 'pen') {
    st.drag = { t: 'pen', el: { id: nid(), k: 'pen', c: st.color, sw: st.width, p: [rnd(p[0]), rnd(p[1])] } };
  } else if (tool === 'eraser') {
    st.drag = { t: 'erase', snapped: false };
    eraseAt(p, st.drag);
  } else {
    st.drag = { t: 'create', kind: tool, a: p, b: p, el: null };
  }
  updateUi(); schedDraw();
}
function onMove(e) {
  if (!st) return;
  const s = scr(e), p = wld(s), d = st.drag;
  const sy = st.sync;
  if (sy && sy.ready) {
    const nowT = Date.now();
    if (nowT - sy.curAt > 60) { sy.curAt = nowT; sy.send({ t: 'cur', x: rnd(p[0]), y: rnd(p[1]) }); }
  }
  if (!d) {
    if (st.tool === 'select' && !st.space) {
      const hn = handleAt(s);
      const cv = $('boardCanvas');
      cv.style.cursor = hn ? (hn === 'nw' || hn === 'se' ? 'nwse-resize' : hn === 'ne' || hn === 'sw' ? 'nesw-resize' : 'crosshair') : (topHit(p) ? 'move' : 'default');
    }
    return;
  }
  switch (d.t) {
    case 'pan':
      st.view.x = d.vx - (s[0] - d.sx) / st.view.z;
      st.view.y = d.vy - (s[1] - d.sy) / st.view.z;
      zoomLabel(); st.dirty = true; clearTimeout(st.timer); st.timer = setTimeout(flush, 600);
      break;
    case 'pen': {
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      (evs.length ? evs : [e]).forEach((ev) => {
        const q = wld(scr(ev)), pts = d.el.p;
        if (Math.hypot(q[0] - pts[pts.length - 2], q[1] - pts[pts.length - 1]) * st.view.z >= 1.5) pts.push(rnd(q[0]), rnd(q[1]));
      });
      break;
    }
    case 'erase': eraseAt(p, d); break;
    case 'create': d.b = p; d.el = mk(d.kind, d.a, d.b, e.shiftKey); break;
    case 'move': {
      if (!d.moved) {
        if (Math.hypot(s[0] - d.s0[0], s[1] - d.s0[1]) < 3) return;
        pushSnap(); d.moved = true;
      }
      const dx = p[0] - d.p0[0], dy = p[1] - d.p0[1];
      Object.keys(d.orig).forEach((id) => { const el = byId(id); if (el) moveEl(el, d.orig[id], dx, dy); });
      break;
    }
    case 'resize': {
      if (!d.moved) {
        if (Math.hypot(s[0] - d.s0[0], s[1] - d.s0[1]) < 2) return;
        pushSnap(); d.moved = true;
      }
      const el = byId(d.id);
      if (el) resizeEl(el, d.o, d.h, p[0], p[1]);
      break;
    }
    case 'marquee': d.b = p; break;
  }
  schedDraw();
}
function onUp(e) {
  if (!st || !st.drag) return;
  const d = st.drag;
  st.drag = null;
  $('boardCanvas').style.cursor = cursorFor();
  switch (d.t) {
    case 'pan': scheduleSave(); break;
    case 'pen': pushSnap(); st.els.push(d.el); changed(); break;
    case 'erase': break;
    case 'create': finishCreate(d, e && e.shiftKey); break;
    case 'move':
      if (d.moved) changed();
      else if (!d.shift && st.sel.length > 1) { st.sel = [d.hitId]; updateUi(); draw(); }
      break;
    case 'resize': if (d.moved) changed(); break;
    case 'marquee': {
      const x1 = Math.min(d.a[0], d.b[0]), x2 = Math.max(d.a[0], d.b[0]), y1 = Math.min(d.a[1], d.b[1]), y2 = Math.max(d.a[1], d.b[1]);
      if (x2 - x1 > 2 / st.view.z || y2 - y1 > 2 / st.view.z) {
        const ids = st.els.filter((el) => { const b = bbox(el); return b.x <= x2 && b.x + b.w >= x1 && b.y <= y2 && b.y + b.h >= y1; }).map((el) => el.id);
        st.sel = d.keep.concat(ids.filter((id) => d.keep.indexOf(id) < 0));
      }
      updateUi(); draw();
      break;
    }
  }
  updateUi();
}
function onDbl(e) {
  if (!st || st.readonly || st.tool !== 'select') return;
  const p = wld(scr(e)), h = topHit(p);
  if (h && hasText(h)) startEdit(h, {});
  else if (!h) newText(p);
}
function onWheel(e) {
  if (!st) return;
  e.preventDefault();
  const s = scr(e);
  if (e.deltaX && !e.ctrlKey) {
    st.view.x += e.deltaX / st.view.z; st.view.y += e.deltaY / st.view.z; viewChanged();
  } else if (e.shiftKey && !e.ctrlKey) {
    st.view.x += e.deltaY / st.view.z; viewChanged();
  } else {
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), s[0], s[1]);
  }
}

/* ---------- панель ---------- */
function toolbarHtml() {
  const tools = TOOLS.map((t) => '<button class="bt" data-b="tool" data-v="' + t[0] + '" title="' + t[1] + ' (' + t[2] + ')">' + t[1] + '</button>').join('');
  const colors = INK.map((c) => '<button class="sw" data-b="color" data-v="' + c[0] + '" style="background:' + c[0] + '" aria-label="' + c[1] + '" title="' + c[1] + '"></button>').join('');
  const fills = FILLS.map((c) => '<button class="sw' + (c[0] ? '' : ' none') + '" data-b="fill" data-v="' + (c[0] || 'none') + '"' + (c[0] ? ' style="background:' + c[0] + '"' : '') + ' aria-label="' + c[1] + '" title="Заливка: ' + c[1] + '"></button>').join('');
  const widths = WIDTHS.map((w) => '<button class="bt" data-b="width" data-v="' + w[0] + '">' + w[1] + '</button>').join('');
  const bg = '<select id="bBg" aria-label="Фон">' + BGS.map((b) => '<option value="' + b[0] + '">' + b[1] + '</option>').join('') + '</select>';
  return '<div class="bt-group" role="group" aria-label="Инструменты">' + tools + '</div>'
    + '<div class="bt-group" role="group" aria-label="Цвет">' + colors + '</div>'
    + '<div class="bt-group" role="group" aria-label="Заливка">' + fills + '</div>'
    + '<div class="bt-group" role="group" aria-label="Толщина">' + widths + '</div>'
    + '<div class="bt-group"><button class="bt" data-b="undo" id="bUndo" title="Ctrl+Z">Отменить</button><button class="bt" data-b="redo" id="bRedo" title="Ctrl+Shift+Z или Ctrl+Y">Вернуть</button>'
    + '<button class="bt" data-b="dup" id="bDup" title="Ctrl+D">Дублировать</button><button class="bt" data-b="delsel" id="bDelSel" title="Delete или Backspace">Удалить</button>'
    + '<button class="bt" data-b="clear" id="bClear">Очистить доску</button></div>'
    + '<div class="bt-group">' + bg + '</div>';
}
function styleOf() {
  const e = st.edit ? null : selEls()[0];
  if (!e) return { c: st.color, f: st.fill, sw: st.width };
  return { c: e.c, f: e.f || null, sw: e.sw };
}
function updateUi() {
  if (!st) return;
  const sv = styleOf();
  document.querySelectorAll('#boardTools [data-b="tool"]').forEach((b) => b.classList.toggle('on', b.dataset.v === st.tool));
  document.querySelectorAll('#boardTools [data-b="color"]').forEach((b) => b.classList.toggle('on', b.dataset.v === sv.c));
  document.querySelectorAll('#boardTools [data-b="fill"]').forEach((b) => b.classList.toggle('on', b.dataset.v === (sv.f || 'none')));
  document.querySelectorAll('#boardTools [data-b="width"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === sv.sw));
  $('bUndo').disabled = !st.hist.u.length;
  $('bRedo').disabled = !st.hist.r.length;
  $('bDup').disabled = !st.sel.length;
  $('bDelSel').disabled = !st.sel.length;
  $('bClear').disabled = !st.els.length;
  $('bBg').value = st.bg;
  const bw = $('bWrite');
  if (bw) { bw.hidden = !(st.sync && st.sync.role === 'tutor'); bw.textContent = 'Ученик рисует: ' + (st.canWrite ? 'да' : 'нет'); }
  if (!st.drag) $('boardCanvas').style.cursor = cursorFor();
  zoomLabel();
}
function arm(btn, ask, fn) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; fn(); return; }
  btn.dataset.armed = '1'; btn.dataset.orig = btn.textContent; btn.textContent = ask;
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; } }, 3500);
}
function onTools(e) {
  const b = e.target.closest('[data-b]');
  if (!st || !b || st.readonly) return;
  const v = b.dataset.v;
  switch (b.dataset.b) {
    case 'tool': commitEdit(); st.tool = v; if (v !== 'select') st.sel = []; draw(); break;
    case 'color': setStyle('c', v); break;
    case 'fill': setStyle('f', v === 'none' ? null : v); break;
    case 'width': setStyle('sw', Number(v)); break;
    case 'undo': undo(); break;
    case 'redo': redo(); break;
    case 'dup': dupSel(); break;
    case 'delsel': delSel(); break;
    case 'clear': arm(b, 'Очистить всё?', () => { if (st.els.length) { pushSnap(); st.els = []; st.sel = []; changed(); } }); return;
  }
  if (document.activeElement && document.activeElement.blur && b.tagName === 'BUTTON') document.activeElement.blur();
  updateUi();
}
function onKey(e) {
  if (!st) return;
  const tag = e.target && e.target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'INPUT') return;
  if (st.readonly) { roKey(e); return; }
  if (e.code === 'Space') { e.preventDefault(); if (!st.space) { st.space = true; $('boardCanvas').style.cursor = cursorFor(); } return; }
  if (e.ctrlKey || e.metaKey) {
    const k = e.code;
    if (k === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k === 'KeyY') { e.preventDefault(); redo(); }
    else if (k === 'KeyC') { e.preventDefault(); copySel(); }
    else if (k === 'KeyV') { e.preventDefault(); pasteClip(); }
    else if (k === 'KeyD') { e.preventDefault(); dupSel(); }
    else if (k === 'KeyA') { e.preventDefault(); st.tool = 'select'; st.sel = st.els.map((x) => x.id); updateUi(); draw(); }
    else if (k === 'Digit0' || k === 'Numpad0') { e.preventDefault(); st.view.z = 1; viewChanged(); }
    else if (k === 'Digit1') { e.preventDefault(); fit(); }
    else if (k === 'Digit2') { e.preventDefault(); fitSel(); }
    else if (k === 'Equal' || k === 'NumpadAdd') { e.preventDefault(); zoomAt(1.25, st.w / 2, st.h / 2); }
    else if (k === 'Minus' || k === 'NumpadSubtract') { e.preventDefault(); zoomAt(0.8, st.w / 2, st.h / 2); }
    return;
  }
  if (e.code === 'Escape') {
    if (st.tool !== 'select') { st.tool = 'select'; updateUi(); }
    else if (st.sel.length) { st.sel = []; updateUi(); draw(); }
    else close();
    return;
  }
  if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); delSel(); return; }
  if (e.code === 'PageUp' || e.code === 'BracketRight') { e.preventDefault(); toFront(false); return; }
  if (e.code === 'PageDown' || e.code === 'BracketLeft') { e.preventDefault(); toFront(true); return; }
  if (e.code === 'KeyG') { st.bg = st.bg === 'plain' ? (st.prevBg || 'dots') : (st.prevBg = st.bg, 'plain'); draw(); scheduleSave(); sendBg(); updateUi(); return; }
  if (e.code === 'Enter' || e.code === 'F2') {
    const one = selEls();
    if (one.length === 1 && hasText(one[0])) { e.preventDefault(); startEdit(one[0], {}); }
    return;
  }
  if (e.code.indexOf('Arrow') === 0) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1, dx = e.code === 'ArrowLeft' ? -step : e.code === 'ArrowRight' ? step : 0, dy = e.code === 'ArrowUp' ? -step : e.code === 'ArrowDown' ? step : 0;
    const sel = selEls();
    if (!sel.length) { st.view.x += dx * 50 / st.view.z; st.view.y += dy * 50 / st.view.z; viewChanged(); return; }
    const now = Date.now();
    if (now - (st.nudgeAt || 0) > 800) pushSnap();
    st.nudgeAt = now;
    sel.forEach((el) => moveEl(el, copyEl(el), dx, dy));
    changed();
    return;
  }
  if ((e.code === 'Equal' || e.code === 'NumpadAdd') && !e.altKey) { zoomAt(1.25, st.w / 2, st.h / 2); return; }
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') { zoomAt(0.8, st.w / 2, st.h / 2); return; }
  if (e.code === 'KeyL' && e.shiftKey) { commitEdit(); st.tool = 'arrow'; st.sel = []; draw(); updateUi(); return; }
  if (KEYS[e.code] && !e.altKey && !e.shiftKey) { commitEdit(); st.tool = KEYS[e.code]; if (st.tool !== 'select') st.sel = []; draw(); updateUi(); }
}
function onKeyUp(e) {
  if (st && e.code === 'Space') { st.space = false; $('boardCanvas').style.cursor = cursorFor(); }
}

function attachOnce() {
  if (attached) return;
  attached = true;
  const cv = $('boardCanvas'), ta = $('boardText');
  cv.addEventListener('pointerdown', onDown);
  cv.addEventListener('pointermove', onMove);
  cv.addEventListener('pointerup', onUp);
  cv.addEventListener('pointercancel', onUp);
  cv.addEventListener('dblclick', onDbl);
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', onWheel, { passive: false });
  $('boardTools').addEventListener('click', onTools);
  $('boardTools').addEventListener('change', (e) => {
    if (st && !st.readonly && e.target.id === 'bBg') { st.bg = e.target.value; draw(); scheduleSave(); sendBg(); }
  });
  $('boardZoom').addEventListener('click', (e) => {
    const b = e.target.closest('[data-z]');
    if (!st || !b) return;
    if (b.dataset.z === 'in') zoomAt(1.25, st.w / 2, st.h / 2);
    else if (b.dataset.z === 'out') zoomAt(0.8, st.w / 2, st.h / 2);
    else if (b.dataset.z === 'reset') { st.view.z = 1; viewChanged(); }
    else fit();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  });
  $('boardSym').addEventListener('mousedown', (e) => { if (e.target.closest('[data-b="sym"]')) e.preventDefault(); });
  $('boardSym').addEventListener('click', (e) => {
    const b = e.target.closest('[data-b="sym"]');
    if (!b || !st || !st.edit) return;
    ta.setRangeText(b.dataset.v, ta.selectionStart, ta.selectionEnd, 'end');
    layoutTa();
    ta.focus();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commitEdit(); }
  });
  ta.addEventListener('input', layoutTa);
  ta.addEventListener('blur', commitEdit);
  const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
  on('bClose', 'click', () => close());
  on('bExport', 'click', exportPng);
  on('bShare', 'click', () => { if (st && st.onShare) st.onShare(); });
  on('bLink', 'click', () => {
    if (st && st.shareLink && window.api && window.api.copy) window.api.copy(st.shareLink).then(() => { if (window.toast) window.toast('Ссылка для ученика скопирована'); });
  });
  on('bWrite', 'click', () => { if (st && st.sync && st.sync.ready && st.sync.role === 'tutor') st.sync.send({ t: 'perm', write: !st.canWrite }); });
  document.addEventListener('keydown', onKey);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('beforeunload', () => {
    if (st) { commitEdit(); if (st.dirty) { st.dirty = false; try { window.api.boardSaveSync(st.id, serialize()); } catch (e) { /* ignore */ } } }
  });
  if (window.ResizeObserver) new ResizeObserver(() => { if (st) resize(); }).observe($('boardStage'));
  window.addEventListener('resize', () => { if (st) resize(); });
}

/* ---------- открыть, закрыть, экспорт ---------- */
async function open(opts) {
  if (st) return;
  attachOnce();
  const s = st = {
    id: opts.id, title: opts.title || '', onContent: opts.onContent, onClose: opts.onClose,
    els: [], sel: [], bg: 'dots', view: { x: -400, y: -250, z: 1 }, tool: 'select', color: INK[0][0], fill: null, width: 4,
    hist: { u: [], r: [] }, drag: null, edit: null, space: false, dirty: false, timer: 0, w: 0, h: 0, dpr: 1, pasteN: 0,
    focus: document.activeElement, sync: null, readonly: false, canWrite: true, onShare: opts.onShare || null, shareLink: '', sharing: false, liveState: '',
  };
  $('boardTitle').textContent = s.title;
  $('boardTools').innerHTML = toolbarHtml();
  { const sh = $('bShare'), lk = $('bLink'), wr = $('bWrite'), lv = $('boardLive');
    if (sh) { sh.hidden = !s.onShare; sh.textContent = 'Совместная доска'; }
    if (lk) lk.hidden = true;
    if (wr) wr.hidden = true;
    if (lv) { lv.textContent = ''; lv.hidden = true; }
    $('board').classList.remove('ro'); }
  $('board').hidden = false;
  document.documentElement.style.overflow = 'hidden';
  setStatus('');
  resize(); updateUi();
  let loaded = null;
  try {
    const r = await window.api.boardLoad(opts.id);
    if (st !== s) return;
    if (r && r.data) { loaded = sanitizeData(r.data); setStatus('Сохранено'); }
  } catch (e) { /* пустая доска */ }
  if (st !== s) return;
  if (loaded) {
    s.els = loaded.els; s.bg = loaded.bg;
    if (loaded.view) s.view = loaded.view;
    else { fit(); }
  }
  if (!s.els.length && !(loaded && loaded.view)) s.view = { x: -s.w / 2, y: -s.h / 2, z: 1 };
  resize(); updateUi();
}
async function close() {
  if (!st) return;
  commitEdit();
  const s = st;
  await flush();
  if (s.sync) { clearInterval(s.sync.timer); s.sync = null; }
  st = null;
  $('board').hidden = true;
  document.documentElement.style.overflow = '';
  try { if (s.focus && s.focus.focus) s.focus.focus(); } catch (e) { /* ignore */ }
  if (s.onClose) s.onClose();
}
function exportPng() {
  if (!st) return;
  commitEdit();
  if (!st.els.length) { if (window.toast) window.toast('Доска пустая'); return; }
  const b = selRect(st.els), pad = 40;
  const bw = b.w + pad * 2, bh = b.h + pad * 2;
  const sc = Math.min(2, 4000 / Math.max(bw, bh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(bw * sc)); c.height = Math.max(1, Math.ceil(bh * sc));
  const ctx = c.getContext('2d');
  ctx.scale(sc, sc); ctx.translate(-(b.x - pad), -(b.y - pad));
  drawBg(ctx, st.bg, b.x - pad, b.y - pad, bw, bh, sc);
  st.els.forEach((el) => drawEl(ctx, el, false));
  const name = (st.title || 'доска').replace(/[\\/:*?"<>|]/g, '').trim() + '.png';
  window.api.savePng(name, c.toDataURL('image/png')).then(
    (r) => { if (r && r.ok && window.toast) window.toast('Картинка сохранена'); },
    () => { if (window.toast) window.toast('Не удалось сохранить картинку'); });
}

/* ---------- совместная работа ---------- */
function roKey(e) {
  const k = e.code, c = e.ctrlKey || e.metaKey;
  const stop = () => e.preventDefault();
  if (k === 'Space') { stop(); st.space = true; $('boardCanvas').style.cursor = cursorFor(); }
  else if (k === 'Equal' || k === 'NumpadAdd') { stop(); zoomAt(1.25, st.w / 2, st.h / 2); }
  else if (k === 'Minus' || k === 'NumpadSubtract') { stop(); zoomAt(0.8, st.w / 2, st.h / 2); }
  else if (c && (k === 'Digit0' || k === 'Numpad0')) { stop(); st.view.z = 1; viewChanged(); }
  else if (c && k === 'Digit1') { stop(); fit(); }
  else if (k.indexOf('Arrow') === 0) {
    stop();
    st.view.x += (k === 'ArrowLeft' ? -50 : k === 'ArrowRight' ? 50 : 0) / st.view.z;
    st.view.y += (k === 'ArrowUp' ? -50 : k === 'ArrowDown' ? 50 : 0) / st.view.z;
    viewChanged();
  }
}
function renderLive() {
  const e = $('boardLive');
  if (!e || !st) return;
  const s = st.liveState, n = st.sync ? st.sync.peers : 0;
  const t = s === 'connecting' ? 'Подключение…' : s === 'online' ? 'Онлайн' + (n > 1 ? ', участников: ' + n : ', пока один') :
    s === 'offline' ? 'Нет связи, переподключаюсь…' : s === 'denied' ? 'Доступ закрыт' : s === 'full' ? 'Комната заполнена' : '';
  e.textContent = t; e.hidden = !t;
}
function liveStatus(s) { if (!st) return; st.liveState = s || ''; renderLive(); }
function setReadonly(ro) {
  if (st.readonly === ro) return;
  st.readonly = ro;
  const b = $('board'); if (b) b.classList.toggle('ro', ro);
  if (ro) { commitEdit(); st.tool = 'hand'; st.sel = []; st.drag = null; } else if (st.tool === 'hand') st.tool = 'select';
  draw(); updateUi();
}
function setWrite(w) {
  st.canWrite = w;
  setReadonly(!!(st.sync && st.sync.role !== 'tutor' && !w));
  updateUi();
}
function sendBg() { const sy = st && st.sync; if (sy && sy.ready && !st.readonly) sy.send({ t: 'ops', set: [], del: [], bg: st.bg }); }
function syncTick() {
  const sy = st && st.sync;
  if (!sy || !sy.ready) return;
  const now = Date.now();
  let gone = false;
  Object.keys(sy.cursors).forEach((id) => { if (now - sy.cursors[id].t > 6000) { delete sy.cursors[id]; gone = true; } });
  if (gone) draw();
  if (!sy.touched) return;
  sy.touched = false;
  if (st.readonly) return;
  const set = [], del = [], seen = {};
  st.els.forEach((el) => {
    seen[el.id] = 1;
    const js = JSON.stringify(el);
    if (sy.last.get(el.id) !== js) { set.push(el); sy.last.set(el.id, js); }
  });
  sy.last.forEach((v, id) => { if (!seen[id]) del.push(id); });
  del.forEach((id) => sy.last.delete(id));
  for (let i = 0; i < set.length; i += 200) sy.send({ t: 'ops', set: set.slice(i, i + 200), del: [] });
  for (let i = 0; i < del.length; i += 1000) sy.send({ t: 'ops', set: [], del: del.slice(i, i + 1000) });
}
function applyRemote(m) {
  const sy = st.sync;
  (Array.isArray(m.set) ? m.set : []).forEach((e) => {
    const c = cleanEl(e);
    if (!c) return;
    const i = st.els.findIndex((x) => x.id === c.id);
    if (i >= 0) st.els[i] = c; else st.els.push(c);
    sy.last.set(c.id, JSON.stringify(c));
    sy.remote.add(c.id);
  });
  (Array.isArray(m.del) ? m.del : []).forEach((id) => {
    if (typeof id !== 'string') return;
    const i = st.els.findIndex((x) => x.id === id);
    if (i >= 0) st.els.splice(i, 1);
    sy.last.delete(id);
  });
  if (BGS.some((b) => b[0] === m.bg)) st.bg = m.bg;
  st.sel = st.sel.filter((id) => byId(id));
  if (st.edit && !editEl()) closeEdit();
  draw(); scheduleSave(); updateUi();
}
function connect(send) {
  if (!st) return;
  if (st.sync) clearInterval(st.sync.timer);
  const sy = st.sync = { send: send, last: new Map(), ready: false, role: null, cursors: {}, peers: 0, touched: false, curAt: 0, remote: new Set(), timer: 0 };
  sy.timer = setInterval(syncTick, 120);
  liveStatus('connecting');
}
function disconnect() {
  if (!st || !st.sync) return;
  clearInterval(st.sync.timer);
  st.sync = null;
  liveStatus('offline');
  draw(); updateUi();
}
function receive(m) {
  if (!st || !st.sync || !m || typeof m !== 'object') return;
  const sy = st.sync;
  switch (m.t) {
    case 'hello': {
      sy.role = m.role === 'tutor' ? 'tutor' : 'student';
      const server = new Map();
      (Array.isArray(m.els) ? m.els : []).forEach((e) => { const c = cleanEl(e); if (c) server.set(c.id, c); });
      const hadLocal = st.els.length > 0;
      const localOnly = st.els.filter((e) => !server.has(e.id));
      st.els = Array.from(server.values()).concat(localOnly);
      server.forEach((c, id) => sy.last.set(id, JSON.stringify(c)));
      if (server.size || sy.role === 'student') { if (BGS.some((b) => b[0] === m.bg)) st.bg = m.bg; }
      else if (st.bg !== m.bg) sy.send({ t: 'ops', set: [], del: [], bg: st.bg });
      sy.ready = true; sy.touched = true;
      st.sel = st.sel.filter((id) => byId(id));
      liveStatus('online');
      setWrite(m.write !== false);
      if (server.size && !hadLocal) fit(); else draw();
      scheduleSave(); updateUi();
      break;
    }
    case 'ops': applyRemote(m); break;
    case 'perm': setWrite(m.write !== false); break;
    case 'peers': {
      const list = Array.isArray(m.list) ? m.list : [];
      sy.peers = list.length;
      const ids = {}; list.forEach((p) => { ids[p.id] = 1; });
      Object.keys(sy.cursors).forEach((id) => { if (!ids[id]) delete sy.cursors[id]; });
      renderLive(); draw();
      break;
    }
    case 'cur':
      if (num(m.x) && num(m.y) && num(m.id)) { sy.cursors[m.id] = { x: m.x, y: m.y, role: m.role === 'tutor' ? 'tutor' : 'student', t: Date.now() }; schedDraw(); }
      break;
    case 'error': liveStatus(m.code === 'full' ? 'full' : 'denied'); break;
    case 'deny': if (window.toast) window.toast('Сейчас рисовать нельзя'); break;
  }
}
function setShare(on, info) {
  if (!st) return;
  st.sharing = !!on; st.shareLink = on && info && info.link ? info.link : '';
  const sh = $('bShare'), lk = $('bLink');
  if (sh) sh.textContent = on ? 'Остановить совместную' : 'Совместная доска';
  if (lk) lk.hidden = !on;
  updateUi();
}

window.Board = { connect: connect, disconnect: disconnect, receive: receive, liveStatus: liveStatus, setShare: setShare, open: open, close: close, _s: () => st, _t: { hit: hit, bbox: bbox, moveEl: moveEl, resizeEl: resizeEl, sanitizeData: sanitizeData, wrap: wrap } };
})();
