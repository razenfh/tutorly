import * as SecureStore from 'expo-secure-store';
const KEY = 'acct-v1', SRV = 'server-v1';
export async function loadAcct() {
  try { const t = await SecureStore.getItemAsync(KEY); const a = t ? JSON.parse(t) : null; return a && a.token && a.server && ['student', 'parent', 'teacher'].indexOf(a.role) >= 0 ? a : null; } catch (e) { return null; }
}
export async function saveAcct(a) {
  try { if (a) { await SecureStore.setItemAsync(KEY, JSON.stringify(a)); await SecureStore.setItemAsync(SRV, a.server); } else await SecureStore.deleteItemAsync(KEY); } catch (e) { /* ignore */ }
}
export async function lastServer() { try { return (await SecureStore.getItemAsync(SRV)) || ''; } catch (e) { return ''; } }
