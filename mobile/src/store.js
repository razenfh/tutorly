import * as SecureStore from 'expo-secure-store';
const KEY = 'acct-v1', SRV = 'server-v1';
export async function loadAcct() {
  try { const t = await SecureStore.getItemAsync(KEY); const a = t ? JSON.parse(t) : null; return a && a.token && a.server && ['student', 'parent', 'teacher'].indexOf(a.role) >= 0 ? a : null; } catch (e) { return null; }
}
export async function saveAcct(a) {
  try { if (a) { await SecureStore.setItemAsync(KEY, JSON.stringify(a)); await SecureStore.setItemAsync(SRV, a.server); } else await SecureStore.deleteItemAsync(KEY); } catch (e) { /* ignore */ }
}
export async function lastServer() { try { return (await SecureStore.getItemAsync(SRV)) || ''; } catch (e) { return ''; } }
/* Вид расписания: 'list' (неделя списком) или 'cal' (календарь месяца) */
const SCHED = 'sched-mode-v1';
export async function loadSchedMode() { try { return (await SecureStore.getItemAsync(SCHED)) === 'cal' ? 'cal' : 'list'; } catch (e) { return 'list'; } }
export async function saveSchedMode(v) { try { await SecureStore.setItemAsync(SCHED, v === 'cal' ? 'cal' : 'list'); } catch (e) { /* ignore */ } }
/* Тема оформления: 'auto', 'light' или 'dark'. Не зависит от аккаунта, остаётся после выхода. */
const THEME = 'theme-v1';
export async function loadTheme() { try { const v = await SecureStore.getItemAsync(THEME); return v === 'light' || v === 'dark' ? v : 'auto'; } catch (e) { return 'auto'; } }
export async function saveTheme(v) { try { await SecureStore.setItemAsync(THEME, v === 'light' || v === 'dark' ? v : 'auto'); } catch (e) { /* ignore */ } }
