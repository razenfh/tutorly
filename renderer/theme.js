(function () {
'use strict';
/* Тема оформления: «auto» (как в системе), «light» (светлая), «dark» (тёмная).
   Выбор хранится на устройстве. Скрипт подключается в <head> без defer, чтобы тема
   применялась до первой отрисовки и страница не мигала. Любая кнопка с атрибутом
   data-theme-toggle переключает светлую и тёмную тему. */
var KEY = 'theme-pref-v1';
var root = document.documentElement;
var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function get() {
  try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'auto'; } catch (e) { return 'auto'; }
}
function scheme(pref) { return pref === 'auto' ? (mq && mq.matches ? 'dark' : 'light') : pref; }
function labels() {
  var dark = root.getAttribute('data-scheme') === 'dark';
  var text = dark ? 'Включить светлую тему' : 'Включить тёмную тему';
  var list = document.querySelectorAll('[data-theme-toggle]');
  for (var i = 0; i < list.length; i++) { list[i].setAttribute('aria-label', text); list[i].setAttribute('title', text); }
}
function apply() {
  var pref = get();
  if (pref === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', pref);
  root.setAttribute('data-scheme', scheme(pref));
  labels();
}
function set(pref) {
  pref = pref === 'light' || pref === 'dark' ? pref : 'auto';
  try { if (pref === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref); } catch (e) { /* хранилище недоступно: тема сменится только до перезапуска */ }
  if (pref === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', pref);
  root.setAttribute('data-scheme', scheme(pref));
  labels();
  var radios = document.querySelectorAll('input[name="p-theme"]');
  for (var i = 0; i < radios.length; i++) radios[i].checked = radios[i].value === pref;
}
function toggle() { set(root.getAttribute('data-scheme') === 'dark' ? 'light' : 'dark'); }

/* Разметка кнопки для мест, где страница строится из строк (кабинет ученика). */
var ICONS = '<svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/></svg>'
  + '<svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>';
function button(cls) {
  var text = root.getAttribute('data-scheme') === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему';
  return '<button type="button" class="' + (cls || 'icon-btn') + '" data-theme-toggle aria-label="' + text + '" title="' + text + '">' + ICONS + '</button>';
}

apply();
if (mq) { if (mq.addEventListener) mq.addEventListener('change', apply); else if (mq.addListener) mq.addListener(apply); }
window.addEventListener('storage', function (e) { if (e.key === KEY) apply(); });
document.addEventListener('DOMContentLoaded', labels);
document.addEventListener('click', function (e) {
  var el = e.target.closest ? e.target.closest('[data-theme-toggle]') : null;
  if (el) { e.preventDefault(); toggle(); setTimeout(labels, 0); }
});

window.Theme = { get: get, set: set, toggle: toggle, button: button, icons: ICONS };
})();
