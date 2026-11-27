// Журнал учителя на телефоне: хранится в памяти и синхронизируется с сервером (тот же протокол, что и у программы на компьютере).
const KINDS = ['students', 'lessons', 'homework', 'requests'];
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
const okId = (id) => typeof id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(id) && !(id in Object.prototype);

export function createJournal(api, rand) {
  const S = { students: {}, lessons: {}, homework: {}, requests: {} };
  let tomb = {}, rev = 0, epoch = '', chain = Promise.resolve();
  const st = { loaded: false, busy: false, error: '' };
  const subs = new Set();
  const emit = () => subs.forEach((f) => f());
  const enqueue = (fn) => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };

  function merge(ch) {
    KINDS.forEach((k) => (Array.isArray(ch[k]) ? ch[k] : []).forEach((r) => {
      if (!r || typeof r !== 'object' || !okId(r.id) || !(num(r.u) > 0)) return;
      const key = k + '/' + r.id, local = S[k][r.id];
      if (num(tomb[key]) >= num(r.u)) return;
      if (!local || num(r.u) >= num(local.u)) { S[k][r.id] = r; delete tomb[key]; }
    }));
    (Array.isArray(ch.tomb) ? ch.tomb : []).forEach((t) => {
      if (!t || KINDS.indexOf(t.k) < 0 || !okId(t.id) || !(num(t.u) > 0)) return;
      const key = t.k + '/' + t.id, local = S[t.k][t.id];
      if (local && num(t.u) >= num(local.u)) delete S[t.k][t.id];
      if (!S[t.k][t.id] && num(t.u) > num(tomb[key])) tomb[key] = num(t.u);
    });
  }
  function reset() { KINDS.forEach((k) => { S[k] = {}; }); tomb = {}; rev = 0; epoch = ''; unsent.clear(); }

  /* Локальные правки, которые сервер ещё не принял (ключ 'вид/id'). Каждый обмен отправляет их заново,
     поэтому правка, сделанная без связи, уйдёт при следующем обновлении, а не потеряется. */
  const unsent = new Set();
  function outgoing() {
    const ch = { tomb: [] }, sent = new Map();
    unsent.forEach((key) => {
      const i = key.indexOf('/'), k = key.slice(0, i), id = key.slice(i + 1);
      if (S[k][id]) { (ch[k] = ch[k] || []).push(S[k][id]); sent.set(key, num(S[k][id].u)); }
      else if (tomb[key]) { ch.tomb.push({ k: k, id: id, u: tomb[key] }); sent.set(key, num(tomb[key])); }
      else unsent.delete(key);
    });
    return { ch: ch, sent: sent };
  }
  const stampOf = (key) => { const i = key.indexOf('/'), r = S[key.slice(0, i)][key.slice(i + 1)]; return r ? num(r.u) : num(tomb[key]); };

  async function exchange() {
    for (let i = 0; i < 2; i++) {
      const out = outgoing();
      const j = await api.sync(rev, out.ch);
      if (epoch && j.epoch !== epoch) { reset(); continue; }
      merge(j.changes || {});
      epoch = String(j.epoch || ''); rev = num(j.rev);
      // принятое сервером больше не отправляем; если запись успели изменить, пока шёл запрос, она остаётся в очереди
      out.sent.forEach((u, key) => { if (stampOf(key) === u) unsent.delete(key); });
      return;
    }
    throw new Error('Сервер ответил неожиданно. Попробуйте ещё раз.');
  }
  const wrap = (fn) => enqueue(async () => {
    st.busy = true; emit();
    try { await fn(); st.error = ''; st.loaded = true; }
    catch (e) { if (e.code !== 'expired') st.error = e.message || 'Нет связи с сервером'; throw e; }
    finally { st.busy = false; emit(); }
  });

  const stamp = (old) => Math.max(Date.now(), num(old && old.u) + 1);
  function uid() {
    const b = rand(10); let s = '';
    for (let i = 0; i < 10; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[b[i] % 36];
    return 'm' + Date.now().toString(36) + s;
  }

  return {
    S: S, st: st, uid: uid,
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    refresh: () => wrap(() => exchange()).catch(() => {}),
    refreshStrict: () => wrap(() => exchange()),
    clear: () => { reset(); st.loaded = false; emit(); },
    pending: () => unsent.size,
    put(kind, obj) {
      obj = Object.assign({}, obj);
      obj.u = stamp(S[kind][obj.id]); delete tomb[kind + '/' + obj.id]; S[kind][obj.id] = obj; unsent.add(kind + '/' + obj.id); emit();
      const o = obj;
      return wrap(() => exchange()).then(() => o);
    },
    del(kind, id) {
      const old = S[kind][id], u = stamp(old);
      tomb[kind + '/' + id] = u; delete S[kind][id]; unsent.add(kind + '/' + id); emit();
      return wrap(() => exchange());
    },
    putMany(list) { // list: [[kind,obj],...] одним запросом
      list.forEach(([kind, obj]) => {
        obj = Object.assign({}, obj); obj.u = stamp(S[kind][obj.id]); delete tomb[kind + '/' + obj.id]; S[kind][obj.id] = obj;
        unsent.add(kind + '/' + obj.id);
      });
      emit();
      return wrap(() => exchange());
    },
  };
}
