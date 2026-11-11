(function () {
'use strict';
/* Страница ученика и родителей: расписание, переносы с причинами, домашнее задание. Только чтение, кроме отметки «сдал(а)». */
const m = location.pathname.match(/^\/s\/([A-Za-z0-9_-]{20,64})\/?$/);
const root = document.getElementById('root');
const pad = (n) => String(n).padStart(2, '0');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const parseYmd = (s) => { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const fmtDM = (d) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(d);
const fmtWd = (d) => cap(new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(d));
const fmtShort = (s) => { const d = parseYmd(s); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1); };
const dayTime = (date, time) => { const d = parseYmd(date); return fmtWd(d) + ', ' + fmtDM(d) + (time ? ', ' + time : ''); };
const lessonStart = (l) => { const d = parseYmd(l.date); const t = String(l.time || '00:00').split(':').map(Number); d.setHours(t[0] || 0, t[1] || 0, 0, 0); return d; };
const lessonEnd = (l) => new Date(lessonStart(l).getTime() + (l.dur || 60) * 60000);
const endTime = (l) => { const t = String(l.time || '00:00').split(':').map(Number); const mm = (t[0] || 0) * 60 + (t[1] || 0) + (l.dur || 60); return pad(Math.floor(mm / 60) % 24) + ':' + pad(mm % 60); };
const byStart = (a, b) => lessonStart(a) - lessonStart(b);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function add(parent) { for (let i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }
function bold(prefix, strong, suffix) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(prefix));
  d.appendChild(el('b', '', strong));
  if (suffix) d.appendChild(document.createTextNode(suffix));
  return d;
}

let data = null, key = '', busy = false, stopped = false, loadedAt = null;

function chip(l) {
  return data.pay ? el('span', 'chip ' + (l.paid ? 'ok' : 'bad'), l.paid ? 'Оплачен' : 'Не оплачен') : null;
}
function boardBtn(l) {
  if (!l.room) return null;
  const a = el('a', 'btn', 'Открыть доску урока');
  a.href = '/r/' + l.room.id + '?k=' + l.room.sk;
  a.target = '_blank'; a.rel = 'noopener';
  return a;
}
function lessonItem(l) {
  const li = el('li', 'les');
  const w = el('div', 'when'); add(w, el('b', '', l.time), el('span', '', endTime(l)));
  const c = el('div');
  add(c, el('div', 'd', dayTime(l.date)));
  if (l.topic) add(c, el('div', 't', l.topic));
  if (l.movedFrom) add(c, el('div', 'note', 'Перенесён с ' + dayTime(l.movedFrom, l.movedFromTime)));
  add(c, chip(l), boardBtn(l));
  return add(li, w, c);
}
function movedItem(l) {
  const li = el('li', 'mv');
  add(li, el('div', 'd', dayTime(l.date, l.time)));
  if (l.movedTo) add(li, bold('Перенесён на ', dayTime(l.movedTo, l.movedToTime)));
  else add(li, el('div', 't', 'Урок отменён'));
  if (l.reason) add(li, el('div', 'note', 'Причина: ' + l.reason));
  return li;
}
function hwItem(h) {
  const li = el('li', 'hw');
  const meta = el('div', 'meta');
  if (h.due) { meta.appendChild(document.createTextNode('Срок: ')); meta.appendChild(el('b', '', fmtDM(parseYmd(h.due)))); }
  else meta.appendChild(document.createTextNode('Без срока'));
  if (h.status === 'submitted') meta.appendChild(document.createTextNode(' · сдано, репетитор проверяет'));
  add(li, meta, el('div', 'txt', h.text));
  const b = el('button', h.status === 'submitted' ? 'btn' : 'btn primary', h.status === 'submitted' ? 'Снять отметку «сдано»' : 'Я сдал(а)');
  b.type = 'button';
  b.addEventListener('click', () => mark(h, b));
  return add(li, b);
}
function section(parent, title, items, none) {
  if (!items.length && !none) return;
  add(parent, el('h2', '', title));
  if (items.length) { const ul = el('ul'); items.forEach((i) => ul.appendChild(i)); parent.appendChild(ul); }
  else parent.appendChild(el('p', 'empty', none));
}
function render() {
  const d = data, now = new Date(), from = new Date(now.getTime() - 30 * 86400000);
  const fromStr = from.getFullYear() + '-' + pad(from.getMonth() + 1) + '-' + pad(from.getDate());
  const upcoming = d.lessons.filter((l) => l.status === 'planned' && lessonEnd(l) >= now).sort(byStart);
  const moved = d.lessons.filter((l) => l.status === 'cancelled' && l.date >= fromStr).sort(byStart).reverse();
  const past = d.lessons.filter((l) => l.status === 'done').sort(byStart).reverse().slice(0, 5);
  const hwOpen = d.homework.filter((h) => h.status !== 'checked').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.created - b.created);
  const hwDone = d.homework.filter((h) => h.status === 'checked').sort((a, b) => b.created - a.created).slice(0, 3);
  const main = el('div');
  add(main, el('p', 'eyebrow', 'Занятия'), el('h1', '', d.student.name));
  if (d.student.grade) add(main, el('p', 'grade', d.student.grade));
  section(main, 'Ближайшие уроки', upcoming.map(lessonItem), 'Пока уроков в расписании нет.');
  section(main, 'Переносы и отмены', moved.map(movedItem), '');
  section(main, 'Домашнее задание', hwOpen.map(hwItem), 'Сейчас заданий нет.');
  section(main, 'Проверено', hwDone.map((h) => { const li = el('li', 'hw'); return add(li, el('div', 'txt', h.text)); }), '');
  section(main, 'Недавние уроки', past.map((l) => {
    const li = el('li', 'les'), w = el('div', 'when'), c = el('div');
    add(w, el('b', '', fmtShort(l.date)));
    add(c, el('div', 't', l.topic || 'Урок'), chip(l), boardBtn(l));
    return add(li, w, c);
  }), '');
  const foot = el('p', 'foot', 'Обновлено в ' + pad(loadedAt.getHours()) + ':' + pad(loadedAt.getMinutes()) + '. Страница обновляется сама. ');
  const r = el('button', 'btn', 'Обновить'); r.type = 'button'; r.addEventListener('click', load);
  add(foot, r);
  add(main, foot);
  root.replaceChildren(main);
}
function message(text, isErr) { root.replaceChildren(el('p', isErr ? 'state err' : 'state', text)); }

async function load() {
  if (busy || stopped) return;
  busy = true;
  try {
    const r = await fetch('/v/' + key + '/data', { cache: 'no-store' });
    if (r.status === 404) { stopped = true; message('Эта ссылка больше не действует. Попросите репетитора прислать новую.', true); return; }
    if (r.status === 429) { if (!data) message('Слишком много запросов. Подождите минуту и обновите страницу.', true); return; }
    if (!r.ok) throw new Error('http');
    data = await r.json(); loadedAt = new Date();
    render();
  } catch (e) {
    if (!data) message('Не удалось загрузить. Проверьте интернет и обновите страницу.', true);
  } finally { busy = false; }
}
async function mark(h, btn) {
  btn.disabled = true;
  try {
    const status = h.status === 'submitted' ? 'given' : 'submitted';
    const r = await fetch('/v/' + key + '/hw/' + encodeURIComponent(h.id), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: status }) });
    if (!r.ok) throw new Error('http');
    const j = await r.json();
    data.homework = data.homework.map((x) => (x.id === j.id ? j : x));
    render();
  } catch (e) { btn.disabled = false; alert('Не получилось сохранить отметку. Попробуйте ещё раз.'); }
}

if (!m) message('Ссылка неполная. Попросите репетитора прислать её ещё раз.', true);
else {
  key = m[1];
  load();
  setInterval(() => { if (!document.hidden) load(); }, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
}
})();
