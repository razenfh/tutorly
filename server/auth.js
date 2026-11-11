'use strict';
/* Аккаунты: учитель, ученик, родитель. Вход по логину и паролю (без почты), сессии по токену.
   У ученика и родителя есть список курсов (m): курс это один ученик у конкретного учителя. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROLES = new Set(['teacher', 'student', 'parent']);
const LOGIN_RE = /^[\p{L}\p{N}_.-]{3,32}$/u;
const MAX_ACCOUNTS = 5000, MAX_SESSIONS = 20, SESSION_MS = 180 * 86400000, MAX_COURSES = 30;
const TEMP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

const fail = (code, msg) => { const e = new Error(msg || code); e.code = code; return e; };
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, (e, k) => (e ? rej(e) : res(k))));
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(), crypto.createHash('sha256').update(String(b)).digest());
const pub = (a) => ({ id: a.id, role: a.role, name: a.name, login: a.login });

function tempPassword() {
  const b = crypto.randomBytes(10);
  let s = '';
  for (let i = 0; i < 10; i++) s += TEMP_ALPHABET[b[i] % TEMP_ALPHABET.length];
  return s;
}

function createAuth(dir, opts) {
  opts = opts || {};
  const file = path.join(dir, 'accounts.json');
  const db = { accounts: Object.create(null), sessions: Object.create(null) };
  const byLogin = new Map();
  let timer = null, dirty = false;

  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    Object.assign(db.accounts, j.accounts || {});
    Object.assign(db.sessions, j.sessions || {});
    Object.keys(db.accounts).forEach((id) => { byLogin.set(db.accounts[id].login.toLowerCase(), id); });
  } catch (e) { /* первый запуск */ }

  function save() {
    if (!dirty) return;
    dirty = false;
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }
  function persist() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => { timer = null; try { save(); } catch (e) { console.error('accounts save', e.message); } }, 500);
  }

  async function hashPw(pw) {
    const salt = crypto.randomBytes(16);
    const h = await scrypt(pw, salt);
    return { salt: salt.toString('hex'), hash: h.toString('hex') };
  }
  async function checkPw(acc, pw) {
    const h = await scrypt(pw, Buffer.from(acc.salt, 'hex'));
    return crypto.timingSafeEqual(h, Buffer.from(acc.hash, 'hex'));
  }
  function checkPassword(pw, login) {
    if (typeof pw !== 'string' || pw.length < 6 || pw.length > 128) throw fail('weak', 'Пароль не короче 6 символов.');
    if (login && pw.toLowerCase() === String(login).toLowerCase()) throw fail('weak', 'Пароль не должен совпадать с логином.');
  }
  function newSession(acc) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.sessions[sha(token)] = { a: acc.id, t: Date.now() };
    const mine = Object.keys(db.sessions).filter((h) => db.sessions[h].a === acc.id).sort((x, y) => db.sessions[x].t - db.sessions[y].t);
    while (mine.length > MAX_SESSIONS) delete db.sessions[mine.shift()];
    persist();
    return token;
  }
  function revokeAll(accId, exceptHash) {
    Object.keys(db.sessions).forEach((h) => { if (db.sessions[h].a === accId && h !== exceptHash) delete db.sessions[h]; });
  }

  async function register(o) {
    const role = o && o.role;
    if (!ROLES.has(role)) throw fail('invalid', 'Выберите, кто вы: учитель, ученик или родитель.');
    const name = String(o.name || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 60) throw fail('invalid', 'Введите имя (до 60 символов).');
    const login = String(o.login || '').trim();
    if (!LOGIN_RE.test(login)) throw fail('invalid', 'Логин: от 3 до 32 символов, буквы, цифры, точка, дефис или подчёркивание.');
    checkPassword(o.password, login);
    if (role === 'teacher' && opts.teacherInvite && !safeEq(o.invite || '', opts.teacherInvite)) throw fail('invite', 'Неверный код для регистрации учителя.');
    const key = login.toLowerCase();
    if (byLogin.has(key)) throw fail('exists', 'Такой логин уже занят.');
    if (Object.keys(db.accounts).length >= MAX_ACCOUNTS) throw fail('full', 'Регистрация закрыта: достигнут лимит аккаунтов.');
    const h = await hashPw(o.password);
    if (byLogin.has(key)) throw fail('exists', 'Такой логин уже занят.');
    const acc = { id: crypto.randomBytes(12).toString('base64url'), role: role, name: name, login: login, salt: h.salt, hash: h.hash, created: Date.now(), m: [] };
    db.accounts[acc.id] = acc; byLogin.set(key, acc.id);
    persist();
    return { token: newSession(acc), account: pub(acc) };
  }
  async function login(loginName, password) {
    const id = byLogin.get(String(loginName || '').trim().toLowerCase());
    const acc = id ? db.accounts[id] : null;
    if (!acc || typeof password !== 'string' || password.length > 128) {
      await scrypt('x', Buffer.alloc(16)); // одинаковое время ответа
      throw fail('auth', 'Неверный логин или пароль.');
    }
    if (!(await checkPw(acc, password))) throw fail('auth', 'Неверный логин или пароль.');
    return { token: newSession(acc), account: pub(acc) };
  }
  function session(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const h = sha(token), s = db.sessions[h];
    if (!s) return null;
    const now = Date.now();
    if (now - s.t > SESSION_MS) { delete db.sessions[h]; persist(); return null; }
    const acc = db.accounts[s.a];
    if (!acc) return null;
    if (now - s.t > 86400000) { s.t = now; persist(); }
    return acc;
  }
  function logout(token) { if (typeof token === 'string') { delete db.sessions[sha(token)]; persist(); } }
  async function changePassword(accId, oldPw, newPw, token) {
    const acc = db.accounts[accId];
    if (!acc) throw fail('none');
    if (typeof oldPw !== 'string' || !(await checkPw(acc, oldPw))) throw fail('auth', 'Старый пароль неверный.');
    checkPassword(newPw, acc.login);
    Object.assign(acc, await hashPw(newPw));
    revokeAll(acc.id, sha(token));
    persist();
  }
  async function setPassword(accId, newPw) {
    const acc = db.accounts[accId];
    if (!acc) throw fail('none');
    const pw = newPw || tempPassword();
    checkPassword(pw, acc.login);
    Object.assign(acc, await hashPw(pw));
    revokeAll(acc.id);
    persist();
    return pw;
  }

  const getById = (id) => (typeof id === 'string' ? db.accounts[id] || null : null);
  const getByLogin = (l) => { const id = byLogin.get(String(l || '').trim().toLowerCase()); return id ? db.accounts[id] : null; };

  function addCourse(accId, t, s, as) {
    const acc = db.accounts[accId];
    if (!acc) throw fail('none');
    if (acc.m.some((x) => x.t === t && x.s === s)) return false;
    if (acc.m.length >= MAX_COURSES) throw fail('full', 'Слишком много курсов в аккаунте.');
    acc.m.push({ t: t, s: s, as: as, at: Date.now() });
    persist();
    return true;
  }
  function removeCourse(accId, t, s) {
    const acc = db.accounts[accId];
    if (!acc) return false;
    const n = acc.m.length;
    acc.m = acc.m.filter((x) => !(x.t === t && x.s === s));
    if (acc.m.length !== n) { persist(); return true; }
    return false;
  }
  function membersOf(t, s) {
    const out = [];
    Object.keys(db.accounts).forEach((id) => {
      const a = db.accounts[id], m = a.m.find((x) => x.t === t && x.s === s);
      if (m) out.push({ id: a.id, name: a.name, login: a.login, as: m.as, at: m.at });
    });
    return out;
  }
  function dropCourse(t, s) { Object.keys(db.accounts).forEach((id) => removeCourse(id, t, s)); }
  const listAccounts = () => Object.keys(db.accounts).map((id) => { const a = db.accounts[id]; return { id: a.id, login: a.login, name: a.name, role: a.role, created: a.created, courses: a.m.length }; });
  function deleteAccount(id) {
    const a = db.accounts[id];
    if (!a) return false;
    revokeAll(id);
    byLogin.delete(a.login.toLowerCase());
    delete db.accounts[id];
    persist();
    return true;
  }
  const count = () => Object.keys(db.accounts).length;

  return {
    register: register, login: login, session: session, logout: logout, changePassword: changePassword, setPassword: setPassword,
    getById: getById, getByLogin: getByLogin, addCourse: addCourse, removeCourse: removeCourse, membersOf: membersOf, dropCourse: dropCourse,
    listAccounts: listAccounts, deleteAccount: deleteAccount, count: count,
    flush: () => { if (timer) { clearTimeout(timer); timer = null; } save(); },
  };
}

module.exports = { createAuth: createAuth };
