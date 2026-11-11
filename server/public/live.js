(function () {
'use strict';
/* Соединение доски с сервером: переподключение, передача сообщений в Board. */
function wsUrl(server) {
  const u = new URL(server);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  u.pathname = u.pathname.replace(/\/+$/, '') + '/ws';
  u.search = ''; u.hash = '';
  return u;
}
window.Live = {
  start: function (o) {
    const board = o.board;
    let ws = null, stopped = false, tries = 0, timer = 0, up = false;
    const status = (s) => { try { board.liveStatus(s); } catch (e) { /* ignore */ } if (o.onState) o.onState(s); };
    function retry() {
      if (stopped) return;
      tries++;
      timer = setTimeout(connect, Math.min(15000, 500 * Math.pow(2, Math.min(tries, 5))));
    }
    function connect() {
      if (stopped) return;
      status('connecting');
      let u;
      try { u = wsUrl(o.server); } catch (e) { status('denied'); stopped = true; return; }
      u.searchParams.set('room', o.room);
      u.searchParams.set('key', o.key);
      let mine;
      try { mine = ws = new WebSocket(u.toString()); } catch (e) { retry(); return; }
      mine.onopen = () => {
        if (stopped || ws !== mine) return;
        tries = 0; up = true;
        board.connect((m) => { if (mine.readyState === 1) mine.send(JSON.stringify(m)); });
      };
      mine.onmessage = (ev) => {
        if (ws !== mine) return;
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        board.receive(m);
      };
      mine.onclose = (ev) => {
        if (ws !== mine) return;
        if (up) { up = false; board.disconnect(); }
        if (stopped) return;
        if (ev.code === 4401 || ev.code === 4404 || ev.code === 4429) {
          stopped = true;
          status(ev.code === 4429 ? 'full' : 'denied');
          return;
        }
        status('offline');
        retry();
      };
      mine.onerror = () => {};
    }
    connect();
    return {
      stop: function () {
        stopped = true; clearTimeout(timer);
        const w = ws; ws = null;
        if (up) { up = false; try { board.disconnect(); } catch (e) { /* ignore */ } }
        if (w) { try { w.close(1000); } catch (e) { /* ignore */ } }
        status('');
      },
    };
  },
};
})();
