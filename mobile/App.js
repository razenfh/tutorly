import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, View, ActivityIndicator, Alert } from 'react-native';
import { createApi } from './src/api';
import { loadAcct, saveAcct, lastServer } from './src/store';
import TeacherApp from './src/teacher';
import { Welcome, Auth, Home, Course, RequestMove, Password, Board } from './src/screens';
import { dayTime } from './src/util';

export default function App() {
  const [ready, setReady] = useState(false);
  const [acct, setAcctState] = useState(null);
  const acctRef = useRef(null);
  const [stack, setStack] = useState([{ n: 'welcome' }]);
  const [courses, setCourses] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [srv, setSrv] = useState('');

  const setAcct = useCallback(async (a) => { acctRef.current = a; setAcctState(a); await saveAcct(a); }, []);
  const expired = useCallback(() => {
    setAcct(null); setCourses([]); setLoaded(false); setStack([{ n: 'welcome' }]);
    setTimeout(() => Alert.alert('Сессия закончилась', 'Войдите снова.'), 100);
  }, [setAcct]);
  const api = useMemo(() => createApi({ getAcct: () => acctRef.current, onExpired: expired }), [expired]);

  useEffect(() => { (async () => {
    const a = await loadAcct(); setSrv(await lastServer());
    if (a) { acctRef.current = a; setAcctState(a); setStack([{ n: 'home' }]); }
    setReady(true);
  })(); }, []);

  const load = useCallback(async (manual) => {
    if (!acctRef.current || acctRef.current.role === 'teacher') return;
    if (manual) setRefreshing(true);
    try { setCourses(await api.courses()); setLoaded(true); setError(''); }
    catch (e) { if (e.code !== 'expired') setError(e.message); }
    finally { if (manual) setRefreshing(false); }
  }, [api]);

  useEffect(() => { if (acct && acct.role !== 'teacher') load(false); }, [acct, load]);
  useEffect(() => {
    const iv = setInterval(() => { if (AppState.currentState === 'active') load(false); }, 60000);
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') load(false); });
    return () => { clearInterval(iv); sub.remove(); };
  }, [load]);

  const push = (s) => setStack((st) => st.concat([s]));
  const pop = useCallback(() => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)), []);
  const reset = (s) => setStack([s]);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (stack.length > 1) { pop(); return true; } return false; });
    return () => sub.remove();
  }, [stack.length, pop]);

  async function logout() {
    await api.logout(); await setAcct(null); setCourses([]); setLoaded(false); reset({ n: 'welcome' });
  }

  if (!ready) return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>;
  const s = stack[stack.length - 1];
  const course = (cid) => courses.find((c) => c.cid === cid);

  if (s.n === 'welcome') return <Welcome onRole={(r) => push({ n: 'auth', role: r })} />;
  if (s.n === 'auth') return <Auth role={s.role} api={api} initialServer={srv} onBack={pop} onDone={async (a) => { await setAcct(a); setLoaded(false); reset({ n: 'home' }); }} />;
  if (!acct) return <Welcome onRole={(r) => push({ n: 'auth', role: r })} />;
  if (s.n === 'password') return <Password api={api} onBack={pop} />;
  if (s.n === 'home' && acct.role === 'teacher') return <TeacherApp acct={acct} api={api} onLogout={logout} onPassword={() => push({ n: 'password' })} />;
  if (s.n === 'home') return <Home acct={acct} courses={courses} loaded={loaded} refreshing={refreshing} error={error} api={api}
    onRefresh={() => load(true)} onOpen={(cid) => push({ n: 'course', cid })} onPassword={() => push({ n: 'password' })} onLogout={logout}
    onJoined={async (c) => { await load(false); push({ n: 'course', cid: c.cid }); }} />;
  const c = course(s.cid);
  if (!c) { if (loaded) setTimeout(() => reset({ n: 'home' }), 0); return <View style={{ flex: 1, justifyContent: 'center' }}><ActivityIndicator /></View>; }
  if (s.n === 'board') return <Board server={acct.server} lesson={s.lesson} title={c.title + ' · ' + dayTime(s.lesson.date, s.lesson.time)} onBack={pop} />;
  if (s.n === 'request') return <RequestMove c={c} lesson={s.lesson} api={api} onBack={pop} onSent={async () => { await load(false); pop(); }} />;
  return <Course c={c} api={api} refreshing={refreshing} onRefresh={() => load(true)} onBack={pop}
    onBoard={(l) => push({ n: 'board', cid: c.cid, lesson: l })} onRequest={(l) => push({ n: 'request', cid: c.cid, lesson: l })}
    onChanged={() => load(false)} onLeft={async () => { await load(false); reset({ n: 'home' }); }} />;
}
