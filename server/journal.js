'use strict';
/* Журнал репетитора на сервере: ученики, уроки, домашние задания.
   Репетитор синхронизируется через sync(), ученики и родители читают через viewFor() по своей ключ-ссылке. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KINDS = ['students', 'lessons', 'homework', 'requests'];
const ID_RE = /^(?!__proto__$)[A-Za-z0-9_-]{1,40}$/;
const VK_RE = /^[A-Za-z0-9_-]{20,64}$/;
const MAX_REC = 20000, MAX_REC_BYTES = 20000;
const REQ_STATUS = new Set(['pending', 'accepted', 'declined']);
const MAX_PENDING = 10;
const LESSON_STATUS = new Set(['planned', 'done', 'cancelled']);
const HW_STATUS = new Set(['given', 'submitted', 'checked']);

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const dateStr = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const timeStr = (v) => (typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v) ? v : '');
const nn = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

function createJournal(dir) {
  const file = path.join(dir, 'journal.json');
  let st = { epoch: crypto.randomBytes(8).toString('hex'), rev: 0, items: { students: Object.create(null), lessons: Object.create(null), homework: Object.create(null), requests: Object.create(null) }, tomb: Object.create(null) };
  let count = 0, timer = null, dirty = false, vkIndex = null;

  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (j && typeof j.epoch === 'string' && j.items) {
      st = { epoch: j.epoch, rev: nn(j.rev), items: { students: Object.create(null), lessons: Object.create(null), homework: Object.create(null), requests: Object.create(null) }, tomb: Object.assign(Object.create(null), j.tomb && typeof j.tomb === 'object' ? j.tomb : {}) };
      KINDS.forEach((k) => { Object.assign(st.items[k], j.items[k] || {}); });
    }
  } catch (e) { /* первый запуск */ }
  const recount = () => { count = KINDS.reduce((a, k) => a + Object.keys(st.items[k]).length, 0); };
  recount();

  function save() {
    if (!dirty) return;
    dirty = false;
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(st));
    fs.renameSync(tmp, file);
  }
  function persist() {
    dirty = true; vkIndex = null;
    if (timer) return;
    timer = setTimeout(() => { timer = null; try { save(); } catch (e) { console.error('journal save', e.message); } }, 1000);
  }

  const validRec = (r) => !!r && typeof r === 'object' && !Array.isArray(r) && typeof r.id === 'string' && ID_RE.test(r.id) &&
    typeof r.u === 'number' && isFinite(r.u) && r.u > 0 && JSON.stringify(r).length <= MAX_REC_BYTES;

  function applyRec(k, r) {
    const key = k + '/' + r.id, cur = st.items[k][r.id], t = st.tomb[key];
    if (t && r.u <= t.u) return false;
    if (cur) {
      if (r.u < cur.r.u) return false;
      if (r.u === cur.r.u && JSON.stringify(r) === JSON.stringify(cur.r)) return false;
    } else if (count >= MAX_REC) return false;
    if (!cur) count++;
    st.items[k][r.id] = { r: r, rv: ++st.rev };
    if (t) delete st.tomb[key];
    return true;
  }
  function applyTomb(k, id, u) {
    const key = k + '/' + id, cur = st.items[k][id], t = st.tomb[key];
    if (t && u <= t.u) return false;
    if (cur && u < cur.r.u) return false;
    if (cur) { delete st.items[k][id]; count--; }
    st.tomb[key] = { u: u, rv: ++st.rev };
    return true;
  }

  /* since: ревизия, до которой клиент уже всё получил; changes: изменения клиента */
  function sync(since, changes) {
    let changed = false;
    const ch = changes && typeof changes === 'object' ? changes : {};
    KINDS.forEach((k) => {
      (Array.isArray(ch[k]) ? ch[k] : []).forEach((r) => { if (validRec(r) && applyRec(k, r)) changed = true; });
    });
    (Array.isArray(ch.tomb) ? ch.tomb : []).forEach((t) => {
      if (t && KINDS.indexOf(t.k) >= 0 && typeof t.id === 'string' && ID_RE.test(t.id) && typeof t.u === 'number' && isFinite(t.u) && t.u > 0 && applyTomb(t.k, t.id, t.u)) changed = true;
    });
    if (changed) persist();
    const s = nn(since), out = { students: [], lessons: [], homework: [], requests: [], tomb: [] };
    KINDS.forEach((k) => { Object.keys(st.items[k]).forEach((id) => { const x = st.items[k][id]; if (x.rv > s) out[k].push(x.r); }); });
    Object.keys(st.tomb).forEach((key) => {
      const t = st.tomb[key];
      if (t.rv > s) { const i = key.indexOf('/'); out.tomb.push({ k: key.slice(0, i), id: key.slice(i + 1), u: t.u }); }
    });
    return { epoch: st.epoch, rev: st.rev, changes: out };
  }

  function studentByKey(vk) {
    if (typeof vk !== 'string' || !VK_RE.test(vk)) return null;
    if (!vkIndex) {
      vkIndex = new Map();
      Object.keys(st.items.students).forEach((id) => {
        const r = st.items.students[id].r;
        if (typeof r.vk === 'string' && VK_RE.test(r.vk)) vkIndex.set(r.vk, r);
      });
    }
    return vkIndex.get(vk) || null;
  }
  const hwOut = (h) => ({ id: h.id, text: str(h.text, 5000), due: dateStr(h.due), status: HW_STATUS.has(h.status) ? h.status : 'given', created: nn(h.created) });

  const reqOut = (q) => ({
    id: q.id, lessonId: str(q.lessonId, 40), date: dateStr(q.date), time: timeStr(q.time), reason: str(q.reason, 300),
    status: REQ_STATUS.has(q.status) ? q.status : 'pending', reply: str(q.reply, 300), by: q.by === 'parent' ? 'parent' : 'student', created: nn(q.created),
  });
  /* ученик или родитель просит перенести урок */
  function addRequestOf(s, who, o) {
    if (!s || !o || typeof o !== 'object') return { err: 'Некорректный запрос.' };
    const lid = typeof o.lessonId === 'string' && ID_RE.test(o.lessonId) ? o.lessonId : '';
    const lx = lid && st.items.lessons[lid];
    if (!lx || lx.r.studentId !== s.id || lx.r.status !== 'planned') return { err: 'Этот урок нельзя перенести.' };
    const date = dateStr(o.date), time = timeStr(o.time), reason = str(o.reason, 300).trim();
    if (!date || !time) return { err: 'Укажите желаемые дату и время.' };
    if (!reason) return { err: 'Напишите причину.' };
    const mine = Object.keys(st.items.requests).map((id) => st.items.requests[id].r).filter((q) => q.studentId === s.id && q.status === 'pending');
    if (mine.length >= MAX_PENDING) return { err: 'Слишком много неразобранных запросов. Дождитесь ответа учителя.' };
    if (mine.some((q) => q.lessonId === lid)) return { err: 'По этому уроку уже есть запрос. Дождитесь ответа учителя.' };
    if (count >= MAX_REC) return { err: 'Лимит записей.' };
    const id = 'q' + crypto.randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x');
    const r = { id: id, studentId: s.id, lessonId: lid, date: date, time: time, reason: reason, status: 'pending', reply: '', by: who === 'parent' ? 'parent' : 'student', created: Date.now(), u: Date.now() };
    count++;
    st.items.requests[id] = { r: r, rv: ++st.rev };
    persist();
    return { req: reqOut(r) };
  }

  const students = () => Object.keys(st.items.students).map((id) => st.items.students[id].r);
  const studentRec = (id) => (typeof id === 'string' && ID_RE.test(id) && st.items.students[id] ? st.items.students[id].r : null);
  const viewFor = (vk) => viewOf(studentByKey(vk));

  function viewOf(s) {
    if (!s) return null;
    const pay = s.showPay === true;
    const from = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const lessons = [];
    Object.keys(st.items.lessons).forEach((id) => {
      const l = st.items.lessons[id].r;
      if (l.studentId !== s.id || !dateStr(l.date)) return;
      const hasRoom = !!(l.room && typeof l.room.id === 'string');
      if (l.date < from && !hasRoom) return;
      const o = {
        id: l.id, date: l.date, time: timeStr(l.time), dur: nn(l.dur) || 60, topic: str(l.topic, 300),
        status: LESSON_STATUS.has(l.status) ? l.status : 'planned', reason: str(l.reason, 500),
        movedTo: dateStr(l.movedTo), movedToTime: timeStr(l.movedToTime), movedFrom: dateStr(l.movedFrom), movedFromTime: timeStr(l.movedFromTime),
      };
      if (pay) o.paid = l.paid === true;
      if (l.room && typeof l.room.id === 'string' && typeof l.room.sk === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(l.room.id) && /^[A-Za-z0-9_-]{16,64}$/.test(l.room.sk)) o.room = { id: l.room.id, sk: l.room.sk };
      lessons.push(o);
    });
    const hw = Object.keys(st.items.homework).map((id) => st.items.homework[id].r).filter((h) => h.studentId === s.id);
    const open = hw.filter((h) => h.status !== 'checked'), done = hw.filter((h) => h.status === 'checked').sort((a, b) => nn(b.created) - nn(a.created)).slice(0, 10);
    const requests = Object.keys(st.items.requests).map((id) => st.items.requests[id].r).filter((q) => q.studentId === s.id)
      .sort((a, b) => nn(b.created) - nn(a.created)).slice(0, 20).map(reqOut);
    return {
      requests: requests, student: { name: str(s.name, 200), grade: str(s.grade, 200) }, title: str(s.title, 100), pay: pay, lessons: lessons,
      homework: open.concat(done).map(hwOut), rev: st.rev, now: Date.now(),
    };
  }

  /* ученик отмечает «сдано» или снимает отметку */
  const markHw = (vk, hwId, status) => markHwOf(studentByKey(vk), hwId, status);
  function markHwOf(s, hwId, status) {
    if (!s || typeof hwId !== 'string' || !ID_RE.test(hwId) || (status !== 'submitted' && status !== 'given')) return null;
    const x = st.items.homework[hwId];
    if (!x || x.r.studentId !== s.id || x.r.status === 'checked') return null;
    if (x.r.status !== status) {
      const r = Object.assign({}, x.r, { status: status, u: Math.max(Date.now(), nn(x.r.u) + 1) });
      st.items.homework[hwId] = { r: r, rv: ++st.rev };
      persist();
    }
    return hwOut(st.items.homework[hwId].r);
  }

  return { sync: sync, viewFor: viewFor, markHw: markHw, students: students, studentRec: studentRec, viewOf: viewOf, markHwOf: markHwOf, addRequestOf: addRequestOf, flush: () => { if (timer) { clearTimeout(timer); timer = null; } save(); }, _st: () => st };
}

module.exports = { createJournal: createJournal };
