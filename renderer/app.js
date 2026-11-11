
(function(){
'use strict';

/* ---------- helpers ---------- */
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const ymd=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const parseYmd=s=>{const p=String(s).split('-').map(Number);return new Date(p[0],p[1]-1,p[2])};
const addDays=(d,n)=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()+n);return x};
const startOfWeek=d=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()-((x.getDay()+6)%7));return x};
const num=v=>Number(v)||0;
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const uid=()=>'i'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const fmtDM=d=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long'}).format(d);
const fmtDMs=d=>new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short'}).format(d).replace('.','');
const fmtWd=d=>cap(new Intl.DateTimeFormat('ru-RU',{weekday:'long'}).format(d));
const fmtShort=s=>{const d=parseYmd(s);return pad(d.getDate())+'.'+pad(d.getMonth()+1)};
const monthWord=d=>cap(new Intl.DateTimeFormat('ru-RU',{month:'long'}).format(d));
const NB=' ';

const P={
  plus:'<path d="M12 5v14M5 12h14"/>',
  left:'<path d="M15 6l-6 6 6 6"/>',
  right:'<path d="M9 6l6 6-6 6"/>',
  check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8"/>',
  copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  cal:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>',
  people:'<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5"/><path d="M16 6.2a3 3 0 010 5.6M18 14.8c1.7.6 2.8 2 3.2 4.2"/>',
  wallet:'<rect x="3.5" y="6.5" width="17" height="12" rx="2"/><path d="M3.5 10h17M16 14.5h1.5"/>',
  book:'<path d="M5 4.5h10a3 3 0 013 3V20H8a3 3 0 01-3-3V4.5z"/><path d="M8 17h10"/>',
  send:'<path d="M4 12l16-8-6 16-3-7-7-1z"/>'
};
const svg=p=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+p+'</svg>';

/* ---------- state ---------- */
const KINDS=['students','lessons','homework','requests'];
const S={students:{},lessons:{},homework:{},requests:{},prefs:{currency:'₴'},tomb:{},sync:{sent:0,rev:0,epoch:''},acct:null,owner:'',local:false};
const LS='journal-repetitora-v1';
let sync='ok';
const view={tab:'schedule',week:startOfWeek(new Date()),month:new Date(new Date().getFullYear(),new Date().getMonth(),1)};

const money=n=>new Intl.NumberFormat('ru-RU').format(Math.round(num(n)))+NB+S.prefs.currency;
const studentsArr=()=>Object.values(S.students).sort((a,b)=>String(a.name).localeCompare(String(b.name),'ru'));
const activeStudents=()=>studentsArr().filter(s=>!s.archived);
const lessonsArr=()=>Object.values(S.lessons);
const hwArr=()=>Object.values(S.homework);
const stuName=id=>(S.students[id]&&S.students[id].name)||'Без ученика';
const lessonStart=l=>{const d=parseYmd(l.date);const t=String(l.time||'00:00').split(':').map(Number);d.setHours(t[0]||0,t[1]||0,0,0);return d};
const lessonEnd=l=>new Date(lessonStart(l).getTime()+num(l.dur)*60000);
const isPast=l=>lessonEnd(l)<new Date();
const endTime=l=>{const t=String(l.time||'00:00').split(':').map(Number);const m=(t[0]||0)*60+(t[1]||0)+num(l.dur);return pad(Math.floor(m/60)%24)+':'+pad(m%60)};
const byStart=(a,b)=>lessonStart(a)-lessonStart(b);
function nextLessonDate(sid){
  const now=new Date();
  const c=lessonsArr().filter(l=>l.studentId===sid&&l.status==='planned'&&lessonStart(l)>=now).sort(byStart);
  return c.length?c[0].date:'';
}

/* ---------- storage: one JSON file on this computer ---------- */
let dataPath='', saveTimer=0, dirty=false, saving=Promise.resolve();
const snapshotJson=(backup)=>{
  const o={version:1,students:S.students,lessons:S.lessons,homework:S.homework,requests:S.requests,prefs:Object.assign({},S.prefs),tomb:S.tomb,sync:S.sync};
  delete o.prefs.server;
  if(!backup){o.acct=S.acct;o.owner=S.owner;o.local=S.local}
  return JSON.stringify(o);
};
const okAcct=a=>a&&typeof a==='object'&&typeof a.server==='string'&&/^https?:\/\//.test(a.server)&&['teacher','student','parent'].indexOf(a.role)>=0&&typeof a.id==='string'?{server:a.server,token:typeof a.token==='string'?a.token:'',id:a.id,role:a.role,name:String(a.name||''),login:String(a.login||'')}:null;
function loadInto(j){
  KINDS.forEach(k=>{S[k]=(j&&j[k])||{}});
  S.prefs=Object.assign({currency:'₴'},(j&&j.prefs)||{});
  S.tomb=(j&&j.tomb&&typeof j.tomb==='object')?j.tomb:{};
  S.sync=Object.assign({sent:0,rev:0,epoch:''},(j&&j.sync)||{});
  delete S.prefs.server;
  if(!loadInto.keep){S.acct=okAcct(j&&j.acct);S.owner=(j&&typeof j.owner==='string')?j.owner:'';S.local=!!(j&&j.local)}
  const t0=Date.now(); let n=0;
  KINDS.forEach(k=>Object.values(S[k]).forEach(r=>{if(!(num(r.u)>0)){r.u=t0+(n++)}}));
  if(n) persist(true);
}
function flushNow(){
  if(!dirty) return saving;
  dirty=false;
  const text=snapshotJson();
  saving=saving.then(()=>window.api.save(text)).then(()=>{if(sync!=='ok'){sync='ok';render()}}).catch(()=>{sync='error';render();toast('Не удалось записать файл с данными')});
  return saving;
}
function persist(quiet){dirty=true;clearTimeout(saveTimer);saveTimer=setTimeout(flushNow,150);if(!quiet) scheduleSync()}
window.addEventListener('beforeunload',()=>{
  if(dirty){dirty=false;try{window.api.saveSync(snapshotJson())}catch(e){}}
});
const stamp=old=>Math.max(Date.now(),num(old&&old.u)+1);
function put(kind,obj){obj.u=stamp(S[kind][obj.id]);delete S.tomb[kind+'/'+obj.id];S[kind][obj.id]=obj;persist();render()}
function dropRoom(l){
  const srv=syncCfg();
  if(l&&l.room&&l.room.id&&srv&&l.room.url===srv.url){
    fetch(srv.url+'/api/rooms/'+l.room.id,{method:'DELETE',headers:{Authorization:'Bearer '+srv.token}}).catch(()=>{});
  }
}
function del(kind,id){const old=S[kind][id];S.tomb[kind+'/'+id]=stamp(old);delete S[kind][id];if(kind==='lessons'){if(window.api.boardDelete)window.api.boardDelete(id);dropRoom(old)}persist();render()}
function savePrefs(){persist();render()}

/* ---------- синхронизация с сервером ---------- */
const syncCfg=()=>{const a=S.acct;return a&&a.role==='teacher'&&a.server&&a.token?{url:a.server,token:a.token}:null};
let syncing=false,syncPending=false,syncTimer=0,syncRun=Promise.resolve(false),syncInfo={state:'off',at:0,msg:''};
const okSyncId=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(id)&&!(id in Object.prototype);
function scheduleSync(){
  if(!syncCfg()) return;
  if(syncing){syncPending=true;return}
  clearTimeout(syncTimer); syncTimer=setTimeout(syncNow,2000);
}
function applyPull(ch){
  let n=0;
  KINDS.forEach(k=>(Array.isArray(ch[k])?ch[k]:[]).forEach(r=>{
    if(!r||typeof r!=='object'||!okSyncId(r.id)||!(num(r.u)>0)) return;
    const key=k+'/'+r.id, local=S[k][r.id];
    if(num(S.tomb[key])>=num(r.u)) return;
    if(!local||num(r.u)>num(local.u)){S[k][r.id]=r;delete S.tomb[key];n++}
  }));
  (Array.isArray(ch.tomb)?ch.tomb:[]).forEach(t=>{
    if(!t||KINDS.indexOf(t.k)<0||!okSyncId(t.id)||!(num(t.u)>0)) return;
    const key=t.k+'/'+t.id, local=S[t.k][t.id];
    if(local&&num(t.u)>=num(local.u)){delete S[t.k][t.id];if(t.k==='lessons'&&window.api.boardDelete)window.api.boardDelete(t.id);n++}
    if(!S[t.k][t.id]&&num(t.u)>num(S.tomb[key])) S.tomb[key]=num(t.u);
  });
  return n;
}
async function doSync(){
  const cfg=syncCfg();
  for(let attempt=0;attempt<2;attempt++){
    const known=!!S.sync.epoch, sent=known?num(S.sync.sent):0, since=known?num(S.sync.rev):0;
    const out={students:[],lessons:[],homework:[],requests:[],tomb:[]}; let maxU=0;
    KINDS.forEach(k=>Object.values(S[k]).forEach(r=>{if(num(r.u)>=sent){out[k].push(r);maxU=Math.max(maxU,num(r.u))}}));
    Object.keys(S.tomb).forEach(key=>{const u=num(S.tomb[key]);if(u>=sent){const i=key.indexOf('/');out.tomb.push({k:key.slice(0,i),id:key.slice(i+1),u:u});maxU=Math.max(maxU,u)}});
    let r;
    const req=()=>fetch(cfg.url+'/api/sync',{method:'POST',headers:{Authorization:'Bearer '+cfg.token,'Content-Type':'application/json'},body:JSON.stringify({since:since,changes:out})});
    try{try{r=await req()}catch(e){await new Promise(z=>setTimeout(z,400));r=await req()}} // одна повторная попытка: после перезапуска сервера старое соединение рвётся
    catch(e){throw new Error('Сервер недоступен. Проверьте адрес и интернет.')}
    if(r.status===401){if(window.Portal&&S.acct&&S.acct.token){clearToken()}throw new Error('Сессия закончилась. Войдите снова.')}
    if(!r.ok) throw new Error('Ошибка сервера '+r.status+'.');
    const j=await r.json();
    if(known&&j.epoch!==S.sync.epoch){S.sync={sent:0,rev:0,epoch:j.epoch};continue}
    applyPull(j.changes||{});
    S.sync={sent:Math.max(sent,maxU),rev:num(j.rev),epoch:String(j.epoch||'')};
    return true;
  }
  throw new Error('Сервер ответил неожиданно. Попробуйте ещё раз.');
}
function syncNow(){
  if(!syncCfg()){syncInfo={state:'off',at:0,msg:''};return Promise.resolve(false)}
  if(syncing){syncPending=true;return syncRun}
  syncing=true; syncInfo={state:'run',at:syncInfo.at,msg:''}; render();
  syncRun=doSync().then(()=>{syncInfo={state:'ok',at:Date.now(),msg:''};persist(true);return true},e=>{
    const first=syncInfo.state!=='err';
    syncInfo={state:'err',at:syncInfo.at,msg:(e&&e.message)||'Не удалось синхронизировать.'};
    if(first) toast(syncInfo.msg);
    return false;
  }).then(ok=>{syncing=false;render();if(syncPending){syncPending=false;scheduleSync()}return ok});
  return syncRun;
}
function newKey(){
  const b=new Uint8Array(24); crypto.getRandomValues(b);
  return btoa(String.fromCharCode.apply(null,b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function clearToken(){
  if(S.acct){S.acct=Object.assign({},S.acct,{token:''});persist(true);render()}
  if(window.Portal) window.Portal.route();
}
function hasLocalData(){return KINDS.some(k=>Object.keys(S[k]).length>0)}
window.AppBridge={
  getAcct:()=>S.acct,
  setAcct:(a)=>{
    S.acct=okAcct(a);
    if(S.acct){S.local=false;if(S.acct.role==='teacher'){S.owner=S.acct.id;S.prefs.lastServer=S.acct.server}else S.prefs.lastServer=S.acct.server}
    persist(true);render();
    if(S.acct&&S.acct.role==='teacher'){S.sync={sent:0,rev:0,epoch:''};syncNow()}
    else if(window.Portal) window.Portal.route();
  },
  clearToken:clearToken,
  isLocal:()=>!!S.local,
  setLocal:()=>{S.local=true;persist(true);if(window.Portal) window.Portal.route()},
  hasLocalData:hasLocalData,
  ownerMismatch:(id)=>!!S.owner&&S.owner!==id&&hasLocalData(),
  wipeLocal:()=>{
    KINDS.forEach(k=>{Object.keys(S[k]).forEach(id=>{if(k==='lessons'&&window.api.boardDelete)window.api.boardDelete(id)});S[k]={}});
    S.tomb={};S.sync={sent:0,rev:0,epoch:''};S.owner='';persist(true);render();
  },
  lastServer:()=>S.prefs.lastServer||'',
};
async function boot(){
  try{const r=await window.api.load();dataPath=r.path||'';loadInto(r.data)}
  catch(e){sync='error'}
  render();
  if(window.Portal) window.Portal.route();
  if(syncCfg()) syncNow();
  const iv=setInterval(()=>{if(syncCfg()) syncNow()},60000); if(iv&&iv.unref) iv.unref();
  window.addEventListener('focus',scheduleSync);
}

/* ---------- rendering ---------- */
let rq=false;
function render(){ if(rq) return; rq=true; Promise.resolve().then(()=>{rq=false;draw()}) }

const TABS=[['schedule','Расписание','cal'],['students','Ученики','people'],['money','Оплата','wallet'],['homework','Домашка','book']];
const pendingReqs=()=>Object.values(S.requests).filter(q=>q.status==='pending'&&S.lessons[q.lessonId]&&S.students[q.studentId]).sort((a,b)=>num(a.created)-num(b.created));
function badges(){
  const unmarked=lessonsArr().filter(l=>l.status==='planned'&&isPast(l)).length;
  const debt=lessonsArr().filter(l=>l.status==='done'&&!l.paid).length;
  const check=hwArr().filter(h=>h.status==='submitted').length;
  return {schedule:unmarked,students:0,money:debt,homework:check};
}
function draw(){
  const st={ok:['','Сохранено на этом компьютере'],error:['warn','Не удалось записать файл']}[sync]||['idle',''];
  const si=syncCfg()?({err:' · нет связи с сервером',run:' · синхронизация…',ok:' · синхронизировано'}[syncInfo.state]||''):'';
  $('#status').innerHTML='<span class="dot '+st[0]+'"></span>'+esc(st[1]+si);
  const b=badges();
  $('#nav').innerHTML=TABS.map(t=>'<button data-a="tab" data-tab="'+t[0]+'"'+(view.tab===t[0]?' aria-current="page"':'')+'>'+svg(P[t[2]])+'<span>'+t[1]+'</span>'+(b[t[0]]?'<i class="badge" style="font-style:normal">'+b[t[0]]+'</i>':'')+'</button>').join('');
  $('#main').innerHTML=({schedule:viewSchedule,students:viewStudents,money:viewMoney,homework:viewHomework})[view.tab]();
}

function onboarding(){
  return '<div class="card empty"><h2>Начните с первого ученика</h2><p>Добавьте ученика с ценой урока, затем ставьте уроки в расписание. Проведённые и оплаченные уроки отмечаются одним касанием.</p><div class="btn-row"><button class="btn primary" data-a="addStudent">'+svg(P.plus)+'Добавить ученика</button><button class="btn" data-a="demo">Показать пример</button></div></div>';
}

function weekLabel(a,b){
  if(a.getMonth()===b.getMonth()) return a.getDate()+'–'+b.getDate()+NB+fmtDM(b).replace(/^\d+\s/,'');
  return fmtDMs(a)+' – '+fmtDMs(b);
}

function lessonCard(l){
  const s=S.students[l.studentId]||{};
  const cancelled=l.status==='cancelled', done=l.status==='done';
  const needs=l.status==='planned'&&isPast(l);
  const unpaidDone=done&&!l.paid;
  let acts='';
  if(!cancelled) acts+='<button class="tog '+(done?'on-done':(needs?'alert':''))+'" data-a="toggleDone" data-id="'+l.id+'" aria-pressed="'+done+'">'+svg(P.check)+(needs?'Проведён?':'Проведён')+'</button>';
  acts+='<button class="tog '+(l.paid?'on-paid':(unpaidDone?'alert':''))+'" data-a="togglePaid" data-id="'+l.id+'" aria-pressed="'+!!l.paid+'">'+(l.paid?'Оплачен':'Не оплачен')+'</button>';
  if(!cancelled) acts+='<button class="tog '+(l.board?'on-done':'ghost')+'" data-a="openBoard" data-id="'+l.id+'">Доска</button>';
  if(cancelled) acts+='<button class="tog ghost" data-a="toggleCancel" data-id="'+l.id+'">Вернуть</button>';
  else if(!done) acts+='<button class="tog ghost" data-a="moveLesson" data-id="'+l.id+'">Перенести</button><button class="tog ghost" data-a="cancelLesson" data-id="'+l.id+'">Отмена</button>';
  return '<article class="card lesson'+(cancelled?' cancelled':'')+'" data-a="editLesson" data-id="'+l.id+'">'
    +'<div class="l-time'+(needs?' warn':'')+'"><b>'+esc(l.time)+'</b><span>'+endTime(l)+'</span></div>'
    +'<div><button class="l-edit" data-a="editLesson" data-id="'+l.id+'"><div class="l-name">'+esc(stuName(l.studentId))+(s.grade?'<span class="l-grade">'+esc(s.grade)+'</span>':'')+(cancelled?'<span class="tag">'+(l.movedTo?'Перенесён на '+fmtShort(l.movedTo):'Отменён')+'</span>':'')+(l.movedFrom?'<span class="tag">Перенесён с '+fmtShort(l.movedFrom)+'</span>':'')+(needs?'<span class="tag red">Не отмечен</span>':'')+'</div>'
    +(l.topic?'<div class="l-topic">'+esc(l.topic)+'</div>':'')+(cancelled&&l.reason?'<div class="l-topic">Причина: '+esc(l.reason)+'</div>':'')+'</button>'
    +'<div class="l-actions">'+acts+'<span class="l-price">'+money(l.price)+'</span></div></div></article>';
}

function viewSchedule(){
  if(!Object.keys(S.students).length&&!Object.keys(S.lessons).length) return onboarding();
  const ws=view.week, we=addDays(ws,6), k1=ymd(ws), k2=ymd(we), todayK=ymd(new Date());
  const wl=lessonsArr().filter(l=>l.date>=k1&&l.date<=k2);
  const live=wl.filter(l=>l.status!=='cancelled');
  const done=live.filter(l=>l.status==='done');
  const debt=done.filter(l=>!l.paid).reduce((s,l)=>s+num(l.price),0);
  const unmarked=lessonsArr().filter(l=>l.status==='planned'&&isPast(l));
  let h='';
  const pr=pendingReqs();
  if(pr.length) h+='<div class="banner"><p><b>Запросы на перенос: '+pr.length+'</b><br><span class="muted">Ученики и родители просят перенести урок.</span></p><button class="btn small primary" data-a="openRequests">Разобрать</button></div>';
  if(unmarked.length) h+='<div class="banner"><p><b>Без отметки: '+unmarked.length+'</b><br><span class="muted">Прошедшие уроки, которые не отмечены как проведённые или отменённые.</span></p><button class="btn small" data-a="gotoUnmarked">Показать</button></div>';
  h+='<div class="weeknav"><button class="icon-btn" data-a="prevWeek" aria-label="Предыдущая неделя">'+svg(P.left)+'</button><div class="label">'+weekLabel(ws,we)+'</div><button class="icon-btn" data-a="nextWeek" aria-label="Следующая неделя">'+svg(P.right)+'</button></div>';
  h+='<div class="btn-row" style="margin-bottom:12px"><button class="btn small" data-a="today">Сегодня</button><button class="btn small" data-a="addLesson">'+svg(P.plus)+'Новый урок</button></div>';
  h+='<div class="card stats"><div><span>Уроков</span><b>'+live.length+'</b></div><div><span>Проведено</span><b>'+done.length+'</b></div><div><span>Не оплачено</span><b class="'+(debt>0?'bad':'')+'">'+money(debt)+'</b></div></div>';
  for(let i=0;i<7;i++){
    const d=addDays(ws,i), k=ymd(d);
    const ls=wl.filter(l=>l.date===k).sort(byStart);
    const today=k===todayK;
    if(!ls.length){
      h+='<div class="day free'+(today?' today':'')+'"><div class="name"><b>'+fmtWd(d)+'</b>, '+fmtDM(d)+(today?' · сегодня':'')+' — свободно</div><button class="icon-btn" data-a="addLesson" data-date="'+k+'" aria-label="Добавить урок: '+fmtDM(d)+'">'+svg(P.plus)+'</button></div>';
    }else{
      h+='<section class="day'+(today?' today':'')+'"><div class="day-h"><h3>'+fmtWd(d)+'<small>'+fmtDM(d)+'</small></h3><button class="icon-btn" data-a="addLesson" data-date="'+k+'" aria-label="Добавить урок: '+fmtDM(d)+'">'+svg(P.plus)+'</button></div>'+ls.map(lessonCard).join('')+'</section>';
    }
  }
  return h;
}

function viewStudents(){
  const all=studentsArr();
  if(!all.length) return onboarding();
  const L=lessonsArr(), H=hwArr();
  const card=s=>{
    const mine=L.filter(l=>l.studentId===s.id);
    const done=mine.filter(l=>l.status==='done').length;
    const debt=mine.filter(l=>l.status==='done'&&!l.paid).reduce((a,l)=>a+num(l.price),0);
    const open=H.filter(h=>h.studentId===s.id&&h.status!=='checked').length;
    return '<article class="card item" data-a="editStudent" data-id="'+s.id+'"><div class="item-h"><div class="t"><button data-a="editStudent" data-id="'+s.id+'">'+esc(s.name)+'</button></div><div class="r">'+money(s.price)+'</div></div>'
      +'<p class="meta">'+[s.grade,num(s.dur)+' мин'].filter(Boolean).map(esc).join(' · ')+'</p>'
      +'<div class="stat-line"><span>Проведено <b>'+done+'</b></span><span>Долг <b class="'+(debt>0?'bad':'')+'">'+money(debt)+'</b></span><span>ДЗ в работе <b>'+open+'</b></span></div><div class="btn-row"><button class="btn small" data-a="shareStudent" data-id="'+s.id+'">'+svg(P.send)+'Файл для ученика</button>'+(syncCfg()?'<button class="btn small" data-a="viewerLink" data-id="'+s.id+'">Курс: коды и участники</button>':'')+'</div></article>';
  };
  const act=all.filter(s=>!s.archived), arch=all.filter(s=>s.archived);
  let h='<div class="btn-row" style="margin-bottom:16px"><button class="btn primary" data-a="addStudent">'+svg(P.plus)+'Новый ученик</button></div>';
  h+=act.map(card).join('');
  if(arch.length) h+='<div class="sec"><span>Архив</span><span>'+arch.length+'</span></div>'+arch.map(card).join('');
  return h;
}

function debtGroups(){
  const g={};
  lessonsArr().filter(l=>l.status==='done'&&!l.paid).sort(byStart).forEach(l=>{(g[l.studentId]=g[l.studentId]||[]).push(l)});
  return g;
}
function viewMoney(){
  if(!Object.keys(S.students).length&&!Object.keys(S.lessons).length) return onboarding();
  const m=view.month, mk=ymd(m).slice(0,7);
  const L=lessonsArr();
  const inM=L.filter(l=>l.date.slice(0,7)===mk&&l.status!=='cancelled');
  const doneM=inM.filter(l=>l.status==='done');
  const doneSum=doneM.reduce((a,l)=>a+num(l.price),0);
  const paidSum=inM.filter(l=>l.paid).reduce((a,l)=>a+num(l.price),0);
  const groups=debtGroups();
  const debtAll=Object.values(groups).flat().reduce((a,l)=>a+num(l.price),0);
  let h='<div class="month-h"><button class="icon-btn" data-a="prevMonth" aria-label="Предыдущий месяц">'+svg(P.left)+'</button><div class="label">'+monthWord(m)+' '+m.getFullYear()+'</div><button class="icon-btn" data-a="nextMonth" aria-label="Следующий месяц">'+svg(P.right)+'</button></div>';
  h+='<div class="card stats"><div><span>Проведено</span><b>'+money(doneSum)+'</b></div><div><span>Оплачено</span><b>'+money(paidSum)+'</b></div><div><span>Долг всего</span><b class="'+(debtAll>0?'bad':'')+'">'+money(debtAll)+'</b></div></div>';
  h+='<div class="sec"><span>Не оплачено</span><span>'+Object.values(groups).flat().length+'</span></div>';
  const ids=Object.keys(groups);
  if(!ids.length) h+='<div class="card item"><p class="muted">Все проведённые уроки оплачены.</p></div>';
  ids.forEach(sid=>{
    const ls=groups[sid], sum=ls.reduce((a,l)=>a+num(l.price),0);
    h+='<article class="card item"><div class="item-h"><div class="t">'+esc(stuName(sid))+'</div><div class="r bad">'+money(sum)+'</div></div><p class="meta">Уроков: '+ls.length+'</p>'
      +'<div class="rows">'+ls.map(l=>'<div class="row"><span class="d">'+fmtShort(l.date)+'</span><span class="x">'+esc(l.topic||'Урок')+'</span><span class="p">'+money(l.price)+'</span><button class="tog" data-a="togglePaid" data-id="'+l.id+'">Оплачен</button></div>').join('')+'</div>'
      +'<div class="btn-row"><button class="btn small" data-a="payAll" data-id="'+sid+'">'+svg(P.check)+'Все оплачены</button><button class="btn small" data-a="copyDebt" data-id="'+sid+'">'+svg(P.copy)+'Напоминание</button></div></article>';
  });
  const pre=L.filter(l=>l.paid&&l.status!=='done');
  if(pre.length){
    const g={}; pre.sort(byStart).forEach(l=>{(g[l.studentId]=g[l.studentId]||[]).push(l)});
    h+='<div class="sec"><span>Оплачено, но не проведено</span><span>'+pre.length+'</span></div>';
    Object.keys(g).forEach(sid=>{
      h+='<article class="card item"><div class="item-h"><div class="t">'+esc(stuName(sid))+'</div><div class="r">'+g[sid].length+'</div></div><div class="rows">'
        +g[sid].map(l=>'<div class="row"><span class="d">'+fmtShort(l.date)+'</span><span class="x">'+(l.status==='cancelled'?'Отменён, оплата не использована':'Запланирован')+'</span><span class="p">'+money(l.price)+'</span></div>').join('')+'</div></article>';
    });
  }
  return h;
}

function dueChip(h){
  if(!h.due) return '';
  const late=h.status==='given'&&h.due<ymd(new Date());
  return '<span class="tag'+(late?' red':'')+'">'+(late?'просрочено · ':'к ')+fmtShort(h.due)+'</span>';
}
function viewHomework(){
  if(!Object.keys(S.students).length) return onboarding();
  const H=hwArr().sort((a,b)=>num(b.created)-num(a.created));
  const item=h=>{
    let btns='';
    if(h.status==='given') btns+='<button class="btn small primary" data-a="hwNext" data-id="'+h.id+'">'+svg(P.check)+'Сдано</button>';
    if(h.status==='submitted') btns+='<button class="btn small primary" data-a="hwNext" data-id="'+h.id+'">'+svg(P.check)+'Проверено</button>';
    if(h.status==='checked') btns+='<button class="btn small" data-a="hwBack" data-id="'+h.id+'">Вернуть в работу</button>';
    btns+='<button class="btn small" data-a="hwCopy" data-id="'+h.id+'">'+svg(P.copy)+'Скопировать</button>';
    return '<article class="card item" data-a="editHw" data-id="'+h.id+'"><div class="item-h"><div class="t"><button data-a="editHw" data-id="'+h.id+'">'+esc(stuName(h.studentId))+'</button>'+dueChip(h)+'</div></div><p class="hw-text">'+esc(h.text)+'</p><div class="btn-row">'+btns+'</div></article>';
  };
  const g=H.filter(h=>h.status==='given'), sb=H.filter(h=>h.status==='submitted'), ck=H.filter(h=>h.status==='checked').slice(0,8);
  let h='<div class="btn-row" style="margin-bottom:16px"><button class="btn primary" data-a="addHw">'+svg(P.plus)+'Задать домашнее задание</button></div>';
  if(!H.length) return h+'<div class="card item"><p class="muted">Заданий пока нет. Задайте первое, затем скопируйте текст и отправьте ученику в мессенджер.</p></div>';
  if(sb.length) h+='<div class="sec"><span>Сдано, нужно проверить</span><span>'+sb.length+'</span></div>'+sb.map(item).join('');
  if(g.length) h+='<div class="sec"><span>Ждёт выполнения</span><span>'+g.length+'</span></div>'+g.map(item).join('');
  if(ck.length) h+='<div class="sec"><span>Проверено</span><span>'+ck.length+'</span></div>'+ck.map(item).join('');
  return h;
}

/* ---------- toast, copy ---------- */
let toastT=0;
window.toast=(m)=>toast(m);
function toast(msg){
  const t=$('#toast'); t.textContent=msg; t.hidden=false;
  clearTimeout(toastT); toastT=setTimeout(()=>{t.hidden=true},2600);
}
function copyText(text){
  window.api.copy(text).then(()=>toast('Скопировано'),()=>copyFallback(text));
}
function copyFallback(text){
  openSheet({title:'Скопируйте текст',body:'<textarea class="copybox" id="copybox" readonly>'+esc(text)+'</textarea>',saveLabel:'Готово',save:()=>true,onOpen:()=>{const t=$('#copybox');t.focus();t.select()}});
}

/* ---------- sheet ---------- */
let sheet=null, lastFocus=null;
function openSheet(o){
  sheet=o; lastFocus=document.activeElement;
  $('#sheetTitle').textContent=o.title;
  $('#sheetBody').innerHTML=o.body;
  $('#sheetFoot').innerHTML='<button class="btn primary" data-a="sheetSave">'+esc(o.saveLabel||'Сохранить')+'</button>'+(o.extra||'');
  $('#overlay').hidden=false; $('#sheetBody').scrollTop=0;
  document.documentElement.style.overflow='hidden';
  if(o.onOpen) o.onOpen(); else $('#sheet').focus();
}
function closeSheet(){
  $('#overlay').hidden=true; sheet=null;
  document.documentElement.style.overflow='';
  try{if(lastFocus&&lastFocus.focus) lastFocus.focus()}catch(e){}
}
function showErr(msg){const e=$('#sheetErr'); if(e){e.textContent=msg;e.hidden=false}}
const seg=(name,items,val)=>items.map(i=>'<label><input type="radio" name="'+name+'" value="'+i[0]+'"'+(i[0]===val?' checked':'')+'><span>'+i[1]+'</span></label>').join('');
const radio=name=>{const r=document.querySelector('input[name="'+name+'"]:checked');return r?r.value:''};
const val=id=>{const e=document.getElementById(id);return e?e.value:''};
function armed(el,fn,ask,orig){
  ask=ask||'Точно удалить?'; orig=orig||'Удалить';
  if(el.dataset.armed){fn();return}
  el.dataset.armed='1'; el.classList.add('armed'); el.textContent=ask;
  setTimeout(()=>{if(el.isConnected){delete el.dataset.armed;el.classList.remove('armed');el.textContent=orig}},4000);
}
function studentOptions(sel,withEmpty){
  const list=studentsArr().filter(s=>!s.archived||s.id===sel);
  return (withEmpty?'<option value="">Выберите ученика</option>':'')+list.map(s=>'<option value="'+s.id+'"'+(s.id===sel?' selected':'')+'>'+esc(s.name)+'</option>').join('');
}

/* lesson sheet */
function openLesson(id,date,force){
  const act=activeStudents();
  if(!id&&!act.length){toast('Сначала добавьте ученика');openStudent();return}
  const isNew=!id;
  let l;
  if(id) l=S.lessons[id];
  else{
    const s0=act.length===1?act[0]:null;
    l={studentId:s0?s0.id:'',date:date||ymd(new Date()),time:'16:00',dur:s0?num(s0.dur)||60:60,price:s0?num(s0.price):'',status:'planned',paid:false,topic:'',note:'',reason:'',movedTo:''};
  }
  if(!l) return;
  const st0=(force&&force.status)||l.status;
  const rep=isNew?'<div class="field"><label for="l-repeat">Повтор</label><select id="l-repeat"><option value="1">Один раз</option><option value="4">Каждую неделю, 4 урока</option><option value="8">Каждую неделю, 8 уроков</option><option value="12">Каждую неделю, 12 уроков</option></select></div>':'';
  const body='<div class="field"><label for="l-student">Ученик</label><select id="l-student">'+studentOptions(l.studentId,isNew&&act.length>1)+'</select></div>'
   +'<div class="row2"><div class="field"><label for="l-date">Дата</label><input id="l-date" type="date" value="'+esc(l.date)+'"></div><div class="field"><label for="l-time">Начало</label><input id="l-time" type="time" value="'+esc(l.time)+'"></div></div>'
   +'<div class="row2"><div class="field"><label for="l-dur">Длительность, мин</label><input id="l-dur" type="number" inputmode="numeric" min="15" step="5" value="'+esc(l.dur)+'"></div><div class="field"><label for="l-price">Цена урока, '+esc(S.prefs.currency)+'</label><input id="l-price" type="number" inputmode="decimal" min="0" step="any" value="'+esc(l.price)+'"></div></div>'
   +'<div class="field"><span class="lbl">Статус</span><div class="seg" role="radiogroup" aria-label="Статус урока">'+seg('l-status',[['planned','Запланирован'],['done','Проведён'],['cancelled','Отмена']],st0)+'</div></div>'
   +'<div class="sub" id="l-cancel-box"'+(st0==='cancelled'?'':' hidden')+'><div class="field"><label for="l-reason">Причина отмены или переноса</label><textarea id="l-reason" rows="2" placeholder="Ученик и родители увидят её в своём файле">'+esc(l.reason||'')+'</textarea></div><div class="field"><label for="l-moved">Перенесён на (дата)</label><input id="l-moved" type="date" value="'+esc(l.movedTo||'')+'"></div></div>'
   +'<label class="check-row"><input id="l-paid" type="checkbox"'+(l.paid?' checked':'')+'><span>Урок оплачен</span></label>'
   +'<div class="field"><label for="l-topic">Тема урока</label><input id="l-topic" type="text" value="'+esc(l.topic)+'" placeholder="Например, квадратные уравнения"></div>'
   +'<div class="field"><label for="l-note">Заметка</label><textarea id="l-note" rows="2" placeholder="Что получилось, что повторить">'+esc(l.note)+'</textarea></div>'
   +rep+'<p class="err" id="sheetErr" role="alert" hidden></p>';
  const extra=isNew?'':'<button class="btn" data-a="openBoard" data-id="'+id+'">Доска</button><button class="btn" data-a="hwFromLesson" data-id="'+id+'">'+svg(P.book)+'Задать ДЗ</button><button class="btn danger" data-a="delLesson" data-id="'+id+'">Удалить</button>';
  openSheet({title:isNew?'Новый урок':'Урок',body:body,extra:extra,save:()=>{
    const sid=val('l-student'), d=val('l-date'), t=val('l-time');
    if(!sid) return showErr('Выберите ученика.')||false;
    if(!d||!t) return showErr('Укажите дату и время.')||false;
    const base={studentId:sid,date:d,time:t,dur:num(val('l-dur'))||60,price:num(val('l-price')),status:radio('l-status')||'planned',paid:$('#l-paid').checked,topic:val('l-topic').trim(),note:val('l-note').trim()};
    const cx=base.status==='cancelled'; base.reason=cx?val('l-reason').trim():''; base.movedTo=cx?val('l-moved'):'';
    if(isNew){
      const n=num(val('l-repeat'))||1;
      for(let i=0;i<n;i++){
        const o=Object.assign({},base,{id:uid(),date:ymd(addDays(parseYmd(d),7*i))});
        if(i>0){o.status='planned';o.paid=false;o.topic='';o.reason='';o.movedTo=''}
        put('lessons',o);
      }
    }else put('lessons',Object.assign({},l,base));
    view.week=startOfWeek(parseYmd(d)); view.tab='schedule';
  }});
}
function onLessonStudent(){
  const s=S.students[val('l-student')]; if(!s) return;
  if(!sheet||!document.getElementById('l-repeat')) return; // only for new lessons
  $('#l-price').value=num(s.price); $('#l-dur').value=num(s.dur)||60;
}

/* move a lesson */
const REASONS=['Ученик заболел','Школьные дела','По просьбе родителей','Заболел я'];
const dayTime=(date,time)=>{const d=parseYmd(date);return fmtWd(d)+', '+fmtDM(d)+(time?', '+time:'')};
function openRequests(){
  const list=pendingReqs();
  if(!list.length){closeSheet();return}
  const body=list.map(q=>{
    const l=S.lessons[q.lessonId];
    return '<div class="card" style="padding:12px;margin-bottom:10px"><b>'+esc(stuName(q.studentId))+'</b> · '+(q.by==='parent'?'родитель':'ученик')
      +'<div class="muted">Сейчас: '+esc(dayTime(l.date,l.time))+'</div><div>Хотят: <b>'+esc(dayTime(q.date,q.time))+'</b></div><div class="muted">Причина: '+esc(q.reason)+'</div>'
      +'<div class="field"><label for="rq-'+q.id+'">Ответ (необязательно)</label><input id="rq-'+q.id+'" type="text" maxlength="300"></div>'
      +'<div class="btn-row"><button class="btn small primary" data-a="reqAccept" data-id="'+q.id+'">Перенести</button><button class="btn small" data-a="reqDecline" data-id="'+q.id+'">Отказать</button></div></div>';
  }).join('');
  openSheet({title:'Запросы на перенос',body:body,saveLabel:'Закрыть',save:()=>{}});
}
function answerReq(id,status){
  const q=S.requests[id]; if(!q) return;
  const reply=val('rq-'+id).trim();
  const l=S.lessons[q.lessonId];
  if(status==='accepted'){
    if(!l||l.status!=='planned'){toast('Урок уже изменён');}
    else{
      put('lessons',Object.assign({},l,{status:'cancelled',paid:false,reason:q.reason,movedTo:q.date,movedToTime:q.time}));
      put('lessons',Object.assign({},l,{id:uid(),date:q.date,time:q.time,status:'planned',paid:!!l.paid,note:'',reason:'',movedTo:'',movedToTime:'',movedFrom:l.date,movedFromTime:l.time,room:undefined,board:false}));
    }
  }
  put('requests',Object.assign({},q,{status:status,reply:reply}));
  toast(status==='accepted'?'Урок перенесён':'Запрос отклонён');
  if(pendingReqs().length) openRequests(); else closeSheet();
}
function openMove(id){
  const l=S.lessons[id]; if(!l) return;
  const body='<p class="muted">'+esc(stuName(l.studentId))+' · '+esc(dayTime(l.date,l.time))+'</p>'
   +'<div class="row2"><div class="field"><label for="m-date">Новая дата</label><input id="m-date" type="date" value="'+esc(l.date)+'"></div><div class="field"><label for="m-time">Новое время</label><input id="m-time" type="time" value="'+esc(l.time)+'"></div></div>'
   +'<div class="field"><label for="m-reason">Причина переноса</label><textarea id="m-reason" rows="3" placeholder="Ученик и родители увидят её в своём файле"></textarea></div>'
   +'<div class="chips" aria-label="Частые причины">'+REASONS.map(r=>'<button type="button" class="chip" data-a="reasonChip" data-for="m-reason" data-t="'+esc(r)+'">'+esc(r)+'</button>').join('')+'</div>'
   +(l.paid?'<label class="check-row"><input id="m-paid" type="checkbox" checked><span>Оплата переносится на новый урок</span></label>':'')
   +'<p class="err" id="sheetErr" role="alert" hidden></p>';
  openSheet({title:'Перенести урок',body:body,saveLabel:'Перенести',save:()=>{
    const d=val('m-date'), t=val('m-time'), r=val('m-reason').trim();
    if(!d||!t) return showErr('Укажите новую дату и время.')||false;
    if(d===l.date&&t===l.time) return showErr('Выберите другую дату или время.')||false;
    if(!r) return showErr('Напишите причину: ученик и родители её увидят.')||false;
    const keep=!!($('#m-paid')&&$('#m-paid').checked);
    put('lessons',Object.assign({},l,{status:'cancelled',paid:false,reason:r,movedTo:d,movedToTime:t}));
    put('lessons',Object.assign({},l,{id:uid(),date:d,time:t,status:'planned',paid:keep,note:'',reason:'',movedTo:'',movedToTime:'',movedFrom:l.date,movedFromTime:l.time}));
    toast('Урок перенесён');
  }});
}

/* file for the student and parents */
function studentData(sid){
  const now=new Date(), from=ymd(addDays(now,-30));
  const L=lessonsArr().filter(l=>l.studentId===sid), H=hwArr().filter(h=>h.studentId===sid);
  return {
    s:S.students[sid]||{name:''},
    upcoming:L.filter(l=>l.status==='planned'&&lessonEnd(l)>=now).sort(byStart),
    moved:L.filter(l=>l.status==='cancelled'&&l.date>=from).sort(byStart).reverse(),
    past:L.filter(l=>l.status==='done').sort(byStart).reverse().slice(0,5),
    hwOpen:H.filter(h=>h.status!=='checked').sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999')||num(a.created)-num(b.created)),
    hwDone:H.filter(h=>h.status==='checked').sort((a,b)=>num(b.created)-num(a.created)).slice(0,3),
    debt:L.filter(l=>l.status==='done'&&!l.paid).reduce((a,l)=>a+num(l.price),0)
  };
}
function studentText(sid,pay){
  const D=studentData(sid), out=['Занятия — '+D.s.name+(D.s.grade?' ('+D.s.grade+')':''),'','Ближайшие уроки:'];
  if(D.upcoming.length) D.upcoming.forEach(l=>out.push('• '+dayTime(l.date,l.time+'–'+endTime(l))+(l.topic?' — '+l.topic:'')+(l.movedFrom?' (перенесён с '+fmtShort(l.movedFrom)+')':'')+(pay?(l.paid?' · оплачен':' · не оплачен'):'')));
  else out.push('пока нет');
  if(D.moved.length){
    out.push('','Переносы и отмены:');
    D.moved.forEach(l=>out.push('• '+dayTime(l.date,l.time)+(l.movedTo?' → '+dayTime(l.movedTo,l.movedToTime):' — отменён')+(l.reason?'. Причина: '+l.reason:'')));
  }
  out.push('','Домашнее задание:');
  if(D.hwOpen.length) D.hwOpen.forEach(h=>out.push('• '+(h.due?'к '+fmtShort(h.due)+': ':'')+String(h.text).replace(/\n/g,'\n  ')));
  else out.push('сейчас нет');
  if(pay&&D.debt>0) out.push('','К оплате: '+money(D.debt));
  return out.join('\n');
}
const FILE_CSS=`:root{--bg:#EEF2F8;--grid:#DCE4F0;--surface:#fff;--ink:#14203A;--muted:#56647F;--line:#D0D9E7;--accent:#2446C8;--red:#C23A33;--red-soft:#FBE4E2;--ok:#176F49;--ok-soft:#DDF2E7}
@media (prefers-color-scheme:dark){:root{--bg:#0D1322;--grid:#172138;--surface:#151D31;--ink:#E7ECF7;--muted:#9AA6BF;--line:#26324E;--accent:#8EA5FF;--red:#FF8A83;--red-soft:#3A1E24;--ok:#5FD3A0;--ok-soft:#14352A}}
*{box-sizing:border-box}
body{margin:0;font:16px/1.45 "Golos Text",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);padding:max(20px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) 40px max(16px,env(safe-area-inset-left));background:linear-gradient(var(--grid) 1px,transparent 1px) 0 0/20px 20px,linear-gradient(90deg,var(--grid) 1px,transparent 1px) 0 0/20px 20px,var(--bg)}
main{max-width:640px;margin:0 auto}
.eyebrow{margin:0;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
h1{margin:2px 0 0;font:700 44px/1.05 "Caveat","Segoe Print","Bradley Hand",cursive;overflow-wrap:anywhere}
.grade{margin:2px 0 0;color:var(--muted)}
h2{margin:28px 0 8px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}
li{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:12px 14px;min-width:0}
.les{display:grid;grid-template-columns:56px minmax(0,1fr);gap:12px}
.when{display:flex;flex-direction:column;font-variant-numeric:tabular-nums}
.when b{font-size:17px}.when span{font-size:13px;color:var(--muted)}
.d{font-weight:600}.t{overflow-wrap:anywhere}
.note,.meta{font-size:13px;color:var(--muted);margin-top:2px}
.txt{margin-top:6px;white-space:pre-wrap;overflow-wrap:anywhere}
.mv .note{color:var(--red)}
.chip{display:inline-block;margin-top:6px;padding:1px 10px;border-radius:999px;font-size:12px;font-weight:600}
.chip.ok{background:var(--ok-soft);color:var(--ok)}.chip.bad{background:var(--red-soft);color:var(--red)}
.owe{margin:16px 0 0;padding:10px 14px;border-radius:12px;background:var(--red-soft);color:var(--red)}
.empty{margin:0;color:var(--muted)}
.foot{margin-top:32px;font-size:13px;color:var(--muted)}`;
function studentHtml(sid,pay){
  const D=studentData(sid), now=new Date();
  const stamp=fmtDM(now)+', '+pad(now.getHours())+':'+pad(now.getMinutes());
  const payChip=l=>pay?'<span class="chip '+(l.paid?'ok':'bad')+'">'+(l.paid?'Оплачен':'Не оплачен')+'</span>':'';
  const lesson=l=>'<li class="les"><div class="when"><b>'+esc(l.time)+'</b><span>'+esc(endTime(l))+'</span></div><div><div class="d">'+esc(dayTime(l.date))+'</div>'+(l.topic?'<div class="t">'+esc(l.topic)+'</div>':'')+(l.movedFrom?'<div class="note">Перенесён с '+esc(dayTime(l.movedFrom,l.movedFromTime))+'</div>':'')+payChip(l)+'</div></li>';
  const moved=l=>'<li class="mv"><div class="d">'+esc(dayTime(l.date,l.time))+'</div><div class="t">'+(l.movedTo?'Перенесён на <b>'+esc(dayTime(l.movedTo,l.movedToTime))+'</b>':'Урок отменён')+'</div>'+(l.reason?'<div class="note">Причина: '+esc(l.reason)+'</div>':'')+'</li>';
  const hw=h=>'<li class="hw"><div class="meta">'+(h.due?'Срок: <b>'+esc(fmtDM(parseYmd(h.due)))+'</b>':'Без срока')+(h.status==='submitted'?' · сдано, репетитор проверяет':'')+'</div><div class="txt">'+esc(h.text)+'</div></li>';
  const sec=(title,items,none)=>(items.length||none)?'<h2>'+title+'</h2>'+(items.length?'<ul>'+items.join('')+'</ul>':'<p class="empty">'+none+'</p>'):'';
  const body=sec('Ближайшие уроки',D.upcoming.map(lesson),'Пока уроков в расписании нет.')
    +sec('Переносы и отмены',D.moved.map(moved),'')
    +sec('Домашнее задание',D.hwOpen.map(hw),'Сейчас заданий нет.')
    +sec('Проверено',D.hwDone.map(h=>'<li class="hw"><div class="txt">'+esc(h.text)+'</div></li>'),'')
    +sec('Недавние уроки',D.past.map(l=>'<li class="les"><div class="when"><b>'+esc(fmtShort(l.date))+'</b></div><div><div class="t">'+esc(l.topic||'Урок')+'</div>'+payChip(l)+'</div></li>'),'');
  const owe=pay&&D.debt>0?'<p class="owe">К оплате: <b>'+esc(money(D.debt))+'</b></p>':'';
  return '<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Занятия — '+esc(D.s.name)+'</title>'
    +'<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Golos+Text:wght@400;600&display=swap" rel="stylesheet"><style>'+FILE_CSS+'</style></head><body><main>'
    +'<p class="eyebrow">Занятия</p><h1>'+esc(D.s.name)+'</h1>'+(D.s.grade?'<p class="grade">'+esc(D.s.grade)+'</p>':'')+owe+body
    +'<p class="foot">Обновлено: '+esc(stamp)+'. Если расписание изменится, репетитор пришлёт новый файл.</p></main></body></html>';
}
function openShare(sid){
  const s=S.students[sid]; if(!s) return;
  const body='<p>Файл для <b>'+esc(s.name)+'</b> и родителей: ближайшие уроки, переносы с причинами и домашнее задание. Он открывается в браузере на телефоне и компьютере, аккаунт не нужен.</p>'
   +'<label class="check-row"><input id="sh-pay" type="checkbox"><span>Показывать оплату уроков</span></label>'
   +'<p class="muted">Файл показывает данные на момент создания. После изменений в расписании скачайте новый и отправьте снова.</p>';
  openSheet({title:'Файл для ученика',body:body,saveLabel:'Скачать файл',
    extra:'<button class="btn" data-a="shareCopy" data-id="'+sid+'">'+svg(P.copy)+'Скопировать текстом</button>',
    save:()=>{downloadStudent(sid,$('#sh-pay').checked)}});
}
function downloadStudent(sid,pay){
  const s=S.students[sid]; if(!s) return;
  const name=String(s.name).replace(/\s*\(пример\)/,'').replace(/[\\/:*?"<>|]/g,'').trim()||'ученик';
  window.api.saveHtml('Занятия — '+name+'.html',studentHtml(sid,pay)).then(
    r=>{if(r&&r.ok) toast('Файл сохранён. Отправьте его ученику или родителям.')},
    ()=>toast('Не удалось сохранить файл.'));
}

/* курс: коды, участники, ссылка без регистрации */
const CODE_ALPHA='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode(){
  const b=new Uint8Array(10); crypto.getRandomValues(b);
  let o=''; for(let i=0;i<10;i++) o+=CODE_ALPHA[b[i]%CODE_ALPHA.length];
  return o;
}
const showCode=c=>String(c||'').replace(/^(.{4})(.{4})(.*)$/,'$1-$2-$3');
function openCourse(sid){
  const cfg=syncCfg(); let s=S.students[sid];
  if(!s) return;
  if(!cfg){toast('Сначала войдите в аккаунт учителя в настройках');return}
  if(!s.sc||!s.pc||!s.vk){put('students',Object.assign({},s,{sc:s.sc||newCode(),pc:s.pc||newCode(),vk:s.vk||newKey()}));s=S.students[sid]}
  const link=cfg.url+'/s/'+s.vk;
  const body='<p>Курс <b>'+esc(s.title||s.name)+'</b>. Отправьте ученику и родителю их коды: в программе они выбирают «я ученик» или «я родитель», создают аккаунт и вводят код. Каждый код работает для любого числа людей, пока вы его не замените.</p>'
    +'<div class="field"><label for="cr-sc">Код ученика</label><input id="cr-sc" type="text" readonly value="'+esc(showCode(s.sc))+'"></div>'
    +'<div class="btn-row"><button class="btn small" data-a="codeCopy" data-id="'+sid+'" data-w="sc">Скопировать</button><button class="btn small danger" data-a="codeNew" data-id="'+sid+'" data-w="sc">Новый код</button></div>'
    +'<div class="field"><label for="cr-pc">Код родителя (только просмотр)</label><input id="cr-pc" type="text" readonly value="'+esc(showCode(s.pc))+'"></div>'
    +'<div class="btn-row"><button class="btn small" data-a="codeCopy" data-id="'+sid+'" data-w="pc">Скопировать</button><button class="btn small danger" data-a="codeNew" data-id="'+sid+'" data-w="pc">Новый код</button></div>'
    +'<p class="muted">Коды заработают после синхронизации с сервером (обычно пара секунд).</p>'
    +'<h3>Участники</h3><div id="cr-members" class="muted">Загрузка…</div>'
    +'<label class="check-row"><input id="vk-pay" type="checkbox"'+(s.showPay?' checked':'')+'><span>Показывать оплату уроков (оплачен или нет)</span></label>'
    +'<h3>Ссылка без регистрации</h3><div class="field"><label for="vk-link">Постоянная страница только для просмотра</label><input id="vk-link" type="text" readonly value="'+esc(link)+'"></div>';
  openSheet({title:'Курс: коды и участники',body:body,saveLabel:'Готово',
    extra:'<button class="btn" data-a="viewerCopy" data-id="'+sid+'">'+svg(P.copy)+'Скопировать ссылку</button><button class="btn danger" data-a="viewerReset" data-id="'+sid+'">Создать новую ссылку</button>',
    save:()=>{const c=$('#vk-pay'),cur=S.students[sid];if(c&&cur&&!!cur.showPay!==c.checked) put('students',Object.assign({},cur,{showPay:c.checked}))}});
  loadMembers(sid);
}
async function memApi(method,path){
  const cfg=syncCfg(); if(!cfg) throw new Error('Нет входа');
  if(syncing) await syncRun;
  let r;
  try{r=await fetch(cfg.url+path,{method:method,headers:{Authorization:'Bearer '+cfg.token}})}catch(e){throw new Error('Сервер недоступен.')}
  if(r.status===401){clearToken();throw new Error('Сессия закончилась. Войдите снова.')}
  const j=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.message||('Ошибка сервера '+r.status));
  return j;
}
async function loadMembers(sid){
  const box=()=>document.getElementById('cr-members');
  if(!box()) return;
  try{
    if(!(await syncNow())&&syncInfo.state==='err') throw new Error(syncInfo.msg||'Нет связи с сервером');
    const j=await memApi('GET','/api/members/'+encodeURIComponent(sid));
    const b=box(); if(!b) return;
    b.className='';
    b.innerHTML=j.members.length?j.members.map(m=>'<div class="card" style="padding:10px;margin-bottom:8px"><b>'+esc(m.name)+'</b> · '+(m.as==='parent'?'родитель':'ученик')+'<div class="muted">Логин: '+esc(m.login)+'</div><div class="btn-row"><button class="btn small" data-a="memReset" data-id="'+sid+'" data-m="'+esc(m.id)+'">Сбросить пароль</button><button class="btn small danger" data-a="memRemove" data-id="'+sid+'" data-m="'+esc(m.id)+'">Убрать из курса</button></div></div>').join(''):'<p class="muted">Пока никто не присоединился.</p>';
  }catch(e){const b=box();if(b){b.className='err';b.textContent=e.message||'Не удалось загрузить участников'}}
}

/* student sheet */
function openStudent(id){
  const s=id?S.students[id]:{name:'',grade:'',price:'',dur:60,contact:'',note:'',archived:false};
  if(!s) return;
  const mine=lessonsArr().filter(l=>l.studentId===id);
  const body='<div class="field"><label for="s-name">Имя</label><input id="s-name" type="text" value="'+esc(s.name)+'" autocomplete="off"></div>'
   +(syncCfg()?'<div class="field"><label for="s-title">Название курса (видит ученик)</label><input id="s-title" type="text" maxlength="100" value="'+esc(s.title||'')+'" placeholder="Математика, 9 класс"></div>':'')
   +'<div class="field"><label for="s-grade">Класс или цель</label><input id="s-grade" type="text" value="'+esc(s.grade)+'" placeholder="9 класс, подготовка к экзамену"></div>'
   +'<div class="row2"><div class="field"><label for="s-price">Цена урока, '+esc(S.prefs.currency)+'</label><input id="s-price" type="number" inputmode="decimal" min="0" step="any" value="'+esc(s.price)+'"></div><div class="field"><label for="s-dur">Длительность, мин</label><input id="s-dur" type="number" inputmode="numeric" min="15" step="5" value="'+esc(s.dur)+'"></div></div>'
   +'<div class="field"><label for="s-contact">Контакт</label><input id="s-contact" type="text" value="'+esc(s.contact)+'" placeholder="Telegram, телефон родителей"></div>'
   +'<div class="field"><label for="s-note">Заметка</label><textarea id="s-note" rows="3" placeholder="Темы, пробелы, договорённости">'+esc(s.note)+'</textarea></div>'
   +(id?'<label class="check-row"><input id="s-arch" type="checkbox"'+(s.archived?' checked':'')+'><span>В архиве (не показывать при выборе ученика)</span></label>':'')
   +'<p class="err" id="sheetErr" role="alert" hidden></p>';
  const extra=id?'<button class="btn danger" data-a="delStudent" data-id="'+id+'">Удалить</button>':'';
  openSheet({title:id?'Ученик':'Новый ученик',body:body,extra:extra,save:()=>{
    const name=val('s-name').trim();
    if(!name) return showErr('Введите имя ученика.')||false;
    const o=Object.assign({},s,{id:id||uid(),name:name,grade:val('s-grade').trim(),price:num(val('s-price')),dur:num(val('s-dur'))||60,contact:val('s-contact').trim(),note:val('s-note').trim(),archived:id?$('#s-arch').checked:false});
    if($('#s-title')) o.title=val('s-title').trim();
    put('students',o);
  }});
}

/* homework sheet */
function hwMessage(o){
  const name=o.studentId&&S.students[o.studentId]?S.students[o.studentId].name:'';
  return 'Домашнее задание'+(name?' — '+name:'')+(o.due?' (к '+fmtShort(o.due)+')':'')+':\n'+String(o.text||'').trim();
}
function openHw(id,pre){
  const h=id?S.homework[id]:Object.assign({studentId:'',text:'',due:'',status:'given',lessonId:''},pre||{});
  if(!h) return;
  if(!id&&h.studentId&&!h.due) h.due=nextLessonDate(h.studentId);
  const act=activeStudents();
  if(!id&&!act.length){toast('Сначала добавьте ученика');openStudent();return}
  const body='<div class="field"><label for="h-student">Ученик</label><select id="h-student">'+studentOptions(h.studentId,!id&&!h.studentId)+'</select></div>'
   +'<div class="field"><label for="h-text">Задание</label><textarea id="h-text" rows="6" placeholder="Что решить, прочитать, повторить">'+esc(h.text)+'</textarea></div>'
   +'<div class="chips" aria-label="Быстрые вставки"><button type="button" class="chip" data-a="hwChip" data-t="Задачи № ">№ задач</button><button type="button" class="chip" data-a="hwChip" data-t="Повторить тему: ">Повторить тему</button><button type="button" class="chip" data-a="hwChip" data-t="Учебник, § ">Учебник, §</button><button type="button" class="chip" data-a="hwChip" data-t="Решить вариант № ">Вариант</button></div>'
   +'<div class="field"><label for="h-due">Срок</label><input id="h-due" type="date" value="'+esc(h.due)+'"></div>'
   +(id?'<div class="field"><span class="lbl">Статус</span><div class="seg" role="radiogroup" aria-label="Статус задания">'+seg('h-status',[['given','Задано'],['submitted','Сдано'],['checked','Проверено']],h.status)+'</div></div>':'')
   +'<p class="err" id="sheetErr" role="alert" hidden></p>';
  const extra='<button class="btn" data-a="copyFromSheet">'+svg(P.copy)+'Скопировать</button>'+(id?'<button class="btn danger" data-a="delHw" data-id="'+id+'">Удалить</button>':'');
  openSheet({title:id?'Домашнее задание':'Новое задание',body:body,extra:extra,save:()=>{
    const sid=val('h-student'), text=val('h-text').trim();
    if(!sid) return showErr('Выберите ученика.')||false;
    if(!text) return showErr('Напишите задание.')||false;
    put('homework',Object.assign({},h,{id:id||uid(),studentId:sid,text:text,due:val('h-due'),status:id?(radio('h-status')||'given'):'given',created:h.created||Date.now()}));
    view.tab='homework';
  }});
}

/* совместная доска */
let liveH=null;
function stopLive(){
  if(liveH){liveH.stop();liveH=null}
  if(window.Board)window.Board.setShare(false);
}
async function roomFor(lid){
  const srv=syncCfg(), l=S.lessons[lid];
  if(!srv) throw new Error('Войдите в аккаунт учителя в настройках.');
  if(l&&l.room&&l.room.id&&l.room.url===srv.url) return l.room;
  let r;
  try{r=await fetch(srv.url+'/api/rooms',{method:'POST',headers:{Authorization:'Bearer '+srv.token}})}
  catch(e){throw new Error('Сервер недоступен.')}
  if(r.status===401){clearToken();throw new Error('Сессия закончилась. Войдите снова.')}
  if(!r.ok) throw new Error('Сервер ответил с ошибкой '+r.status+'.');
  const j=await r.json();
  const room={id:j.id,tk:j.tk,sk:j.sk,url:srv.url};
  const c=S.lessons[lid];
  if(c) put('lessons',Object.assign({},c,{room:room}));
  return room;
}
async function toggleLive(lid){
  if(liveH){stopLive();toast('Совместная работа остановлена');return}
  const srv=syncCfg();
  try{
    const room=await roomFor(lid);
    if(liveH) return;
    liveH=window.Live.start({server:srv.url,room:room.id,key:room.tk,board:window.Board});
    const link=srv.url+'/r/'+room.id+'?k='+room.sk;
    window.Board.setShare(true,{link:link});
    window.api.copy(link).then(()=>toast('Ссылка для ученика скопирована'));
  }catch(e){toast(e&&e.message?e.message:'Не удалось подключиться')}
}

/* settings */
function openSettings(){
  const demoCount=KINDS.reduce((a,k)=>a+Object.values(S[k]).filter(o=>o.demo).length,0);
  const ac=S.acct&&S.acct.role==='teacher'?S.acct:null;
  const accBlock=ac
    ?'<div class="card" style="padding:12px"><b>'+esc(ac.name)+'</b> · учитель<div class="muted">Логин: '+esc(ac.login)+'<br>Сервер: '+esc(ac.server)+(ac.token?'':'<br><span class="err">Сессия закончилась, войдите снова</span>')+'</div></div>'
    :'<p class="muted">Без аккаунта программа работает только на этом компьютере. Чтобы ученики и родители видели занятия, а доска была общей, войдите в аккаунт учителя на вашем сервере.</p>';
  const accBtns=ac
    ?(ac.token?'<button class="btn" data-a="syncNow">Синхронизировать сейчас'+(syncInfo.state==='ok'?' (последний раз успешно)':syncInfo.state==='err'?' (была ошибка)':'')+'</button><button class="btn" data-a="acctPwd">Сменить пароль</button><button class="btn" data-a="acctLogout">Выйти из аккаунта</button>':'<button class="btn primary" data-a="acctLogin">Войти снова</button>')
    :'<button class="btn primary" data-a="acctLogin">Войти или создать аккаунт учителя</button><button class="btn" data-a="acctOther">Я ученик или родитель</button>';
  const body='<div class="field"><label for="p-cur">Валюта</label><input id="p-cur" type="text" maxlength="4" value="'+esc(S.prefs.currency)+'"></div>'
    +accBlock
    +'<p class="muted">Все данные хранятся в одном файле на этом компьютере:</p><p class="muted" style="word-break:break-all">'+esc(dataPath)+'</p>'
    +'<p class="muted">Сохраняйте копию данных после важных изменений: так их можно перенести на другой компьютер или вернуть.</p>'
    +'<p class="err" id="sheetErr" role="alert" hidden></p>';
  const extra=accBtns
    +'<button class="btn" data-a="backupExport">Сохранить копию данных</button>'
    +'<button class="btn danger" data-a="backupImport">Загрузить из копии</button>'
    +'<button class="btn" data-a="openDataDir">Открыть папку с данными</button>'
    +(demoCount?'<button class="btn danger" data-a="demoClear">Удалить примеры</button>':'');
  openSheet({title:'Настройки',body:body,extra:extra,
    save:()=>{const c=val('p-cur').trim(); if(!c) return showErr('Укажите валюту, например ₴.')||false;
      S.prefs.currency=c; savePrefs()}});
}

/* demo data */
function loadDemo(){
  const t0=startOfWeek(new Date());
  const st=[
    {name:'Анна К. (пример)',grade:'9 класс, экзамен',price:600,dur:60,contact:'Мама Ирина, Telegram',note:'Слабее в геометрии.'},
    {name:'Максим Д. (пример)',grade:'11 класс, экзамен',price:700,dur:90,contact:'Telegram',note:'Занимается два раза в неделю.'},
    {name:'Соня П. (пример)',grade:'6 класс',price:450,dur:60,contact:'Папа, телефон',note:''}
  ].map(o=>Object.assign({id:uid(),archived:false,demo:true},o));
  st.forEach(s=>put('students',s));
  const plan=[[0,0,'16:00','Квадратные уравнения',true],[1,1,'17:30','Производная: правила',false],[2,2,'15:00','Дроби и проценты',true],[3,0,'16:00','Теорема Пифагора',false],[4,1,'17:30','Параметры',true],[5,2,'11:00','Уравнения',false],[7,0,'16:00','Окружность',true],[8,1,'17:30','Логарифмы',false],[10,2,'15:00','Пропорции',false]];
  plan.forEach(p=>{
    const s=st[p[1]], d=addDays(t0,p[0]);
    const l={id:uid(),demo:true,studentId:s.id,date:ymd(d),time:p[2],dur:s.dur,price:s.price,status:'planned',paid:p[4],topic:p[3],note:''};
    if(isPast(l)) l.status='done';
    put('lessons',l);
  });
  put('lessons',{id:uid(),demo:true,studentId:st[2].id,date:ymd(addDays(t0,3)),time:'15:00',dur:60,price:450,status:'cancelled',paid:false,topic:'Дроби и проценты',note:'',reason:'Соня заболела',movedTo:ymd(addDays(t0,9)),movedToTime:'15:00'});
  put('lessons',{id:uid(),demo:true,studentId:st[2].id,date:ymd(addDays(t0,9)),time:'15:00',dur:60,price:450,status:'planned',paid:false,topic:'Дроби и проценты',note:'',reason:'',movedTo:'',movedFrom:ymd(addDays(t0,3)),movedFromTime:'15:00'});
  const now=Date.now();
  put('homework',{id:uid(),demo:true,studentId:st[0].id,text:'Задачи № 12–18 из сборника.\nПовторить формулу корней квадратного уравнения.',due:ymd(addDays(t0,7)),status:'given',created:now});
  put('homework',{id:uid(),demo:true,studentId:st[1].id,text:'Вариант 4, задачи 1–9.',due:ymd(addDays(t0,5)),status:'submitted',created:now-1000});
  put('homework',{id:uid(),demo:true,studentId:st[2].id,text:'Учебник, § 14, № 3, 5, 8.',due:ymd(addDays(t0,3)),status:'checked',created:now-2000});
}
function clearDemo(){
  KINDS.forEach(k=>Object.values(S[k]).filter(o=>o.demo).forEach(o=>del(k,o.id)));
}

/* ---------- actions ---------- */
const A={
  tab:(d)=>{view.tab=d.tab;render();window.scrollTo(0,0)},
  prevWeek:()=>{view.week=addDays(view.week,-7);render()},
  nextWeek:()=>{view.week=addDays(view.week,7);render()},
  today:()=>{view.week=startOfWeek(new Date());render()},
  prevMonth:()=>{view.month=new Date(view.month.getFullYear(),view.month.getMonth()-1,1);render()},
  nextMonth:()=>{view.month=new Date(view.month.getFullYear(),view.month.getMonth()+1,1);render()},
  addLesson:(d)=>openLesson(null,d.date),
  editLesson:(d)=>openLesson(d.id),
  toggleDone:(d)=>{const l=S.lessons[d.id];if(l)put('lessons',Object.assign({},l,{status:l.status==='done'?'planned':'done'}))},
  togglePaid:(d)=>{const l=S.lessons[d.id];if(l)put('lessons',Object.assign({},l,{paid:!l.paid}))},
  toggleCancel:(d)=>{const l=S.lessons[d.id];if(l)put('lessons',Object.assign({},l,{status:'planned',reason:'',movedTo:''}))},
  moveLesson:(d)=>openMove(d.id),
  openBoard:(d)=>{const l=S.lessons[d.id];if(!l)return;closeSheet();
    const srv=syncCfg()||{};
    window.Board.open({id:l.id,title:stuName(l.studentId)+' · '+fmtShort(l.date)+' '+l.time,
      onShare:srv.url?()=>toggleLive(l.id):null,onClose:()=>stopLive(),
      onContent:(has)=>{const c=S.lessons[l.id];if(c&&!!c.board!==has){put('lessons',Object.assign({},c,{board:has}))}}})},
  cancelLesson:(d)=>openLesson(d.id,null,{status:'cancelled'}),
  reasonChip:(d)=>{const t=document.getElementById(d.for);if(!t)return;t.value=t.value.trim()?t.value.trim().replace(/[.\s]+$/,'')+'. '+d.t:d.t;t.focus()},
  shareStudent:(d)=>openShare(d.id),
  viewerLink:(d)=>openCourse(d.id),
  viewerCopy:async(d)=>{
    const s=S.students[d.id],cfg=syncCfg(); if(!s||!cfg||!s.vk) return;
    if(syncing) await syncRun;
    const ok=await syncNow();
    if(!ok){toast('Не удалось связаться с сервером: '+(syncInfo.msg||'ошибка'));return}
    window.api.copy(cfg.url+'/s/'+s.vk).then(()=>toast('Ссылка скопирована. Отправьте её ученику или родителям.'));
  },
  viewerReset:(d,el)=>armed(el,()=>{
    const s=S.students[d.id]; if(!s) return;
    put('students',Object.assign({},s,{vk:newKey()}));
    openCourse(d.id); toast('Создана новая ссылка, старая больше не работает');
  },'Старая ссылка перестанет работать. Создать новую?','Создать новую ссылку'),
  codeCopy:(d)=>{const st=S.students[d.id];if(st&&st[d.w])window.api.copy(st[d.w]).then(()=>toast('Код скопирован'))},
  codeNew:(d,el)=>armed(el,()=>{const st=S.students[d.id];if(!st)return;const o={};o[d.w]=newCode();put('students',Object.assign({},st,o));openCourse(d.id);toast('Создан новый код, старый не сработает для новых людей')},'Старый код перестанет работать. Заменить?','Новый код'),
  memReset:(d,el)=>armed(el,async()=>{try{const j=await memApi('POST','/api/members/'+encodeURIComponent(d.id)+'/'+encodeURIComponent(d.m)+'/reset');window.api.copy(j.password).catch(()=>{});toast('Новый временный пароль: '+j.password+' (скопирован)')}catch(e){toast(e.message)}},'Задать новый пароль?','Сбросить пароль'),
  memRemove:(d,el)=>armed(el,async()=>{try{await memApi('DELETE','/api/members/'+encodeURIComponent(d.id)+'/'+encodeURIComponent(d.m));loadMembers(d.id)}catch(e){toast(e.message)}},'Убрать из курса?','Убрать из курса'),
  acctLogin:()=>{closeSheet();window.Portal.showAuth('teacher',{mode:'login',cancel:true})},
  acctOther:()=>{closeSheet();window.Portal.showWelcome({cancel:true})},
  acctPwd:()=>{closeSheet();window.Portal.showPassword()},
  acctLogout:(d,el)=>armed(el,()=>{closeSheet();window.Portal.logout()},'Выйти из аккаунта?','Выйти из аккаунта'),
  syncNow:()=>{syncNow().then(ok=>toast(ok?'Синхронизировано':(syncInfo.msg||'Не удалось синхронизировать')))},
  shareCopy:(d)=>{const c=$('#sh-pay');copyText(studentText(d.id,!!(c&&c.checked)))},
  openRequests:()=>openRequests(),
  reqAccept:(d)=>answerReq(d.id,'accepted'),
  reqDecline:(d)=>answerReq(d.id,'declined'),
  gotoUnmarked:()=>{const u=lessonsArr().filter(l=>l.status==='planned'&&isPast(l)).sort(byStart);if(u.length){view.week=startOfWeek(parseYmd(u[0].date));render();window.scrollTo(0,0)}},
  addStudent:()=>openStudent(),
  editStudent:(d)=>openStudent(d.id),
  demo:()=>{loadDemo();toast('Добавлены примеры. Их можно удалить в настройках.')},
  demoClear:()=>{clearDemo();closeSheet();toast('Примеры удалены')},
  addHw:()=>openHw(),
  editHw:(d)=>openHw(d.id),
  hwNext:(d)=>{const h=S.homework[d.id];if(h)put('homework',Object.assign({},h,{status:h.status==='given'?'submitted':'checked'}))},
  hwBack:(d)=>{const h=S.homework[d.id];if(h)put('homework',Object.assign({},h,{status:'given'}))},
  hwCopy:(d)=>{const h=S.homework[d.id];if(h)copyText(hwMessage(h))},
  hwChip:(d)=>{const t=$('#h-text');if(!t)return;t.value=(t.value&&!/\n$/.test(t.value)?t.value+'\n':t.value)+d.t;t.focus();t.setSelectionRange(t.value.length,t.value.length)},
  hwFromLesson:(d)=>{
    const l=S.lessons[d.id];if(!l)return;
    closeSheet();
    openHw(null,{studentId:l.studentId,lessonId:l.id,text:l.topic?'Тема: '+l.topic+'\n':''});
  },
  copyFromSheet:()=>copyText(hwMessage({studentId:val('h-student'),text:val('h-text'),due:val('h-due')})),
  payAll:(d)=>{(debtGroups()[d.id]||[]).forEach(l=>put('lessons',Object.assign({},l,{paid:true})));toast('Отмечено как оплачено')},
  copyDebt:(d)=>{
    const ls=debtGroups()[d.id]||[];if(!ls.length)return;
    const sum=ls.reduce((a,l)=>a+num(l.price),0);
    copyText('Здравствуйте! Напоминаю про оплату занятий:\n'+ls.map(l=>fmtShort(l.date)+' — '+money(l.price)).join('\n')+'\nИтого: '+money(sum)+'.');
  },
  openSettings:()=>openSettings(),
  backupExport:()=>{window.api.exportBackup(snapshotJson(true)).then(r=>{if(r&&r.ok)toast('Копия сохранена')},()=>toast('Не удалось сохранить копию'))},
  backupImport:(d,el)=>armed(el,()=>{window.api.importBackup().then(r=>{
    if(r&&r.ok){loadInto.keep=true;try{loadInto(r.data)}finally{loadInto.keep=false}S.sync={sent:0,rev:0,epoch:''};dirty=true;flushNow();scheduleSync();closeSheet();render();toast('Данные загружены из копии')}
    else if(r&&r.error) toast(r.error)},()=>toast('Не удалось прочитать файл'))},'Заменить текущие данные?','Загрузить из копии'),
  openDataDir:()=>{window.api.showDataDir()},
  closeSheet:()=>closeSheet(),
  sheetSave:()=>{if(sheet&&sheet.save){const r=sheet.save();if(r!==false)closeSheet()}},
  delLesson:(d,el)=>armed(el,()=>{del('lessons',d.id);closeSheet()}),
  delHw:(d,el)=>armed(el,()=>{del('homework',d.id);closeSheet()}),
  delStudent:(d,el)=>{
    const used=lessonsArr().some(l=>l.studentId===d.id)||hwArr().some(h=>h.studentId===d.id);
    if(used){const c=$('#s-arch');if(c)c.checked=true;showErr('У ученика есть уроки или задания. Поставлена отметка «В архиве», нажмите «Сохранить».');return}
    armed(el,()=>{Object.values(S.requests).filter(q=>q.studentId===d.id).forEach(q=>del('requests',q.id));del('students',d.id);closeSheet()});
  }
};
document.addEventListener('click',e=>{
  if(e.target.id==='overlay'){closeSheet();return}
  const el=e.target.closest('[data-a]'); if(!el) return;
  const fn=A[el.dataset.a]; if(fn) fn(el.dataset,el,e);
});
document.addEventListener('change',e=>{
  if(e.target.id==='l-student') onLessonStudent();
  if(e.target.name==='l-status'){const b=$('#l-cancel-box');if(b) b.hidden=e.target.value!=='cancelled'}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&sheet) closeSheet()});

$('#gearBtn').innerHTML=svg(P.gear);
$('#closeBtn').innerHTML=svg(P.x);
boot();
})();
