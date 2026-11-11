import React, { useState } from 'react';
import { View, Pressable, Alert, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { Screen, T, H1, H3, Card, Btn, Field, Chip, Err, row, useTheme } from './ui';
import { colorOf, dayTime, fmtDM, parseYmd, fmtShort, endTime, byStart, lessonEnd, upcoming, normTime, nextDays, dayChip } from './util';
import { SERVER } from './config';

export function Welcome({ onRole }) {
  const t = useTheme();
  const Role = ({ id, title, text }) => (
    <Card onPress={() => onRole(id)}><T bold size={19}>{title}</T><T muted>{text}</T></Card>
  );
  return (
    <Screen>
      <H1>Журнал репетитора</H1>
      <T muted>Кто вы? Выберите, как вы будете пользоваться приложением.</T>
      <Role id="student" title="Я ученик" text="Мои уроки, домашка и доска на занятии" />
      <Role id="parent" title="Я родитель" text="Расписание, переносы и домашка ребёнка" />
      <Role id="teacher" title="Я учитель" text="Расписание, оплаты, домашка и доска с телефона" />
    </Screen>
  );
}

export function Auth({ role, api, initialServer, onDone, onBack }) {
  const [mode, setMode] = useState('login');
  const [server, setServer] = useState(SERVER || initialServer || '');
  const [name, setName] = useState('');
  const [login, setLogin] = useState('');
  const [pass, setPass] = useState('');
  const [invite, setInvite] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const reg = mode === 'register';
  async function go() {
    if (busy) return;
    setErr('');
    if (!login.trim() || !pass) return setErr('Введите логин и пароль.');
    if (reg && !name.trim()) return setErr('Введите имя.');
    setBusy(true);
    try {
      const a = reg ? await api.register(server, { role: role, name: name, login: login, password: pass, invite: invite }) : await api.login(server, login, pass);
      await onDone(a, reg);
    } catch (e) { setErr(e.message || 'Не удалось войти.'); } finally { setBusy(false); }
  }
  return (
    <Screen>
      <Btn small title="← Назад" onPress={onBack} />
      <H1>{role === 'parent' ? 'Вход для родителя' : role === 'teacher' ? 'Вход для учителя' : 'Вход для ученика'}</H1>
      <View style={row}>
        <Chip title="Войти" on={!reg} onPress={() => setMode('login')} />
        <Chip title="Создать аккаунт" on={reg} onPress={() => setMode('register')} />
      </View>
      {SERVER ? null : <Field label="Адрес сервера" value={server} onChangeText={setServer} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://board.example.com" />}
      {reg ? <Field label={role === 'parent' ? 'Ваше имя' : 'Как вас зовут'} value={name} onChangeText={setName} maxLength={60} /> : null}
      <Field label="Логин" value={login} onChangeText={setLogin} autoCapitalize="none" autoCorrect={false} maxLength={32} />
      {reg && role === 'teacher' ? <Field label="Код регистрации учителя (если сервер его требует)" value={invite} onChangeText={setInvite} autoCapitalize="none" autoCorrect={false} /> : null}
      <Field label="Пароль" value={pass} onChangeText={setPass} secureTextEntry autoCapitalize="none" maxLength={128} />
      <Err>{err}</Err>
      <Btn kind="primary" title={busy ? 'Подождите…' : reg ? 'Создать аккаунт' : 'Войти'} onPress={go} disabled={busy} />
      {reg ? <T muted size={13}>Логин от 3 символов, пароль от 6. Почта не нужна. Если забудете пароль, его сбросит учитель.</T> : null}
    </Screen>
  );
}

export function Home({ acct, courses, loaded, refreshing, onRefresh, onOpen, api, onJoined, onLogout, onPassword, error }) {
  const [showJoin, setShowJoin] = useState(false);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const joinForm = showJoin || (loaded && !courses.length);
  async function join() {
    if (busy) return;
    if (!code.trim()) return setErr('Введите код курса.');
    setBusy(true); setErr('');
    try { const c = await api.join(code); setCode(''); setShowJoin(false); await onJoined(c); } catch (e) { if (e.code !== 'expired') setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <View style={[row, { justifyContent: 'space-between' }]}>
        <View><T bold>{acct.name}</T><T muted size={13}>{acct.role === 'parent' ? 'Родитель' : 'Ученик'}</T></View>
        <View style={row}><Btn small title="Пароль" onPress={onPassword} /><Btn small title="Выйти" onPress={onLogout} /></View>
      </View>
      <H1>Мои курсы</H1>
      {joinForm ? (
        <Card>
          <Field label={acct.role === 'parent' ? 'Родительский код курса' : 'Код курса'} value={code} onChangeText={setCode} autoCapitalize="characters" autoCorrect={false} maxLength={20} placeholder="K7M2-Q9XA-4B" />
          <Err>{err}</Err>
          <Btn kind="primary" title="Присоединиться" onPress={join} disabled={busy} />
          {showJoin ? <Btn title="Отмена" onPress={() => { setShowJoin(false); setErr(''); }} /> : null}
        </Card>
      ) : <Btn title="Присоединиться к курсу" onPress={() => setShowJoin(true)} />}
      <Err>{error}</Err>
      {!loaded ? <ActivityIndicator /> : null}
      {courses.map((c) => <CourseCard key={c.cid} c={c} onPress={() => onOpen(c.cid)} />)}
      {loaded && !courses.length ? <T muted>Пока нет ни одного курса. Введите код, который дал учитель.</T> : null}
    </Screen>
  );
}

function CourseCard({ c, onPress }) {
  const up = upcoming(c)[0], open = c.homework.filter((h) => h.status === 'given').length;
  return (
    <Card onPress={onPress} style={{ padding: 0, overflow: 'hidden', gap: 0 }}>
      <View style={{ backgroundColor: colorOf(c.cid), padding: 14, minHeight: 84, justifyContent: 'flex-end' }}>
        <T bold size={19} color="#fff">{c.title}</T>
        <T size={13} color="#fff">{c.as === 'parent' ? 'Ребёнок: ' + c.student.name : c.teacher.name || 'Учитель'}</T>
      </View>
      <View style={{ padding: 12, gap: 2 }}>
        <T>{up ? 'Ближайший урок: ' + dayTime(up.date, up.time) : 'Уроков в расписании нет'}</T>
        <T muted size={13}>{open ? 'Домашка к сдаче: ' + open : 'Домашки к сдаче нет'}</T>
      </View>
    </Card>
  );
}

const REQ_TXT = { pending: 'ждёт ответа', accepted: 'учитель перенёс урок', declined: 'учитель отказал' };
export function Course({ c, refreshing, onRefresh, onBack, onBoard, onRequest, api, onChanged, onLeft }) {
  const t = useTheme();
  const pendingFor = (lid) => (c.requests || []).some((q) => q.lessonId === lid && q.status === 'pending');
  const from = new Date(Date.now() - 30 * 86400000); const fromStr = from.toISOString().slice(0, 10);
  const up = upcoming(c);
  const moved = c.lessons.filter((l) => l.status === 'cancelled' && l.date >= fromStr).sort(byStart).reverse();
  const past = c.lessons.filter((l) => l.status === 'done').sort(byStart).reverse().slice(0, 5);
  const boards = c.lessons.filter((l) => l.room && (l.status === 'done' || lessonEnd(l) < new Date())).sort(byStart).reverse();
  const open = c.homework.filter((h) => h.status !== 'checked').sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.created - b.created);
  const done = c.homework.filter((h) => h.status === 'checked').sort((a, b) => b.created - a.created).slice(0, 3);
  const canMark = c.as === 'student';
  const [busyId, setBusyId] = useState('');
  async function mark(h) {
    setBusyId(h.id);
    try { await api.setHw(c.cid, h.id, h.status === 'submitted' ? 'given' : 'submitted'); await onChanged(); } catch (e) { if (e.code !== 'expired') Alert.alert('Не получилось', e.message); } finally { setBusyId(''); }
  }
  function leave() {
    Alert.alert('Покинуть курс?', 'Чтобы вернуться, понадобится код курса.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Покинуть', style: 'destructive', onPress: async () => { try { await api.leave(c.cid); await onLeft(); } catch (e) { if (e.code !== 'expired') Alert.alert('Не получилось', e.message); } } },
    ]);
  }
  const Sec = ({ title, items }) => (items.length ? <View style={{ gap: 8 }}><H3>{title}</H3>{items}</View> : null);
  return (
    <Screen onRefresh={onRefresh} refreshing={refreshing}>
      <Btn small title="← Мои курсы" onPress={onBack} />
      <View style={{ backgroundColor: colorOf(c.cid), borderRadius: 14, padding: 18 }}>
        <T bold size={24} color="#fff">{c.title}</T>
        <T color="#fff">{(c.as === 'parent' ? 'Ребёнок: ' : '') + c.student.name + ' · учитель ' + c.teacher.name}</T>
      </View>
      {c.as === 'parent' ? <T muted size={13}>Вы вошли как родитель: можно смотреть расписание, переносы и домашку.</T> : null}
      <H3>Ближайшие уроки</H3>
      {up.length ? up.map((l) => (
        <Card key={l.id}>
          <T bold>{dayTime(l.date)}</T>
          <T>{l.time + '–' + endTime(l) + (l.topic ? ' · ' + l.topic : '')}</T>
          {l.movedFrom ? <T muted size={13}>{'Перенесён с ' + dayTime(l.movedFrom, l.movedFromTime)}</T> : null}
          {l.paid !== undefined ? <T color={l.paid ? t.ok : t.red} bold size={13}>{l.paid ? 'Оплачен' : 'Не оплачен'}</T> : null}
          <View style={row}>
            {l.room ? <Btn small title="Открыть доску" onPress={() => onBoard(l)} /> : null}
            {pendingFor(l.id) ? <T muted size={13}>Запрос на перенос отправлен</T> : <Btn small title="Попросить перенести" onPress={() => onRequest(l)} />}
          </View>
        </Card>
      )) : <T muted>Пока уроков в расписании нет.</T>}
      <Sec title="Переносы и отмены" items={moved.map((l) => (
        <Card key={l.id}>
          <T bold>{dayTime(l.date, l.time)}</T>
          <T>{l.movedTo ? 'Перенесён на ' + dayTime(l.movedTo, l.movedToTime) : 'Урок отменён'}</T>
          {l.reason ? <T color={t.red}>{'Причина: ' + l.reason}</T> : null}
        </Card>
      ))} />
      <Sec title="Ваши запросы на перенос" items={(c.requests || []).slice(0, 5).map((q) => (
        <Card key={q.id}>
          <T bold>{'Хотели: ' + dayTime(q.date, q.time)}</T>
          <T muted>{'Причина: ' + q.reason}</T>
          <T color={q.status === 'declined' ? t.red : t.ink}>{(REQ_TXT[q.status] || '') + (q.reply ? ': ' + q.reply : '')}</T>
        </Card>
      ))} />
      <H3>Домашнее задание</H3>
      {open.length ? open.map((h) => (
        <Card key={h.id}>
          <T muted size={13}>{(h.due ? 'Срок: ' + fmtDM(parseYmd(h.due)) : 'Без срока') + (h.status === 'submitted' ? ' · сдано, учитель проверяет' : '')}</T>
          <T>{h.text}</T>
          {canMark ? <Btn small kind={h.status === 'submitted' ? undefined : 'primary'} disabled={busyId === h.id} title={h.status === 'submitted' ? 'Снять отметку «сдано»' : 'Я сдал(а)'} onPress={() => mark(h)} /> : null}
        </Card>
      )) : <T muted>Сейчас заданий нет.</T>}
      <Sec title="Проверено" items={done.map((h) => <Card key={h.id}><T>{h.text}</T></Card>)} />
      <Sec title="Недавние уроки" items={past.map((l) => (
        <Card key={l.id}><T bold>{fmtShort(l.date) + ' · ' + (l.topic || 'Урок')}</T></Card>
      ))} />
      <Sec title="Доски прошлых уроков" items={boards.map((l) => (
        <Card key={'b' + l.id}><T bold>{fmtShort(l.date) + ' · ' + (l.topic || 'Урок')}</T><Btn small title="Открыть доску" onPress={() => onBoard(l)} /></Card>
      ))} />
      <View style={{ marginTop: 16 }}><Btn small kind="danger" title="Покинуть курс" onPress={leave} /></View>
    </Screen>
  );
}

export function RequestMove({ c, lesson, api, onBack, onSent }) {
  const [date, setDate] = useState(lesson.date);
  const [time, setTime] = useState(lesson.time);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const days = nextDays(14);
  async function send() {
    if (busy) return;
    const tm = normTime(time);
    if (!tm) return setErr('Время в формате 17:30.');
    if (!reason.trim()) return setErr('Напишите причину.');
    setBusy(true); setErr('');
    try { await api.requestMove(c.cid, { lessonId: lesson.id, date: date, time: tm, reason: reason.trim() }); await onSent(); } catch (e) { if (e.code !== 'expired') setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Screen>
      <Btn small title="← Назад" onPress={onBack} />
      <H1>Перенос урока</H1>
      <T muted>{'Сейчас: ' + dayTime(lesson.date, lesson.time) + '. Учитель увидит запрос и перенесёт урок или ответит.'}</T>
      <T muted size={13} bold>Желаемый день</T>
      <View style={row}>{days.map((d) => <Chip key={d} title={dayChip(d)} on={d === date} onPress={() => setDate(d)} />)}</View>
      <Field label="Желаемое время" value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" maxLength={5} placeholder="17:30" />
      <Field label="Причина" value={reason} onChangeText={setReason} multiline numberOfLines={3} maxLength={300} placeholder="Например: болею, экзамен в школе" />
      <Err>{err}</Err>
      <Btn kind="primary" title={busy ? 'Отправляем…' : 'Отправить запрос'} onPress={send} disabled={busy} />
    </Screen>
  );
}

export function Password({ api, onBack }) {
  const [o, setO] = useState(''); const [n, setN] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function go() {
    if (busy) return;
    setBusy(true); setErr('');
    try { await api.changePassword(o, n); Alert.alert('Готово', 'Пароль изменён.'); onBack(); } catch (e) { if (e.code !== 'expired') setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Screen>
      <Btn small title="← Назад" onPress={onBack} />
      <H1>Смена пароля</H1>
      <Field label="Старый пароль" value={o} onChangeText={setO} secureTextEntry autoCapitalize="none" />
      <Field label="Новый пароль" value={n} onChangeText={setN} secureTextEntry autoCapitalize="none" />
      <Err>{err}</Err>
      <Btn kind="primary" title="Сменить пароль" onPress={go} disabled={busy} />
    </Screen>
  );
}

export function Board({ server, lesson, title, onBack }) {
  const t = useTheme();
  const origin = new URL(server).origin;
  const uri = server + '/r/' + lesson.room.id + '?k=' + lesson.room.sk;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ paddingTop: 44, paddingHorizontal: 12, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Btn small title="← Назад" onPress={onBack} />
        <T bold style={{ flex: 1 }}>{title}</T>
      </View>
      <WebView source={{ uri: uri }} style={{ flex: 1 }} bounces={false} overScrollMode="never" setSupportMultipleWindows={false}
        originWhitelist={[origin]} onShouldStartLoadWithRequest={(r) => r.url.indexOf(origin) === 0 || r.url.indexOf('about:') === 0}
        startInLoadingState renderLoading={() => <ActivityIndicator style={{ position: 'absolute', top: 80, alignSelf: 'center' }} />} />
    </View>
  );
}
