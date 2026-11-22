/* План уведомлений: чистые функции без зависимостей от телефона, чтобы их можно было проверить тестом.
   Уведомления локальные: приложение само планирует их на телефоне по данным, которые видело в последний раз. */
import { lessonStart, lessonEnd, parseYmd } from './util';

export const DEFAULT_PREFS = { on: true, lead: 30, digest: true, hw: true, asked: false };
export const MAX_PLAN = 60; // iOS хранит не больше 64 запланированных уведомлений
const DAY = 86400000;

const plural = (n, f) => { const a = Math.abs(n) % 100, b = a % 10; return a > 10 && a < 20 ? f[2] : b > 1 && b < 5 ? f[1] : b === 1 ? f[0] : f[2]; };
const LESSONS = ['урок', 'урока', 'уроков'], WORKS = ['работа', 'работы', 'работ'];
const atTime = (d, h, m) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0); return x; };
/* ближайший момент h:m, который ещё не наступил */
const nextAt = (now, h, m) => { const t = atTime(now, h, m); return t.getTime() > now.getTime() + 60000 ? t : new Date(t.getTime() + DAY); };
const firstLine = (s) => String(s || '').split('\n')[0].trim().slice(0, 80);

function lessonItem(l, now, lead, name, titleExtra) {
  const start = lessonStart(l), when = new Date(start.getTime() - lead * 60000);
  if (start.getTime() - now.getTime() > 14 * DAY || when.getTime() <= now.getTime() + 5000) return null;
  const tm = String(l.time || '');
  return { key: 'l-' + l.id, when: when, title: lead ? 'Урок через ' + lead + ' мин' : 'Урок начинается', body: (name ? name + ' · ' : '') + tm + (titleExtra || '') };
}

/* Учитель: напоминания об уроках и один вечерний итог (без отметки, не оплачено, ждёт проверки) */
export function teacherPlan(S, now, prefs) {
  const p = Object.assign({}, DEFAULT_PREFS, prefs), out = [];
  if (!p.on) return out;
  const lessons = Object.values(S.lessons || {}), name = (id) => (S.students && S.students[id] && S.students[id].name) || '';
  lessons.forEach((l) => {
    if (l.status !== 'planned') return;
    const it = lessonItem(l, now, p.lead, name(l.studentId), l.topic ? ' · ' + l.topic : '');
    if (it) out.push(it);
  });
  if (p.digest) {
    const unmarked = lessons.filter((l) => l.status === 'planned' && lessonEnd(l) < now).length;
    const debt = lessons.filter((l) => l.status === 'done' && !l.paid);
    const toCheck = Object.values(S.homework || {}).filter((h) => h.status === 'submitted').length;
    const parts = [];
    if (unmarked) parts.push('Без отметки: ' + unmarked + ' ' + plural(unmarked, LESSONS));
    if (debt.length) {
      const names = [];
      debt.forEach((l) => { const n = name(l.studentId); if (n && names.indexOf(n) < 0) names.push(n); });
      parts.push('Не оплачено: ' + debt.length + ' ' + plural(debt.length, LESSONS) + (names.length ? ' (' + names.slice(0, 3).join(', ') + (names.length > 3 ? ' и др.' : '') + ')' : ''));
    }
    if (toCheck) parts.push('Ждёт проверки: ' + toCheck + ' ' + plural(toCheck, WORKS));
    if (parts.length) out.push({ key: 'digest', when: nextAt(now, 20, 0), title: 'Tutorly: что осталось сделать', body: parts.join('. ') + '.' });
  }
  return finish(out);
}

/* Ученик и родитель: напоминания об уроках и о сроке домашки (накануне в 18:00 и в день срока в 9:00) */
export function studentPlan(courses, now, prefs) {
  const p = Object.assign({}, DEFAULT_PREFS, prefs), out = [];
  if (!p.on) return out;
  (courses || []).forEach((c) => {
    const who = c.as === 'parent' ? 'Ребёнок: ' + (c.student && c.student.name) : c.title;
    (c.lessons || []).forEach((l) => {
      if (l.status !== 'planned') return;
      const it = lessonItem(l, now, p.lead, who, l.topic ? ' · ' + l.topic : '');
      if (it) { it.key = 'l-' + c.cid + '-' + l.id; out.push(it); }
    });
    if (!p.hw) return;
    (c.homework || []).forEach((h) => {
      if ((h.status !== 'given' && h.status !== 'returned') || !h.due) return;
      const d = parseYmd(h.due), txt = firstLine(h.text), tail = h.status === 'returned' ? ' (нужно доработать)' : '';
      const eve = atTime(new Date(d.getTime() - DAY), 18, 0), day = atTime(d, 9, 0);
      if (eve.getTime() > now.getTime() + 5000) out.push({ key: 'h1-' + c.cid + '-' + h.id, when: eve, title: 'Завтра срок сдачи домашки', body: txt + tail });
      if (day.getTime() > now.getTime() + 5000) out.push({ key: 'h0-' + c.cid + '-' + h.id, when: day, title: 'Сегодня срок сдачи домашки', body: txt + tail });
    });
  });
  return finish(out);
}

function finish(list) {
  return list.sort((a, b) => a.when - b.when).slice(0, MAX_PLAN);
}
export const planSignature = (plan) => JSON.stringify(plan.map((i) => [i.key, i.when.getTime(), i.title, i.body]));
