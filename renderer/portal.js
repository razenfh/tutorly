(function () {
'use strict';
/* Вход и роли: «я ученик», «я родитель», «я учитель». Здесь же кабинет ученика и родителя: курсы как в Classroom.
   Учитель после входа работает в основной программе (app.js), этот файл только пускает его туда. */

const root = document.getElementById('portal');
const B = () => window.AppBridge;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const parseYmd = (s) => { const p = String(s).split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const fmtDM = (d) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(d);
const fmtWd = (d) => cap(new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(d));
const fmtShort = (s) => { const d = parseYmd(s); return pad(d.getDate()) + '.' + pad(d.getMonth() + 1); };
const dayTime = (date, time) => { const d = parseYmd(date); return fmtWd(d) + ', ' + fmtDM(d) + (time ? ', ' + time : ''); };
const lessonStart = (l) => { const d = parseYmd(l.date); const t = String(l.time || '00:00').split(':').map(Number); d.setHours(t[0] || 0, t[1] || 0, 0, 0); return d; };
const lessonEnd = (l) => new Date(lessonStart(l).getTime() + (l.dur || 60) * 60000);
const endTime = (l) => { const t = String(l.time || '00:00').split(':').map(Number); const m = (t[0] || 0) * 60 + (t[1] || 0) + (l.dur || 60); return pad(Math.floor(m / 60) % 24) + ':' + pad(m % 60); };
const byStart = (a, b) => lessonStart(a) - lessonStart(b);
const COLORS = ['#2446C8', '#176F49', '#B9660B', '#8A3FB5', '#C23A33', '#0F7C8C'];
const colorOf = (s) => { let h = 0; String(s).split('').forEach((c) => { h = (h * 31 + c.charCodeAt(0)) >>> 0; }); return COLORS[h % COLORS.length]; };
const ROLE_NAME = { student: 'Ученик', parent: 'Родитель', teacher: 'Учитель' };
const toast = (m) => { if (window.toast) window.toast(m); };

const P = { view: '', role: 'student', mode: 'login', server: '', err: '', msg: '', busy: false, courses: [], cid: '', join: false, invite: false, cancel: false, pending: null, loaded: false };
let timer = 0, liveH = null;

function mkErr(code, msg) { return Object.assign(new Error(msg), { code: code }); }
function normServer(v) {
  let s = String(v || '').trim().replace(/\/+$/, '');
  if (!s) throw mkErr('input', 'Введите адрес сервера.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) { throw mkErr('input', 'Адрес сервера выглядит неправильно.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw mkErr('input', 'Адрес сервера должен начинаться с https://');
  return u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, ''));
}
async function api(method, path, body, opt) {
  opt = opt || {};
  const a = B().getAcct();
  const server = opt.server || (a && a.server), token = opt.token !== undefined ? opt.token : (a && a.token);
  let r;
  try {
    r = await fetch(server + path, { method: method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) { throw mkErr('net', 'Не удалось связаться с сервером. Проверьте адрес и интернет.'); }
  let j = {};
  try { j = await r.json(); } catch (e) { /* пусто */ }
  if (!r.ok) {
    if (r.status === 401 && token && !opt.noExpire) { expired(); throw mkErr('expired', 'Сессия закончилась. Войдите снова.'); }
    throw mkErr(j.error || 'http', j.message || ('Ошибка сервера ' + r.status + '.'));
  }
  return j;
}

/* ---------- маршрутизация ---------- */
function setInert(on) {
  ['#main', 'header.top', '#overlay'].forEach((sel) => { const e = document.querySelector(sel); if (e) e.inert = on; });
}
function hide() { stopTimer(); root.hidden = true; root.innerHTML = ''; setInert(false); P.view = ''; }
function show() { root.hidden = false; setInert(true); }
function route() {
  const a = B().getAcct();
  if (a && a.role !== 'teacher') { P.cancel = false; showHome(); return; }
  if (a && a.role === 'teacher') {
    if (a.token) { hide(); return; }
    showAuth('teacher', { msg: 'Сессия закончилась. Войдите снова.', cancel: true, mode: 'login', login: a.login });
    return;
  }
  if (B().isLocal() || B().hasLocalData()) { hide(); return; }
  showWelcome();
}
function showWelcome(o) {
  stopTimer(); P.view = 'welcome'; P.err = ''; P.cancel = !!(o && o.cancel); show(); render();
}
function showAuth(role, o) {
  o = o || {};
  stopTimer(); P.view = 'auth'; P.role = role; P.mode = o.mode || 'login'; P.err = ''; P.msg = o.msg || ''; P.cancel = !!o.cancel; P.prefLogin = o.login || '';
  P.server = P.server || B().lastServer() || (window.APP_CONFIG && window.APP_CONFIG.server) || '';
  P.invite = false; show(); render();
  const base = window.APP_CONFIG && window.APP_CONFIG.server;
  if (P.server || base) fetch((P.server || base).replace(/\/+$/, '') + '/auth/info').then((r) => r.json()).then((j) => { P.invite = !!j.teacherInvite; if (P.view === 'auth') keepRender(); }).catch(() => {});
}
function showPassword() { stopTimer(); P.view = 'password'; P.err = ''; show(); render(); }
function expired() {
  const a = B().getAcct();
  if (!a) return;
  if (a.role === 'teacher') { B().clearToken(); showAuth('teacher', { msg: 'Сессия закончилась. Войдите снова.', cancel: true, login: a.login }); }
  else { B().setAcct(null); showWelcome(); P.msg = 'Сессия закончилась. Войдите снова.'; render(); }
}

/* ---------- кабинет ученика и родителя ---------- */
function stopTimer() { clearInterval(timer); timer = 0; }
function startTimer() {
  stopTimer();
  timer = setInterval(() => { if (!document.hidden && (P.view === 'home' || P.view === 'course')) loadCourses(true); }, 30000);
}
async function loadCourses(silent) {
  if (P.busy) return;
  P.busy = true;
  try {
    const j = await api('GET', '/api/my/courses');
    P.courses = j.courses || []; P.loaded = true;
    if (P.view === 'course' && !P.courses.some((c) => c.cid === P.cid)) P.view = 'home';
    if (!silent || !root.contains(document.activeElement) || document.activeElement === document.body) render();
    else if (silent && !(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName))) render();
  } catch (e) {
    if (!silent && e.code !== 'expired') { P.err = e.message; render(); }
  } finally { P.busy = false; }
}
function showHome() { P.view = 'home'; P.err = ''; P.join = false; show(); render(); startTimer(); loadCourses(false); }

function chipPay(l) { return l.paid === undefined ? '' : '<span class="chip ' + (l.paid ? 'ok' : 'bad') + '">' + (l.paid ? 'Оплачен' : 'Не оплачен') + '</span>'; }
function boardBtn(c, l) {
  return l.room ? '<button class="btn small" data-p="board" data-cid="' + esc(c.cid) + '" data-lid="' + esc(l.id) + '">Открыть доску урока</button>' : '';
}
function upcoming(c) { const now = new Date(); return c.lessons.filter((l) => l.status === 'planned' && lessonEnd(l) >= now).sort(byStart); }
function renderCard(c) {
  const up = upcoming(c)[0], open = c.homework.filter((h) => h.status === 'given').length;
  const sub = c.as === 'parent' ? 'Ребёнок: ' + esc(c.student.name) : esc(c.teacher.name || 'Учитель');
  return '<button class="p-course" data-p="course" data-cid="' + esc(c.cid) + '"><span class="p-course-top" style="background:' + colorOf(c.cid) + '"><b>' + esc(c.title) + '</b><span>' + sub + (c.as === 'parent' ? ' · ' + esc(c.teacher.name) : '') + '</span></span>'
    + '<span class="p-course-body"><span>' + (up ? 'Ближайший урок: <b>' + esc(dayTime(up.date, up.time)) + '</b>' : 'Уроков в расписании нет') + '</span>'
    + '<span class="muted">' + (open ? 'Домашка к сдаче: ' + open : 'Домашки к сдаче нет') + '</span></span></button>';
}
function section(title, items, none) {
  if (!items.length && !none) return '';
  return '<h3 class="p-h">' + title + '</h3>' + (items.length ? '<ul class="p-list">' + items.join('') + '</ul>' : '<p class="muted">' + none + '</p>');
}
const pendingFor = (c, lid) => (c.requests || []).some((q) => q.lessonId === lid && q.status === 'pending');
const REQ_TXT = { pending: 'ждёт ответа', accepted: 'учитель перенёс урок', declined: 'учитель отказал' };
function renderCourse(c) {
  const now = new Date(), from = new Date(now.getTime() - 30 * 86400000);
  const fromStr = from.getFullYear() + '-' + pad(from.getMonth() + 1) + '-' + pad(from.getDate());
  const up = upcoming(c);
  const moved = c.lessons.filter((l) => l.status === 'cancelled' && l.date >= fromStr).sort(byStart).reverse();
  const past = c.lessons.filter((l) => l.status === 'done').sort(byStart).reverse().slice(0, 5);
  const open = c.homework.filter((h) => h.status !== 'checked').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.created - b.created);
  const done = c.homework.filter((h) => h.status === 'checked').sort((a, b) => b.created - a.created).slice(0, 3);
  const canMark = c.as === 'student';
  const reqs = (c.requests || []).slice(0, 5).map((q) => '<li class="p-mv"><div class="p-d">Хотели: ' + esc(dayTime(q.date, q.time)) + '</div><div class="muted">Причина: ' + esc(q.reason) + '</div><div class="' + (q.status === 'declined' ? 'p-reason' : '') + '">' + esc(REQ_TXT[q.status] || '') + (q.reply ? ': ' + esc(q.reply) : '') + '</div></li>');
  const boards = c.lessons.filter((l) => l.room && (l.status === 'done' || lessonEnd(l) < new Date())).sort(byStart).reverse();
  const boardItem = (l) => '<li class="p-les"><div class="p-when"><b>' + esc(fmtShort(l.date)) + '</b></div><div><div>' + esc(l.topic || 'Урок') + '</div>' + boardBtn(c, l) + '</div></li>';
  const lesson = (l) => '<li class="p-les"><div class="p-when"><b>' + esc(l.time) + '</b><span>' + esc(endTime(l)) + '</span></div><div><div class="p-d">' + esc(dayTime(l.date)) + '</div>' + (l.topic ? '<div>' + esc(l.topic) + '</div>' : '')
    + (l.movedFrom ? '<div class="muted">Перенесён с ' + esc(dayTime(l.movedFrom, l.movedFromTime)) + '</div>' : '') + chipPay(l) + boardBtn(c, l)
    + (pendingFor(c, l.id) ? '<div class="muted">Запрос на перенос отправлен</div>' : '<button class="btn small" data-p="req" data-cid="' + esc(c.cid) + '" data-lid="' + esc(l.id) + '">Попросить перенести</button>') + '</div></li>';
  const mv = (l) => '<li class="p-mv"><div class="p-d">' + esc(dayTime(l.date, l.time)) + '</div><div>' + (l.movedTo ? 'Перенесён на <b>' + esc(dayTime(l.movedTo, l.movedToTime)) + '</b>' : 'Урок отменён') + '</div>' + (l.reason ? '<div class="p-reason">Причина: ' + esc(l.reason) + '</div>' : '') + '</li>';
  const hw = (h) => '<li class="p-hw"><div class="muted">' + (h.due ? 'Срок: <b>' + esc(fmtDM(parseYmd(h.due))) + '</b>' : 'Без срока') + (h.status === 'submitted' ? ' · сдано, учитель проверяет' : '') + '</div><div class="p-txt">' + esc(h.text) + '</div>'
    + (canMark ? '<button class="btn small' + (h.status === 'submitted' ? '' : ' primary') + '" data-p="hw" data-cid="' + esc(c.cid) + '" data-id="' + esc(h.id) + '" data-st="' + (h.status === 'submitted' ? 'given' : 'submitted') + '">' + (h.status === 'submitted' ? 'Снять отметку «сдано»' : 'Я сдал(а)') + '</button>' : '') + '</li>';
  return '<div class="p-wrap"><div class="p-bar"><button class="btn small" data-p="back">← Мои курсы</button><span class="p-spacer"></span><button class="btn small" data-p="refresh">Обновить</button></div>'
    + '<div class="p-band" style="background:' + colorOf(c.cid) + '"><h2>' + esc(c.title) + '</h2><p>' + esc(c.as === 'parent' ? 'Ребёнок: ' + c.student.name : c.student.name) + ' · учитель ' + esc(c.teacher.name) + '</p></div>'
    + (c.as === 'parent' ? '<p class="muted p-note">Вы вошли как родитель: можно смотреть расписание, переносы и домашку.</p>' : '')
    + section('Ближайшие уроки', up.map(lesson), 'Пока уроков в расписании нет.')
    + section('Переносы и отмены', moved.map(mv), '')
    + section('Ваши запросы на перенос', reqs, '')
    + section('Домашнее задание', open.map(hw), 'Сейчас заданий нет.')
    + section('Проверено', done.map((h) => '<li class="p-hw"><div class="p-txt">' + esc(h.text) + '</div></li>'), '')
    + section('Недавние уроки', past.map((l) => '<li class="p-les"><div class="p-when"><b>' + esc(fmtShort(l.date)) + '</b></div><div><div>' + esc(l.topic || 'Урок') + '</div>' + chipPay(l) + boardBtn(c, l) + '</div></li>'), '')
    + section('Доски прошлых уроков', boards.map(boardItem), '')
    + '<p class="p-foot"><button class="btn small danger" data-p="leave" data-cid="' + esc(c.cid) + '">Покинуть курс</button></p></div>';
}

/* ---------- отрисовка ---------- */
function head(a) {
  return '<div class="p-bar"><div class="p-who"><b>' + esc(a.name) + '</b><span class="muted">' + ROLE_NAME[a.role] + '</span></div><span class="p-spacer"></span>'
    + '<button class="btn small primary" data-p="joinOpen">Присоединиться к курсу</button><button class="btn small" data-p="pwd">Пароль</button><button class="btn small" data-p="logout">Выйти</button></div>';
}
function render() {
  if (root.hidden) return;
  const a = B().getAcct();
  let h = '';
  if (P.view === 'welcome') {
    h = '<div class="p-wrap p-narrow"><h1 class="p-title">Журнал репетитора</h1><p class="p-sub">' + (P.msg ? esc(P.msg) : 'Кто вы? Выберите, как вы будете пользоваться программой.') + '</p>'
      + '<div class="p-roles"><button class="p-role" data-p="role" data-role="student"><b>Я ученик</b><span>Смотрю свои уроки, домашку и рисую на доске вместе с учителем</span></button>'
      + '<button class="p-role" data-p="role" data-role="parent"><b>Я родитель</b><span>Слежу за занятиями ребёнка: расписание, переносы, домашка</span></button>'
      + '<button class="p-role" data-p="role" data-role="teacher"><b>Я учитель</b><span>Веду курсы, расписание, оплаты, домашку и доску</span></button></div>'
      + '<p class="p-alt"><button class="link" data-p="local">Я репетитор, хочу работать только на этом компьютере, без сервера</button></p>'
      + (P.cancel ? '<p class="p-alt"><button class="link" data-p="cancel">Назад</button></p>' : '') + '</div>';
  } else if (P.view === 'auth') {
    const reg = P.mode === 'register', cfg = window.APP_CONFIG && window.APP_CONFIG.server;
    const title = { student: 'Вход для ученика', parent: 'Вход для родителя', teacher: 'Вход для учителя' }[P.role];
    const hint = reg ? (P.role === 'teacher' ? 'Создайте аккаунт учителя. Потом вы сможете заводить курсы и приглашать учеников по коду.' : P.role === 'student' ? 'После регистрации введите код курса, который дал учитель.' : 'После регистрации введите родительский код, который дал учитель.') : 'Введите логин и пароль, которые вы указали при регистрации.';
    const srv = '<div class="field"><label for="a-srv">Адрес сервера</label><input id="a-srv" type="text" autocomplete="off" placeholder="https://board.example.com" value="' + esc(P.server) + '"></div>';
    h = '<div class="p-wrap p-narrow"><p><button class="link" data-p="' + (P.cancel ? 'cancel' : 'welcome') + '">← Назад</button></p><h1 class="p-title">' + title + '</h1><p class="p-sub">' + esc(P.msg || hint) + '</p>'
      + '<form class="p-card p-form" data-form="auth" novalidate><div class="p-tabs"><button type="button" class="chip' + (!reg ? ' on' : '') + '" data-p="mode" data-mode="login">Войти</button><button type="button" class="chip' + (reg ? ' on' : '') + '" data-p="mode" data-mode="register">Создать аккаунт</button></div>'
      + (cfg ? '<details><summary class="muted">Сервер</summary>' + srv + '</details>' : srv)
      + (reg ? '<div class="field"><label for="a-name">' + (P.role === 'parent' ? 'Ваше имя' : 'Как вас зовут') + '</label><input id="a-name" type="text" maxlength="60" autocomplete="name"></div>' : '')
      + '<div class="field"><label for="a-login">Логин</label><input id="a-login" type="text" maxlength="32" autocomplete="username" autocapitalize="off" value="' + esc(P.prefLogin || '') + '"></div>'
      + '<div class="field"><label for="a-pass">Пароль</label><input id="a-pass" type="password" maxlength="128" autocomplete="' + (reg ? 'new-password' : 'current-password') + '"></div>'
      + (reg && P.role === 'teacher' && P.invite ? '<div class="field"><label for="a-inv">Код регистрации учителя</label><input id="a-inv" type="text" autocomplete="off"></div>' : '')
      + (P.err ? '<p class="err" role="alert">' + esc(P.err) + '</p>' : '')
      + '<button class="btn primary" type="submit"' + (P.busy ? ' disabled' : '') + '>' + (P.busy ? 'Подождите…' : reg ? 'Создать аккаунт' : 'Войти') + '</button>'
      + (reg ? '<p class="muted">Логин: от 3 символов, буквы и цифры. Пароль: от 6 символов. Почта не нужна. Если забудете пароль, его сбросит учитель или администратор сервера.</p>' : '') + '</form></div>';
  } else if (P.view === 'confirmWipe') {
    h = '<div class="p-wrap p-narrow"><h1 class="p-title">Другой аккаунт</h1><p class="p-sub">На этом компьютере сохранены данные другого учителя. Чтобы войти под новым аккаунтом, их нужно удалить с компьютера. Если они не были отправлены на сервер, они пропадут.</p>'
      + '<div class="p-actions"><button class="btn danger" data-p="wipeGo">Удалить данные и войти</button><button class="btn" data-p="cancelPending">Отмена</button></div></div>';
  } else if (P.view === 'password') {
    h = '<div class="p-wrap p-narrow"><p><button class="link" data-p="pwdBack">← Назад</button></p><h1 class="p-title">Смена пароля</h1><form class="p-card p-form" data-form="pwd" novalidate>'
      + '<div class="field"><label for="a-old">Старый пароль</label><input id="a-old" type="password" autocomplete="current-password"></div>'
      + '<div class="field"><label for="a-new">Новый пароль</label><input id="a-new" type="password" autocomplete="new-password"></div>'
      + (P.err ? '<p class="err" role="alert">' + esc(P.err) + '</p>' : '') + '<button class="btn primary" type="submit"' + (P.busy ? ' disabled' : '') + '>Сменить пароль</button></form></div>';
  } else if (P.view === 'home' && a) {
    const joinForm = (P.join || (P.loaded && !P.courses.length)) ? '<form class="p-card p-form p-join" data-form="join" novalidate><div class="field"><label for="a-code">' + (a.role === 'parent' ? 'Родительский код курса' : 'Код курса') + '</label><input id="a-code" type="text" maxlength="20" autocomplete="off" autocapitalize="characters" placeholder="K7M2-Q9XA-4B"></div>'
      + (P.err ? '<p class="err" role="alert">' + esc(P.err) + '</p>' : '') + '<div class="p-actions"><button class="btn primary" type="submit"' + (P.busy ? ' disabled' : '') + '>Присоединиться</button>' + (P.join ? '<button type="button" class="btn" data-p="joinClose">Отмена</button>' : '') + '</div></form>' : '';
    h = '<div class="p-wrap">' + head(a) + '<h1 class="p-title">Мои курсы</h1>' + joinForm
      + (!P.loaded ? '<p class="muted">Загрузка…</p>' : P.courses.length ? '<div class="p-courses">' + P.courses.map(renderCard).join('') + '</div>' : '<p class="muted">Пока нет ни одного курса. Введите код, который дал учитель.</p>')
      + (P.err && !joinForm ? '<p class="err" role="alert">' + esc(P.err) + '</p>' : '') + '</div>';
  } else if (P.view === 'request' && a) {
    const c = P.courses.find((x) => x.cid === P.cid), l = c && c.lessons.find((x) => x.id === P.lid);
    h = l ? '<div class="p-wrap p-narrow"><p><button class="link" data-p="reqBack">← Назад</button></p><h1 class="p-title">Перенос урока</h1><p class="p-sub">Сейчас: ' + esc(dayTime(l.date, l.time)) + '. Учитель увидит запрос и перенесёт урок или ответит.</p>'
      + '<form class="p-card p-form" data-form="req" novalidate><div class="field"><label for="r-date">Желаемая дата</label><input id="r-date" type="date" value="' + esc(l.date) + '"></div>'
      + '<div class="field"><label for="r-time">Желаемое время</label><input id="r-time" type="time" value="' + esc(l.time) + '"></div>'
      + '<div class="field"><label for="r-reason">Причина</label><textarea id="r-reason" rows="3" maxlength="300" placeholder="Например: болею, экзамен в школе"></textarea></div>'
      + (P.err ? '<p class="err" role="alert">' + esc(P.err) + '</p>' : '') + '<button class="btn primary" type="submit"' + (P.busy ? ' disabled' : '') + '>Отправить запрос</button></form></div>' : '';
  } else if (P.view === 'course' && a) {
    const c = P.courses.find((x) => x.cid === P.cid);
    h = c ? renderCourse(c) : '';
  }
  root.innerHTML = h;
  root.scrollTop = P.keepScroll ? root.scrollTop : root.scrollTop;
}
function keepRender() { const y = root.scrollTop; render(); root.scrollTop = y; }

/* ---------- действия ---------- */
async function submitAuth() {
  if (P.busy) return;
  const v = (id) => { const e = document.getElementById(id); return e ? e.value : ''; };
  const reg = P.mode === 'register';
  P.err = ''; P.msg = '';
  try {
    const server = normServer(document.getElementById('a-srv') ? v('a-srv') : P.server || (window.APP_CONFIG && window.APP_CONFIG.server));
    P.server = server; P.prefLogin = v('a-login');
    if (!v('a-login').trim() || !v('a-pass')) throw mkErr('input', 'Введите логин и пароль.');
    if (reg && !v('a-name').trim()) throw mkErr('input', 'Введите имя.');
    P.busy = true; keepRender();
    const body = reg ? { role: P.role, name: v('a-name'), login: v('a-login'), password: v('a-pass'), invite: v('a-inv') } : { login: v('a-login'), password: v('a-pass') };
    const j = await api('POST', reg ? '/auth/register' : '/auth/login', body, { server: server, token: '' });
    const acc = j.account, acct = { server: server, token: j.token, id: acc.id, role: acc.role, name: acc.name, login: acc.login };
    P.busy = false;
    if (acc.role === 'teacher' && B().ownerMismatch(acc.id)) { P.pending = acct; P.view = 'confirmWipe'; render(); return; }
    finishLogin(acct, reg);
  } catch (e) {
    P.busy = false; P.err = e.message || 'Не удалось войти.'; keepRender();
  }
}
function finishLogin(acct, fresh) {
  B().setAcct(acct);
  if (acct.role === 'teacher') { hide(); return; }
  P.courses = []; P.loaded = false; P.cid = '';
  showHome();
  if (fresh) { P.join = true; render(); }
}
async function submitJoin() {
  if (P.busy) return;
  const code = (document.getElementById('a-code') || {}).value || '';
  if (!code.trim()) { P.err = 'Введите код курса.'; keepRender(); return; }
  P.busy = true; P.err = ''; keepRender();
  try {
    const j = await api('POST', '/api/join', { code: code });
    P.busy = false; P.join = false;
    await loadCourses(true);
    P.cid = j.course.cid; P.view = 'course'; render(); root.scrollTop = 0;
    toast('Вы присоединились к курсу');
  } catch (e) { P.busy = false; if (e.code !== 'expired') { P.err = e.message; keepRender(); } }
}
async function submitReq() {
  if (P.busy) return;
  const v = (id) => (document.getElementById(id) || {}).value || '';
  const date = v('r-date'), time = v('r-time'), reason = v('r-reason').trim();
  if (!date || !time) { P.err = 'Укажите дату и время.'; keepRender(); return; }
  if (!reason) { P.err = 'Напишите причину.'; keepRender(); return; }
  P.busy = true; P.err = ''; keepRender();
  try {
    await api('POST', '/api/my/courses/' + P.cid + '/requests', { lessonId: P.lid, date: date, time: time, reason: reason });
    P.busy = false; await loadCourses(true); P.view = 'course'; render(); toast('Запрос отправлен учителю');
  } catch (e) { P.busy = false; if (e.code !== 'expired') { P.err = e.message; keepRender(); } }
}
async function submitPwd() {
  if (P.busy) return;
  const v = (id) => (document.getElementById(id) || {}).value || '';
  P.busy = true; P.err = ''; keepRender();
  try {
    await api('POST', '/auth/password', { old: v('a-old'), new: v('a-new') });
    P.busy = false; toast('Пароль изменён');
    pwdBack();
  } catch (e) { P.busy = false; if (e.code !== 'expired') { P.err = e.message; keepRender(); } }
}
function pwdBack() { const a = B().getAcct(); if (a && a.role !== 'teacher') showHome(); else hide(); }
async function logout() {
  const a = B().getAcct();
  if (a && a.token) { try { await api('POST', '/auth/logout', undefined, { noExpire: true }); } catch (e) { /* уже вышли */ } }
  if (liveH) { liveH.stop(); liveH = null; }
  B().setAcct(null);
  P.courses = []; P.loaded = false; P.msg = '';
  route();
}
function arm(el, ask, fn) {
  if (el.dataset.armed) { fn(); return; }
  el.dataset.armed = '1'; const o = el.textContent; el.textContent = ask;
  setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.textContent = o; } }, 3500);
}
async function openBoard(cid, lid) {
  const a = B().getAcct(), c = P.courses.find((x) => x.cid === cid), l = c && c.lessons.find((x) => x.id === lid);
  if (!l || !l.room || !window.Board || !window.Live) return;
  if (liveH) { liveH.stop(); liveH = null; }
  await window.Board.open({ id: l.room.id, title: c.title + ' · ' + dayTime(l.date, l.time), onClose: () => { if (liveH) { liveH.stop(); liveH = null; } } });
  liveH = window.Live.start({ server: a.server, room: l.room.id, key: l.room.sk, board: window.Board });
}
async function setHw(cid, id, st, btn) {
  btn.disabled = true;
  try {
    const h = await api('POST', '/api/my/courses/' + cid + '/hw/' + encodeURIComponent(id), { status: st });
    const c = P.courses.find((x) => x.cid === cid);
    if (c) c.homework = c.homework.map((x) => (x.id === h.id ? h : x));
    keepRender();
  } catch (e) { btn.disabled = false; if (e.code !== 'expired') toast(e.message); }
}

const A = {
  req: (d) => { P.cid = d.cid; P.lid = d.lid; P.view = 'request'; P.err = ''; render(); root.scrollTop = 0; },
  reqBack: () => { P.view = 'course'; P.err = ''; render(); },
  role: (d) => showAuth(d.role, { mode: 'login' }),
  welcome: () => showWelcome(),
  cancel: () => { P.msg = ''; route(); if (P.cancel) { P.cancel = false; hide(); } },
  local: () => B().setLocal(),
  mode: (d) => { P.mode = d.mode; P.err = ''; P.msg = ''; keepRender(); },
  wipeGo: () => { const acct = P.pending; P.pending = null; B().wipeLocal(); finishLogin(acct, false); },
  cancelPending: () => { P.pending = null; showAuth('teacher', { mode: 'login', cancel: P.cancel }); },
  joinOpen: () => { P.join = true; P.err = ''; keepRender(); const e = document.getElementById('a-code'); if (e) e.focus(); },
  joinClose: () => { P.join = false; P.err = ''; keepRender(); },
  pwd: () => showPassword(),
  pwdBack: () => pwdBack(),
  logout: (d, el) => arm(el, 'Выйти из аккаунта?', logout),
  course: (d) => { P.cid = d.cid; P.view = 'course'; render(); root.scrollTop = 0; },
  back: () => { P.view = 'home'; render(); root.scrollTop = 0; },
  refresh: () => { loadCourses(false); },
  board: (d) => openBoard(d.cid, d.lid),
  hw: (d, el) => setHw(d.cid, d.id, d.st, el),
  leave: (d, el) => arm(el, 'Точно покинуть курс?', async () => {
    try { await api('DELETE', '/api/my/courses/' + d.cid); P.view = 'home'; await loadCourses(true); render(); toast('Вы покинули курс'); } catch (e) { if (e.code !== 'expired') toast(e.message); }
  }),
};
root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-p]');
  if (el && A[el.dataset.p]) { e.preventDefault(); A[el.dataset.p](el.dataset, el); }
});
root.addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.dataset.form;
  if (f === 'auth') submitAuth(); else if (f === 'join') submitJoin(); else if (f === 'pwd') submitPwd(); else if (f === 'req') submitReq();
});

window.Portal = { route: route, showAuth: showAuth, showWelcome: showWelcome, showPassword: showPassword, logout: logout, _t: { normServer: normServer, state: P } };
})();
