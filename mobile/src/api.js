// Работа с сервером. Не зависит от React, поэтому легко проверяется отдельно.
export function normServer(v) {
  let s = String(v || '').trim().replace(/\/+$/, '');
  if (!s) throw mkErr('input', 'Введите адрес сервера.');
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) { throw mkErr('input', 'Адрес сервера выглядит неправильно.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw mkErr('input', 'Адрес должен начинаться с https://');
  return u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, ''));
}
export function mkErr(code, msg) { return Object.assign(new Error(msg), { code: code }); }

export function createApi(env) {
  // env: { getAcct(), onExpired(), fetch? }
  const f = env.fetch || ((...a) => fetch(...a));
  async function call(method, path, body, opt) {
    opt = opt || {};
    const a = env.getAcct();
    const server = opt.server || (a && a.server);
    const token = opt.token !== undefined ? opt.token : (a && a.token);
    let r;
    try {
      r = await f(server + path, { method: method, headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) { throw mkErr('net', 'Нет связи с сервером. Проверьте интернет и адрес.'); }
    let j = {};
    try { j = await r.json(); } catch (e) { /* пусто */ }
    if (!r.ok) {
      if (r.status === 401 && token && !opt.noExpire) { env.onExpired(); throw mkErr('expired', 'Сессия закончилась. Войдите снова.'); }
      throw mkErr(j.error || 'http', j.message || ('Ошибка сервера ' + r.status + '.'));
    }
    return j;
  }
  const toAcct = (server, j) => ({ server: server, token: j.token, id: j.account.id, role: j.account.role, name: j.account.name, login: j.account.login });
  return {
    normServer: normServer,
    async register(server, o) { server = normServer(server); return toAcct(server, await call('POST', '/auth/register', o, { server: server, token: '' })); },
    async login(server, login, password) { server = normServer(server); return toAcct(server, await call('POST', '/auth/login', { login: login, password: password }, { server: server, token: '' })); },
    logout: (a) => call('POST', '/auth/logout', undefined, { noExpire: true, server: a && a.server, token: a ? a.token : undefined }).catch(() => {}),
    changePassword: (oldPw, newPw) => call('POST', '/auth/password', { old: oldPw, new: newPw }),
    async courses() { return (await call('GET', '/api/my/courses')).courses || []; },
    async join(code) { return (await call('POST', '/api/join', { code: code })).course; },
    leave: (cid) => call('DELETE', '/api/my/courses/' + cid),
    setHw: (cid, id, status) => call('POST', '/api/my/courses/' + cid + '/hw/' + id, { status: status }),
    call: call,
    sync: (since, changes) => call('POST', '/api/sync', { since: since, changes: changes }),
    createRoom: () => call('POST', '/api/rooms'),
    deleteRoom: (id) => call('DELETE', '/api/rooms/' + id).catch(() => {}),
    members: (sid) => call('GET', '/api/members/' + sid).then((j) => j.members || []),
    resetMember: (sid, aid) => call('POST', '/api/members/' + sid + '/' + aid + '/reset').then((j) => j.password),
    removeMember: (sid, aid) => call('DELETE', '/api/members/' + sid + '/' + aid),
    requestMove: (cid, o) => call('POST', '/api/my/courses/' + cid + '/requests', o),
  };
}
