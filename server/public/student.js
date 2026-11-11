(function () {
'use strict';
/* Страница ученика: открывает доску комнаты и подключается к серверу. */
const m = location.pathname.match(/^\/r\/([A-Za-z0-9_-]{16,64})\/?$/);
const key = new URLSearchParams(location.search).get('k') || '';
const toastEl = document.getElementById('toast');
let toastT = 0;
window.toast = function (t) {
  toastEl.textContent = t; toastEl.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(function () { toastEl.hidden = true; }, 2600);
};
window.api = {
  boardLoad: function () { return Promise.resolve({ data: null }); },
  boardSave: function () { return Promise.resolve(true); },
  boardSaveSync: function () { return true; },
  copy: function () { return Promise.resolve(true); },
  savePng: function (name, url) {
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    return Promise.resolve({ ok: true });
  },
};
if (!m || !key) {
  document.body.innerHTML = '<p style="font:16px system-ui;padding:24px">Ссылка неполная. Попросите репетитора прислать её ещё раз.</p>';
  return;
}
async function begin() {
  await window.Board.open({ id: m[1], title: 'Доска урока', onClose: function () { setTimeout(begin, 0); } });
  window.Live.start({ server: location.origin, room: m[1], key: key, board: window.Board });
}
begin();
})();
