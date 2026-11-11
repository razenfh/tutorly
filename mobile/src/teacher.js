import React, { useEffect, useMemo, useReducer, useState, useCallback } from 'react';
import { View, Alert, Share, AppState, BackHandler, ActivityIndicator, Pressable, Text } from 'react-native';
import { createJournal } from './journal';
import { bytes, newCode, newKey, showCode } from './rand';
import { Screen, T, H1, H3, Card, Btn, Field, Chip, Err, Pick, Check, row, useTheme } from './ui';
import { Board } from './screens';
import { ymd, parseYmd, dayTime, fmtShort, fmtDM, byStart, lessonStart, lessonEnd, endTime, nextDays, dayChip, normTime } from './util';

const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const startOfWeek = (d) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); };
const isPast = (l) => lessonEnd(l) < new Date();
const REASONS = ['Болезнь', 'Школа', 'Семейные обстоятельства', 'Я заболел(а)', 'По моей просьбе'];

export default function TeacherApp({ acct, api, onLogout, onPassword }) {
  const t = useTheme();
  const J = useMemo(() => createJournal(api, bytes), [api]);
  const [, force] = useReducer((x) => x + 1, 0);
  const [tab, setTab] = useState('schedule');
  const [week, setWeek] = useState(startOfWeek(new Date()));
  const [stack, setStack] = useState([]);
  const S = J.S;

  useEffect(() => J.subscribe(force), [J]);
  useEffect(() => {
    J.refresh();
    const iv = setInterval(() => { if (AppState.currentState === 'active') J.refresh(); }, 60000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') J.refresh(); });
    return () => { clearInterval(iv); sub.remove(); J.clear(); };
  }, [J]);
  const push = useCallback((s) => setStack((st) => st.concat([s])), []);
  const pop = useCallback(() => setStack((st) => st.slice(0, -1)), []);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (stack.length) { pop(); return true; } return false; });
    return () => sub.remove();
  }, [stack.length, pop]);

  const act = useCallback(async (p, okText) => {
    try { await p; if (okText) Alert.alert(okText); return true; }
    catch (e) { if (e.code !== 'expired') Alert.alert('Не получилось', e.message || 'Нет связи с сервером'); return false; }
  }, []);

  const students = () => Object.values(S.students).sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
  const activeStudents = () => students().filter((s) => !s.archived);
  const lessons = () => Object.values(S.lessons);
  const stuName = (id) => (S.students[id] && S.students[id].name) || 'Без ученика';
  const pending = () => Object.values(S.requests).filter((q) => q.status === 'pending' && S.lessons[q.lessonId] && S.students[q.studentId]).sort((a, b) => (a.created || 0) - (b.created || 0));
  const ctx = { J, S, api, acct, act, push, pop, students, activeStudents, lessons, stuName, pending, setTab, setWeek };

  const top = stack[stack.length - 1];
  if (top) {
    const p = { ctx, s: top };
    switch (top.n) {
      case 'lesson': return <LessonForm {...p} />;
      case 'move': return <MoveForm {...p} />;
      case 'requests': return <Requests {...p} />;
      case 'student': return <StudentForm {...p} />;
      case 'course': return <CourseScreen {...p} />;
      case 'hw': return <HwForm {...p} />;
      case 'board': return <TeacherBoard {...p} />;
      case 'settings': return <Settings {...p} onLogout={onLogout} onPassword={onPassword} />;
      default: return null;
    }
  }
  const TABS = [['schedule', 'Расписание'], ['students', 'Ученики'], ['money', 'Оплата'], ['homework', 'Домашка']];
  const unmarked = lessons().filter((l) => l.status === 'planned' && isPast(l)).length;
  const debtN = lessons().filter((l) => l.status === 'done' && !l.paid).length;
  const check = Object.values(S.homework).filter((h) => h.status === 'submitted').length;
  const badge = { schedule: unmarked + pending().length, money: debtN, homework: check, students: 0 };
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flex: 1 }}>
        {tab === 'schedule' ? <Schedule ctx={ctx} week={week} /> : null}
        {tab === 'students' ? <Students ctx={ctx} /> : null}
        {tab === 'money' ? <Money ctx={ctx} /> : null}
        {tab === 'homework' ? <Homework ctx={ctx} /> : null}
      </View>
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.surface, paddingBottom: 14 }}>
        {TABS.map(([id, title]) => (
          <Pressable key={id} onPress={() => setTab(id)} style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center' }} accessibilityRole="tab" accessibilityState={{ selected: tab === id }}>
            <Text style={{ color: tab === id ? t.accent : t.muted, fontWeight: tab === id ? '800' : '600', fontSize: 13 }}>{title + (badge[id] ? ' ·' + badge[id] : '')}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Top({ ctx, title }) {
  const { J } = ctx;
  return (
    <View style={[row, { justifyContent: 'space-between' }]}>
      <H1>{title}</H1>
      <View style={row}>
        {J.st.busy ? <ActivityIndicator /> : null}
        <Btn small title="⚙" onPress={() => ctx.push({ n: 'settings' })} />
      </View>
    </View>
  );
}
function ErrBar({ ctx }) { return ctx.J.st.error ? <Err>{'Нет синхронизации: ' + ctx.J.st.error}</Err> : null; }

/* ---------- расписание ---------- */
function Schedule({ ctx, week }) {
  const t = useTheme();
  const { J, S } = ctx;
  const k1 = ymd(week), k2 = ymd(addDays(week, 6));
  const unmarked = ctx.lessons().filter((l) => l.status === 'planned' && isPast(l)).sort(byStart);
  const pr = ctx.pending();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = ymd(addDays(week, i));
    days.push([d, ctx.lessons().filter((l) => l.date === d).sort(byStart)]);
  }
  const live = ctx.lessons().filter((l) => l.date >= k1 && l.date <= k2 && l.status !== 'cancelled');
  const wk = fmtDM(week) + ' – ' + fmtDM(addDays(week, 6));
  const toggle = (l, patch) => ctx.act(J.put('lessons', Object.assign({}, l, patch)));
  return (
    <Screen onRefresh={() => J.refresh()} refreshing={false}>
      <Top ctx={ctx} title="Расписание" />
      <ErrBar ctx={ctx} />
      {pr.length ? <Card><T bold>{'Запросы на перенос: ' + pr.length}</T><Btn small kind="primary" title="Разобрать" onPress={() => ctx.push({ n: 'requests' })} /></Card> : null}
      {unmarked.length ? <Card><T bold>{'Без отметки: ' + unmarked.length}</T><T muted size={13}>Прошедшие уроки, не отмеченные как проведённые или отменённые.</T>
        <Btn small title="Показать" onPress={() => ctx.setWeek(startOfWeek(parseYmd(unmarked[0].date)))} /></Card> : null}
      <View style={[row, { justifyContent: 'space-between' }]}>
        <Btn small title="←" onPress={() => ctx.setWeek(addDays(week, -7))} />
        <View style={{ alignItems: 'center' }}><T bold>{wk}</T><T muted size={13}>{live.length + ' ур. · проведено ' + live.filter((l) => l.status === 'done').length}</T></View>
        <Btn small title="→" onPress={() => ctx.setWeek(addDays(week, 7))} />
      </View>
      <View style={row}><Btn small title="Сегодня" onPress={() => ctx.setWeek(startOfWeek(new Date()))} /><Btn small kind="primary" title="+ Новый урок" onPress={() => ctx.push({ n: 'lesson', id: '', date: ymd(new Date()) })} /></View>
      {days.map(([d, ls]) => (
        <View key={d} style={{ gap: 8 }}>
          <T bold muted style={{ marginTop: 6 }}>{dayTime(d) + (d === ymd(new Date()) ? ' · сегодня' : '')}</T>
          {ls.length ? ls.map((l) => (
            <Card key={l.id} onPress={() => ctx.push({ n: 'lesson', id: l.id })} style={l.status === 'cancelled' ? { opacity: 0.6 } : null}>
              <T bold>{l.time + '–' + endTime(l) + ' · ' + ctx.stuName(l.studentId)}</T>
              {l.topic ? <T>{l.topic}</T> : null}
              {l.status === 'cancelled' ? <T muted size={13}>{(l.movedTo ? 'Перенесён на ' + dayTime(l.movedTo, l.movedToTime) : 'Отменён') + (l.reason ? '. ' + l.reason : '')}</T> : (
                <View style={row}>
                  <Chip title={l.status === 'done' ? '✓ Проведён' : 'Проведён?'} on={l.status === 'done'} onPress={() => toggle(l, { status: l.status === 'done' ? 'planned' : 'done' })} />
                  <Chip title={l.paid ? '✓ Оплачен' : 'Оплачен?'} on={!!l.paid} onPress={() => toggle(l, { paid: !l.paid })} />
                  {l.room ? <T muted size={13}>доска</T> : null}
                </View>
              )}
            </Card>
          )) : <T muted size={13}>Уроков нет</T>}
        </View>
      ))}
    </Screen>
  );
}

function DatePick({ label, value, onChange, allowEmpty }) {
  const days = nextDays(14);
  return (
    <View style={{ gap: 6 }}>
      <T muted size={13} bold>{label}</T>
      <View style={row}>{days.map((d) => <Chip key={d} title={dayChip(d)} on={d === value} onPress={() => onChange(d)} />)}{allowEmpty ? <Chip title="Без срока" on={!value} onPress={() => onChange('')} /> : null}</View>
      <Field label="Дата (ГГГГ-ММ-ДД)" value={value} onChangeText={onChange} keyboardType="numbers-and-punctuation" maxLength={10} placeholder="2026-12-31" />
    </View>
  );
}
const okDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(parseYmd(v).getTime()) && ymd(parseYmd(v)) === v;

/* ---------- урок ---------- */
function LessonForm({ ctx, s }) {
  const { J, S } = ctx;
  const cur = s.id ? S.lessons[s.id] : null;
  const act = ctx.activeStudents();
  const [sid, setSid] = useState(cur ? cur.studentId : (s.studentId || (act[0] && act[0].id) || ''));
  const [date, setDate] = useState(cur ? cur.date : s.date || ymd(new Date()));
  const [time, setTime] = useState(cur ? cur.time : '16:00');
  const [dur, setDur] = useState(String(cur ? cur.dur : (S.students[sid] && S.students[sid].dur) || 60));
  const [price, setPrice] = useState(String(cur ? cur.price : (S.students[sid] && S.students[sid].price) || ''));
  const [topic, setTopic] = useState(cur ? cur.topic || '' : '');
  const [note, setNote] = useState(cur ? cur.note || '' : '');
  const [err, setErr] = useState('');
  const pickStudent = (id) => { setSid(id); const st = S.students[id]; if (!cur && st) { setDur(String(st.dur || 60)); setPrice(String(st.price || '')); } };
  if (s.id && !cur) { return <Screen><Btn small title="← Назад" onPress={ctx.pop} /><T>Урок не найден.</T></Screen>; }
  async function save() {
    const tm = normTime(time);
    if (!sid) return setErr('Сначала добавьте ученика.');
    if (!okDate(date)) return setErr('Дата в формате 2026-12-31.');
    if (!tm) return setErr('Время в формате 16:00.');
    const o = Object.assign({ status: 'planned', paid: false, reason: '', movedTo: '' }, cur || {}, { id: cur ? cur.id : J.uid(), studentId: sid, date: date, time: tm, dur: num(dur) || 60, price: num(price), topic: topic.trim(), note: note.trim() });
    if (await ctx.act(J.put('lessons', o))) ctx.pop();
  }
  function remove() {
    Alert.alert('Удалить урок?', 'Вместе с ним удалится доска урока.', [{ text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: async () => { if (cur.room) ctx.api.deleteRoom(cur.room.id); if (await ctx.act(J.del('lessons', cur.id))) ctx.pop(); } }]);
  }
  return (
    <Screen>
      <Btn small title="← Назад" onPress={ctx.pop} />
      <H1>{cur ? 'Урок' : 'Новый урок'}</H1>
      {act.length ? <Pick label="Ученик" options={act.map((x) => [x.id, x.name])} value={sid} onChange={pickStudent} /> : <T muted>Сначала добавьте ученика на вкладке «Ученики».</T>}
      <DatePick label="Дата" value={date} onChange={setDate} />
      <Field label="Время" value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" maxLength={5} />
      <View style={row}><View style={{ flex: 1 }}><Field label="Длительность, мин" value={dur} onChangeText={setDur} keyboardType="numeric" /></View><View style={{ flex: 1 }}><Field label="Цена" value={price} onChangeText={setPrice} keyboardType="numeric" /></View></View>
      <Field label="Тема" value={topic} onChangeText={setTopic} maxLength={300} />
      <Field label="Заметка (видите только вы)" value={note} onChangeText={setNote} multiline numberOfLines={3} />
      <Err>{err}</Err>
      <Btn kind="primary" title="Сохранить" onPress={save} />
      {cur ? (
        <View style={{ gap: 8, marginTop: 8 }}>
          {cur.status === 'planned' ? <Btn title="Перенести" onPress={() => ctx.push({ n: 'move', id: cur.id })} /> : null}
          {cur.status === 'planned' ? <Btn title="Отменить урок" onPress={() => ctx.push({ n: 'move', id: cur.id, cancel: true })} /> : null}
          {cur.status === 'cancelled' ? <Btn title="Вернуть урок в расписание" onPress={async () => { if (await ctx.act(J.put('lessons', Object.assign({}, cur, { status: 'planned', reason: '', movedTo: '' })))) ctx.pop(); }} /> : null}
          <Btn title="Задать домашку к уроку" onPress={() => ctx.push({ n: 'hw', id: '', pre: { studentId: cur.studentId, lessonId: cur.id, text: cur.topic ? 'Тема: ' + cur.topic + '\n' : '' } })} />
          <Btn title={cur.room ? 'Открыть доску урока' : 'Начать доску урока'} onPress={() => ctx.push({ n: 'board', id: cur.id })} />
          <Btn kind="danger" title="Удалить урок" onPress={remove} />
        </View>
      ) : null}
    </Screen>
  );
}

function MoveForm({ ctx, s }) {
  const { J, S } = ctx;
  const l = S.lessons[s.id];
  const [date, setDate] = useState(l ? l.date : '');
  const [time, setTime] = useState(l ? l.time : '');
  const [reason, setReason] = useState('');
  const [keep, setKeep] = useState(!!(l && l.paid));
  const [err, setErr] = useState('');
  if (!l) return <Screen><Btn small title="← Назад" onPress={ctx.pop} /><T>Урок не найден.</T></Screen>;
  async function save() {
    const tm = normTime(time), r = reason.trim();
    if (!r) return setErr('Напишите причину: ученик и родители её увидят.');
    if (s.cancel) {
      if (await ctx.act(J.put('lessons', Object.assign({}, l, { status: 'cancelled', paid: false, reason: r, movedTo: '' })))) { ctx.pop(); ctx.pop(); }
      return;
    }
    if (!okDate(date) || !tm) return setErr('Укажите новую дату и время.');
    if (date === l.date && tm === l.time) return setErr('Выберите другую дату или время.');
    const nl = Object.assign({}, l, { id: J.uid(), date: date, time: tm, status: 'planned', paid: keep, note: '', reason: '', movedTo: '', movedToTime: '', movedFrom: l.date, movedFromTime: l.time, room: undefined });
    delete nl.room;
    if (await ctx.act(J.putMany([['lessons', Object.assign({}, l, { status: 'cancelled', paid: false, reason: r, movedTo: date, movedToTime: tm })], ['lessons', nl]]))) { ctx.pop(); ctx.pop(); }
  }
  return (
    <Screen>
      <Btn small title="← Назад" onPress={ctx.pop} />
      <H1>{s.cancel ? 'Отмена урока' : 'Перенос урока'}</H1>
      <T muted>{ctx.stuName(l.studentId) + ' · ' + dayTime(l.date, l.time)}</T>
      {s.cancel ? null : <><DatePick label="Новая дата" value={date} onChange={setDate} /><Field label="Новое время" value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" maxLength={5} /></>}
      <Field label="Причина (увидят ученик и родители)" value={reason} onChangeText={setReason} multiline numberOfLines={3} maxLength={500} />
      <View style={row}>{REASONS.map((r) => <Chip key={r} title={r} onPress={() => setReason(reason.trim() ? reason.trim().replace(/[.\s]+$/, '') + '. ' + r : r)} />)}</View>
      {!s.cancel && l.paid ? <Check label="Оплата переносится на новый урок" value={keep} onChange={setKeep} /> : null}
      <Err>{err}</Err>
      <Btn kind="primary" title={s.cancel ? 'Отменить урок' : 'Перенести'} onPress={save} />
    </Screen>
  );
}

function Requests({ ctx }) {
  const { J, S } = ctx;
  const list = ctx.pending();
  const [reply, setReply] = useState({});
  useEffect(() => { if (!list.length) ctx.pop(); }, [list.length]);
  async function answer(q, status) {
    const l = S.lessons[q.lessonId], r = (reply[q.id] || '').trim();
    const reqRec = ['requests', Object.assign({}, q, { status: status, reply: r })];
    if (status === 'accepted' && l && l.status === 'planned') {
      const nl = Object.assign({}, l, { id: J.uid(), date: q.date, time: q.time, status: 'planned', paid: !!l.paid, note: '', reason: '', movedTo: '', movedToTime: '', movedFrom: l.date, movedFromTime: l.time });
      delete nl.room; nl.board = false;
      await ctx.act(J.putMany([['lessons', Object.assign({}, l, { status: 'cancelled', paid: false, reason: q.reason, movedTo: q.date, movedToTime: q.time })], ['lessons', nl], reqRec]));
    } else await ctx.act(J.putMany([reqRec]));
  }
  return (
    <Screen>
      <Btn small title="← Назад" onPress={ctx.pop} />
      <H1>Запросы на перенос</H1>
      {list.map((q) => { const l = S.lessons[q.lessonId]; return (
        <Card key={q.id}>
          <T bold>{ctx.stuName(q.studentId) + ' · ' + (q.by === 'parent' ? 'родитель' : 'ученик')}</T>
          <T muted>{'Сейчас: ' + dayTime(l.date, l.time)}</T>
          <T>{'Хотят: '}<T bold>{dayTime(q.date, q.time)}</T></T>
          <T muted>{'Причина: ' + q.reason}</T>
          <Field label="Ответ (необязательно)" value={reply[q.id] || ''} onChangeText={(v) => setReply(Object.assign({}, reply, { [q.id]: v }))} maxLength={300} />
          <View style={row}><Btn small kind="primary" title="Перенести" onPress={() => answer(q, 'accepted')} /><Btn small title="Отказать" onPress={() => answer(q, 'declined')} /></View>
        </Card>); })}
    </Screen>
  );
}

/* ---------- ученики и курсы ---------- */
function Students({ ctx }) {
  const { S, J } = ctx;
  const debt = (id) => ctx.lessons().filter((l) => l.studentId === id && l.status === 'done' && !l.paid).reduce((a, l) => a + num(l.price), 0);
  return (
    <Screen onRefresh={() => J.refresh()} refreshing={false}>
      <Top ctx={ctx} title="Ученики" />
      <ErrBar ctx={ctx} />
      <Btn kind="primary" title="+ Новый ученик" onPress={() => ctx.push({ n: 'student', id: '' })} />
      {ctx.students().map((s) => (
        <Card key={s.id} onPress={() => ctx.push({ n: 'student', id: s.id })} style={s.archived ? { opacity: 0.6 } : null}>
          <T bold>{s.name + (s.archived ? ' (архив)' : '')}</T>
          <T muted size={13}>{[s.grade, s.price ? s.price + ' за урок' : ''].filter(Boolean).join(' · ')}</T>
          {debt(s.id) > 0 ? <T bold color="#B3261E">{'Долг: ' + debt(s.id)}</T> : null}
        </Card>
      ))}
      {!ctx.students().length ? <T muted>Учеников пока нет.</T> : null}
    </Screen>
  );
}

function StudentForm({ ctx, s }) {
  const { J, S } = ctx;
  const cur = s.id ? S.students[s.id] : null;
  const [f, setF] = useState({ name: cur ? cur.name : '', title: cur ? cur.title || '' : '', grade: cur ? cur.grade || '' : '', price: String(cur ? cur.price || '' : ''), dur: String(cur ? cur.dur || 60 : 60), contact: cur ? cur.contact || '' : '', note: cur ? cur.note || '' : '', archived: !!(cur && cur.archived) });
  const [err, setErr] = useState('');
  const set = (k) => (v) => setF(Object.assign({}, f, { [k]: v }));
  async function save() {
    if (!f.name.trim()) return setErr('Введите имя ученика.');
    const o = Object.assign({ archived: false }, cur || {}, { id: cur ? cur.id : J.uid(), name: f.name.trim(), title: f.title.trim(), grade: f.grade.trim(), price: num(f.price), dur: num(f.dur) || 60, contact: f.contact.trim(), note: f.note.trim(), archived: f.archived });
    if (await ctx.act(J.put('students', o))) ctx.pop();
  }
  function remove() {
    const used = ctx.lessons().some((l) => l.studentId === cur.id) || Object.values(S.homework).some((h) => h.studentId === cur.id);
    if (used) { set('archived')(true); return Alert.alert('Есть уроки или задания', 'Поставлена отметка «В архиве», нажмите «Сохранить».'); }
    Alert.alert('Удалить ученика?', '', [{ text: 'Отмена', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: async () => {
      const reqs = Object.values(S.requests).filter((q) => q.studentId === cur.id);
      for (const q of reqs) await ctx.act(J.del('requests', q.id));
      if (await ctx.act(J.del('students', cur.id))) ctx.pop();
    } }]);
  }
  return (
    <Screen>
      <Btn small title="← Назад" onPress={ctx.pop} />
      <H1>{cur ? 'Ученик' : 'Новый ученик'}</H1>
      <Field label="Имя" value={f.name} onChangeText={set('name')} />
      <Field label="Название курса (видит ученик)" value={f.title} onChangeText={set('title')} placeholder="Математика, 9 класс" maxLength={100} />
      <Field label="Класс или цель" value={f.grade} onChangeText={set('grade')} />
      <View style={row}><View style={{ flex: 1 }}><Field label="Цена урока" value={f.price} onChangeText={set('price')} keyboardType="numeric" /></View><View style={{ flex: 1 }}><Field label="Длительность, мин" value={f.dur} onChangeText={set('dur')} keyboardType="numeric" /></View></View>
      <Field label="Контакт" value={f.contact} onChangeText={set('contact')} />
      <Field label="Заметка" value={f.note} onChangeText={set('note')} multiline numberOfLines={3} />
      {cur ? <Check label="В архиве" value={f.archived} onChange={set('archived')} /> : null}
      <Err>{err}</Err>
      <Btn kind="primary" title="Сохранить" onPress={save} />
      {cur ? <View style={{ gap: 8, marginTop: 8 }}>
        <Btn title="Курс: коды и участники" onPress={() => ctx.push({ n: 'course', id: cur.id })} />
        <Btn kind="danger" title="Удалить" onPress={remove} />
      </View> : null}
    </Screen>
  );
}

function CourseScreen({ ctx, s }) {
  const { J, S, api, acct } = ctx;
  const st = S.students[s.id];
  const [members, setMembers] = useState(null);
  const [merr, setMerr] = useState('');
  const ready = st && st.sc && st.pc && st.vk;
  useEffect(() => { if (st && !ready) ctx.act(J.put('students', Object.assign({}, st, { sc: st.sc || newCode(), pc: st.pc || newCode(), vk: st.vk || newKey() }))); }, []);
  const loadMembers = useCallback(async () => {
    try { await J.refreshStrict(); setMembers(await api.members(s.id)); setMerr(''); } catch (e) { if (e.code !== 'expired') setMerr(e.message); }
  }, [J, api, s.id]);
  useEffect(() => { loadMembers(); }, []);
  if (!st) return <Screen><Btn small title="← Назад" onPress={ctx.pop} /><T>Ученик не найден.</T></Screen>;
  const send = (what, code) => Share.share({ message: what + ' для курса «' + (st.title || st.name) + '»: ' + showCode(code) + '\nВведите его в приложении после регистрации.' });
  function renew(w) {
    Alert.alert('Заменить код?', 'Старый код перестанет работать для новых людей.', [{ text: 'Отмена', style: 'cancel' },
      { text: 'Заменить', onPress: () => ctx.act(J.put('students', Object.assign({}, st, { [w]: newCode() }))) }]);
  }
  function reset(m) {
    Alert.alert('Сбросить пароль?', m.name, [{ text: 'Отмена', style: 'cancel' }, { text: 'Сбросить', onPress: async () => {
      try { const pw = await api.resetMember(s.id, m.id); Alert.alert('Временный пароль', pw + '\n\nПередайте его человеку: он войдёт и сможет его сменить.'); } catch (e) { if (e.code !== 'expired') Alert.alert('Не получилось', e.message); }
    } }]);
  }
  function remove(m) {
    Alert.alert('Убрать из курса?', m.name, [{ text: 'Отмена', style: 'cancel' }, { text: 'Убрать', style: 'destructive', onPress: async () => { try { await api.removeMember(s.id, m.id); loadMembers(); } catch (e) { if (e.code !== 'expired') Alert.alert('Не получилось', e.message); } } }]);
  }
  return (
    <Screen>
      <Btn small title="← Назад" onPress={ctx.pop} />
      <H1>Курс</H1>
      <T muted>{st.title || st.name}</T>
      <T>Отправьте ученику и родителю их коды: в приложении они выбирают роль, создают аккаунт и вводят код.</T>
      {ready ? (<>
        <Card><T muted size={13} bold>Код ученика</T><T bold size={22}>{showCode(st.sc)}</T><View style={row}><Btn small title="Отправить" onPress={() => send('Код ученика', st.sc)} /><Btn small kind="danger" title="Новый код" onPress={() => renew('sc')} /></View></Card>
        <Card><T muted size={13} bold>Код родителя (только просмотр)</T><T bold size={22}>{showCode(st.pc)}</T><View style={row}><Btn small title="Отправить" onPress={() => send('Код родителя', st.pc)} /><Btn small kind="danger" title="Новый код" onPress={() => renew('pc')} /></View></Card>
      </>) : <ActivityIndicator />}
      <H3>Участники</H3>
      <Err>{merr}</Err>
      {members === null && !merr ? <ActivityIndicator /> : null}
      {members && !members.length ? <T muted>Пока никто не присоединился.</T> : null}
      {(members || []).map((m) => (
        <Card key={m.id}><T bold>{m.name + ' · ' + (m.as === 'parent' ? 'родитель' : 'ученик')}</T><T muted size={13}>{'Логин: ' + m.login}</T>
          <View style={row}><Btn small title="Сбросить пароль" onPress={() => reset(m)} /><Btn small kind="danger" title="Убрать" onPress={() => remove(m)} /></View></Card>
      ))}
      <Check label="Показывать оплату уроков ученику и родителям" value={!!st.showPay} onChange={(v) => ctx.act(J.put('students', Object.assign({}, st, { showPay: v })))} />
      {st.vk ? <Btn title="Отправить ссылку без регистрации" onPress={() => Share.share({ message: acct.server + '/s/' + st.vk })} /> : null}
    </Screen>
  );
}

/* ---------- оплата ---------- */
function Money({ ctx }) {
  const { J } = ctx;
  const groups = {};
  ctx.lessons().filter((l) => l.status === 'done' && !l.paid).sort(byStart).forEach((l) => { (groups[l.studentId] = groups[l.studentId] || []).push(l); });
  const ids = Object.keys(groups);
  const total = ids.reduce((a, id) => a + groups[id].reduce((x, l) => x + num(l.price), 0), 0);
  const payAll = (id) => ctx.act(J.putMany(groups[id].map((l) => ['lessons', Object.assign({}, l, { paid: true })])));
  const remind = (id) => Share.share({ message: 'Здравствуйте! Напоминаю про оплату занятий:\n' + groups[id].map((l) => fmtShort(l.date) + ' — ' + num(l.price)).join('\n') + '\nИтого: ' + groups[id].reduce((x, l) => x + num(l.price), 0) + '.' });
  return (
    <Screen onRefresh={() => J.refresh()} refreshing={false}>
      <Top ctx={ctx} title="Оплата" />
      <ErrBar ctx={ctx} />
      <Card><T muted size={13}>Всего не оплачено</T><T bold size={26}>{String(total)}</T></Card>
      {ids.map((id) => { const sum = groups[id].reduce((x, l) => x + num(l.price), 0); return (
        <Card key={id}>
          <T bold>{ctx.stuName(id) + ' · ' + sum}</T>
          <T muted size={13}>{groups[id].map((l) => fmtShort(l.date)).join(', ')}</T>
          <View style={row}><Btn small kind="primary" title="Оплачено" onPress={() => payAll(id)} /><Btn small title="Напомнить" onPress={() => remind(id)} /></View>
        </Card>); })}
      {!ids.length ? <T muted>Все проведённые уроки оплачены.</T> : null}
    </Screen>
  );
}

/* ---------- домашка ---------- */
function Homework({ ctx }) {
  const { J, S } = ctx;
  const all = Object.values(S.homework);
  const sub = all.filter((h) => h.status === 'submitted'), given = all.filter((h) => h.status === 'given').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const done = all.filter((h) => h.status === 'checked').sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 10);
  const card = (h) => (
    <Card key={h.id} onPress={() => ctx.push({ n: 'hw', id: h.id })}>
      <T bold>{ctx.stuName(h.studentId) + (h.due ? ' · к ' + fmtShort(h.due) : '')}</T>
      <T numberOfLines={3}>{h.text}</T>
      {h.status !== 'checked' ? <View style={row}>
        <Btn small kind={h.status === 'submitted' ? 'primary' : undefined} title={h.status === 'given' ? 'Сдано' : 'Проверено'} onPress={() => ctx.act(J.put('homework', Object.assign({}, h, { status: h.status === 'given' ? 'submitted' : 'checked' })))} />
        {h.status === 'submitted' ? <Btn small title="Вернуть" onPress={() => ctx.act(J.put('homework', Object.assign({}, h, { status: 'given' })))} /> : null}
      </View> : null}
    </Card>
  );
  const Sec = ({ title, list }) => (list.length ? <View style={{ gap: 8 }}><H3>{title}</H3>{list.map(card)}</View> : null);
  return (
    <Screen onRefresh={() => J.refresh()} refreshing={false}>
      <Top ctx={ctx} title="Домашка" />
      <ErrBar ctx={ctx} />
      <Btn kind="primary" title="+ Новое задание" onPress={() => ctx.push({ n: 'hw', id: '' })} />
      <Sec title="Сдано, ждёт проверки" list={sub} />
      <Sec title="Задано" list={given} />
      <Sec title="Проверено" list={done} />
      {!all.length ? <T muted>Заданий пока нет.</T> : null}
    </Screen>
  );
}

function HwForm({ ctx, s }) {
  const { J, S } = ctx;
  const cur = s.id ? S.homework[s.id] : null;
  const act = ctx.activeStudents();
  const pre = s.pre || {};
  const [sid, setSid] = useState(cur ? cur.studentId : pre.studentId || (act[0] && act[0].id) || '');
  const [text, setText] = useState(cur ? cur.text : pre.text || '');
  const [due, setDue] = useState(cur ? cur.due || '' : '');
  const [status, setStatus] = useState(cur ? cur.status : 'given');
  const [err, setErr] = useState('');
  async function save() {
    if (!sid) return setErr('Выберите ученика.');
    if (!text.trim()) return setErr('Напишите задание.');
    if (due && !okDate(due)) return setErr('Срок в формате 2026-12-31 или «Без срока».');
    const o = Object.assign({ lessonId: pre.lessonId || '' }, cur || {}, { id: cur ? cur.id : J.uid(), studentId: sid, text: text.trim(), due: due, status: cur ? status : 'given', created: cur ? cur.created : Date.now() });
    if (await ctx.act(J.put('homework', o))) ctx.pop();
  }
  function remove() { Alert.alert('Удалить задание?', '', [{ text: 'Отмена', style: 'cancel' }, { text: 'Удалить', style: 'destructive', onPress: async () => { if (await ctx.act(J.del('homework', cur.id))) ctx.pop(); } }]); }
  return (
    <Screen>
      <Btn small title="← Назад" onPress={ctx.pop} />
      <H1>{cur ? 'Домашнее задание' : 'Новое задание'}</H1>
      <Pick label="Ученик" options={act.map((x) => [x.id, x.name])} value={sid} onChange={setSid} />
      <Field label="Задание" value={text} onChangeText={setText} multiline numberOfLines={6} maxLength={5000} placeholder="Что решить, прочитать, повторить" />
      <View style={row}>{['Задачи № ', 'Повторить тему: ', 'Учебник, § ', 'Решить вариант № '].map((x) => <Chip key={x} title={x.trim()} onPress={() => setText((text && !/\n$/.test(text) ? text + '\n' : text) + x)} />)}</View>
      <DatePick label="Срок" value={due} onChange={setDue} allowEmpty />
      {cur ? <Pick label="Статус" options={[['given', 'Задано'], ['submitted', 'Сдано'], ['checked', 'Проверено']]} value={status} onChange={setStatus} /> : null}
      <Err>{err}</Err>
      <Btn kind="primary" title="Сохранить" onPress={save} />
      <Btn title="Поделиться заданием" onPress={() => Share.share({ message: 'Домашнее задание' + (S.students[sid] ? ' — ' + S.students[sid].name : '') + (due ? ' (к ' + fmtShort(due) + ')' : '') + ':\n' + text.trim() })} />
      {cur ? <Btn kind="danger" title="Удалить" onPress={remove} /> : null}
    </Screen>
  );
}

/* ---------- доска ---------- */
function TeacherBoard({ ctx, s }) {
  const { J, S, api, acct } = ctx;
  const l = S.lessons[s.id];
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!l || (l.room && l.room.url === acct.server)) return;
    (async () => {
      try { const r = await api.createRoom(); await J.put('lessons', Object.assign({}, l, { room: { id: r.id, tk: r.tk, sk: r.sk, url: acct.server }, board: true })); }
      catch (e) { if (e.code !== 'expired') setErr(e.message); }
    })();
  }, []);
  if (!l) return <Screen><Btn small title="← Назад" onPress={ctx.pop} /><T>Урок не найден.</T></Screen>;
  if (!l.room) return <Screen><Btn small title="← Назад" onPress={ctx.pop} /><Err>{err}</Err>{err ? null : <ActivityIndicator />}</Screen>;
  return <Board server={acct.server} lesson={{ room: { id: l.room.id, sk: l.room.tk } }} title={ctx.stuName(l.studentId) + ' · ' + dayTime(l.date, l.time)} onBack={ctx.pop} />;
}

/* ---------- настройки ---------- */
function Settings({ ctx, onLogout, onPassword }) {
  const { acct } = ctx;
  return (
    <Screen>
      <Btn small title="← Назад" onPress={ctx.pop} />
      <H1>Настройки</H1>
      <Card><T bold>{acct.name}</T><T muted>Учитель · логин: {acct.login}</T><T muted size={13}>{acct.server}</T></Card>
      <Btn title="Синхронизировать сейчас" onPress={() => ctx.act(ctx.J.refreshStrict(), 'Синхронизировано')} />
      <Btn title="Сменить пароль" onPress={() => { ctx.pop(); onPassword(); }} />
      <Btn kind="danger" title="Выйти из аккаунта" onPress={onLogout} />
    </Screen>
  );
}
