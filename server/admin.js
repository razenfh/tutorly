#!/usr/bin/env node
'use strict';
/* Администрирование сервера: список аккаунтов, сброс пароля, удаление.
   Использование (на сервере или откуда угодно, где виден сервер):
     ADMIN_TOKEN=... node admin.js list
     ADMIN_TOKEN=... node admin.js reset <логин> [новый_пароль]
     ADMIN_TOKEN=... node admin.js delete <логин>
   Адрес по умолчанию http://127.0.0.1:8787, другой через SERVER=https://... */
const base = (process.env.SERVER || 'http://127.0.0.1:' + (process.env.PORT || 8787)).replace(/\/+$/, '');
const token = process.env.ADMIN_TOKEN;
const [cmd, login, pw] = process.argv.slice(2);
if (!token || !cmd) { console.error('Нужен ADMIN_TOKEN и команда: list | reset <логин> [пароль] | delete <логин>'); process.exit(1); }
async function call(method, path, body) {
  const r = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { console.error('Ошибка', r.status, j.message || ''); process.exit(1); }
  return j;
}
(async () => {
  if (cmd === 'list') {
    const j = await call('GET', '/admin/accounts');
    (j.accounts || []).forEach((a) => console.log(a.role.padEnd(8), a.login.padEnd(20), a.name, '(курсов: ' + a.courses + ')'));
  } else if (cmd === 'reset' && login) {
    const j = await call('POST', '/admin/reset', { login, password: pw });
    console.log('Новый пароль для', login + ':', j.password);
  } else if (cmd === 'delete' && login) {
    await call('DELETE', '/admin/accounts/' + encodeURIComponent(login));
    console.log('Удалён', login);
  } else { console.error('Неизвестная команда'); process.exit(1); }
})();
