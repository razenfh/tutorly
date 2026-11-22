/* Локальные уведомления (expo-notifications): работают и в Expo Go, сервер и аккаунт Apple не нужны.
   Приложение пересчитывает расписание уведомлений при каждом обновлении данных. Пока оно закрыто,
   новые события с сервера (например, «ученик сдал работу») телефон не узнаёт: для этого нужны push-уведомления. */
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { teacherPlan, studentPlan, planSignature, DEFAULT_PREFS } from './notifyPlan';

const KEY = 'notify-v1';
let inited = false, lastSig = '', last = null, busy = null, again = false;

export function initNotifications() {
  if (inited) return; inited = true;
  try {
    Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) });
    if (Platform.OS === 'android') Notifications.setNotificationChannelAsync('default', { name: 'Tutorly', importance: Notifications.AndroidImportance.DEFAULT }).catch(() => {});
  } catch (e) { /* ignore */ }
}
export async function loadPrefs() {
  try { const t = await SecureStore.getItemAsync(KEY); return Object.assign({}, DEFAULT_PREFS, t ? JSON.parse(t) : {}); } catch (e) { return Object.assign({}, DEFAULT_PREFS); }
}
export async function savePrefs(p) { try { await SecureStore.setItemAsync(KEY, JSON.stringify(p)); } catch (e) { /* ignore */ } }

async function permitted(ask) {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  if (!ask || cur.canAskAgain === false) return false;
  return !!(await Notifications.requestPermissionsAsync()).granted;
}
const trigger = (d) => (Notifications.SchedulableTriggerInputTypes
  ? { type: Notifications.SchedulableTriggerInputTypes.DATE, date: d, channelId: 'default' } : d);

async function run(input, ask) {
  const prefs = await loadPrefs();
  if (!prefs.on) { if (lastSig !== 'off') { await Notifications.cancelAllScheduledNotificationsAsync(); lastSig = 'off'; } return 'off'; }
  /* первый раз спрашиваем разрешение сами, дальше только по нажатию в настройках */
  const first = !prefs.asked;
  if (first) await savePrefs(Object.assign({}, prefs, { asked: true }));
  if (!(await permitted(ask || first))) { lastSig = ''; return 'denied'; }
  const now = new Date();
  const plan = input.role === 'teacher' ? teacherPlan(input.S, now, prefs) : studentPlan(input.courses, now, prefs);
  const sig = planSignature(plan);
  if (sig === lastSig) return 'ok';
  await Notifications.cancelAllScheduledNotificationsAsync();
  for (const it of plan) {
    await Notifications.scheduleNotificationAsync({ identifier: it.key, content: { title: it.title, body: it.body }, trigger: trigger(it.when) });
  }
  lastSig = sig;
  return 'ok';
}

/* Один пересчёт за раз: если во время работы пришли новые данные, повторяем с ними */
export async function syncNotifications(input, ask) {
  last = input;
  if (busy) { again = true; return busy; }
  busy = (async () => {
    let r = 'error';
    try { do { again = false; r = await run(last, ask); } while (again); } catch (e) { r = 'error'; }
    busy = null; return r;
  })();
  return busy;
}
export const resync = (ask) => (last ? syncNotifications(last, ask) : Promise.resolve('none'));
export async function clearNotifications() {
  last = null; lastSig = '';
  try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch (e) { /* ignore */ }
}
