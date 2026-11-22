import React, { useEffect, useState } from 'react';
import { Card, T, Pick, Check } from './ui';
import { loadPrefs, savePrefs, resync } from './notify';

/* Настройки уведомлений: общий блок для учителя, ученика и родителя */
export function NotifyPick({ teacher }) {
  const [p, setP] = useState(null);
  const [note, setNote] = useState('');
  useEffect(() => { loadPrefs().then(setP); }, []);
  if (!p) return null;
  async function upd(patch) {
    const n = Object.assign({}, p, patch);
    setP(n); await savePrefs(n);
    const r = await resync(true);
    setNote(r === 'denied' ? 'Уведомления запрещены в настройках iPhone. Включите их: Настройки → Уведомления → Tutorly (или Expo Go).' : '');
  }
  return (
    <Card>
      <T bold>Уведомления</T>
      <Check label="Напоминать об уроках" value={p.on} onChange={(v) => upd({ on: v })} />
      {p.on ? <Pick label="За сколько напоминать об уроке" options={[[10, 'За 10 минут'], [30, 'За 30 минут'], [60, 'За час']]} value={p.lead} onChange={(v) => upd({ lead: v })} /> : null}
      {p.on && teacher ? <Check label="Вечером напоминать: уроки без отметки, оплата, работы на проверку" value={p.digest} onChange={(v) => upd({ digest: v })} /> : null}
      {p.on && !teacher ? <Check label="Напоминать о сроке сдачи домашки" value={p.hw} onChange={(v) => upd({ hw: v })} /> : null}
      {note ? <T color="#B3261E" size={13}>{note}</T> : null}
      <T muted size={13}>Напоминания приходят, даже когда приложение закрыто. Они обновляются, когда вы открываете приложение.</T>
    </Card>
  );
}
