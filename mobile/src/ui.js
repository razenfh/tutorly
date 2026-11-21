import React, { useState } from 'react';
import { Text, View, Pressable, TextInput, StyleSheet, useColorScheme, Appearance, ScrollView, RefreshControl, SafeAreaView, Platform, StatusBar } from 'react-native';
import { saveTheme } from './store';

/* Строгая нейтральная палитра: акцент совпадает с цветом текста (чёрный на светлом, белый на тёмном). */
const LIGHT = { dark: false, bg: '#FAFAFA', surface: '#FFFFFF', ink: '#111111', muted: '#6B6B6B', line: '#E4E4E4', accent: '#111111', accentInk: '#FFFFFF', soft: '#F0F0F0', red: '#B42318', ok: '#166534' };
const DARK = { dark: true, bg: '#0B0B0B', surface: '#141414', ink: '#EDEDED', muted: '#9A9A9A', line: '#272727', accent: '#EDEDED', accentInk: '#0B0B0B', soft: '#1F1F1F', red: '#F28B82', ok: '#5BD08A' };
export const useTheme = () => (useColorScheme() === 'dark' ? DARK : LIGHT);

/* Выбор темы: 'auto' (как в системе), 'light', 'dark'. Appearance.setColorScheme переопределяет схему для всего приложения. */
let themePref = 'auto';
export function applyTheme(pref) {
  themePref = pref === 'light' || pref === 'dark' ? pref : 'auto';
  try { if (Appearance.setColorScheme) Appearance.setColorScheme(themePref === 'auto' ? null : themePref); } catch (e) { /* старая версия React Native: остаётся тема системы */ }
}
export function ThemePick() {
  const [v, setV] = useState(themePref);
  return <Pick label="Тема оформления" options={[['auto', 'Авто'], ['light', 'Светлая'], ['dark', 'Тёмная']]} value={v} onChange={(x) => { setV(x); applyTheme(x); saveTheme(x); }} />;
}

export function Screen({ children, onRefresh, refreshing, scroll = true }) {
  const t = useTheme();
  const top = Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 0;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, paddingTop: top }}>
      <StatusBar barStyle={t.dark ? 'light-content' : 'dark-content'} backgroundColor={t.bg} />
      {scroll ? (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }} keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.accent} /> : undefined}>
          {children}
        </ScrollView>
      ) : children}
    </SafeAreaView>
  );
}
export function T({ children, style, muted, bold, size, color }) {
  const t = useTheme();
  return <Text style={[{ color: color || (muted ? t.muted : t.ink), fontSize: size || 15, fontWeight: bold ? '700' : '400' }, style]}>{children}</Text>;
}
export function H1({ children }) { return <T bold size={28} style={{ marginBottom: 2 }}>{children}</T>; }
export function H3({ children }) { return <T bold size={16} style={{ marginTop: 10 }}>{children}</T>; }
export function Card({ children, style, onPress }) {
  const t = useTheme();
  const s = [{ backgroundColor: t.surface, borderColor: t.line, borderWidth: 1, borderRadius: 10, padding: 14, gap: 6 }, style];
  return onPress ? <Pressable onPress={onPress} style={s}>{children}</Pressable> : <View style={s}>{children}</View>;
}
export function Btn({ title, onPress, kind, disabled, small }) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : t.surface;
  const fg = kind === 'primary' ? t.accentInk : kind === 'danger' ? t.red : t.ink;
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={{ minHeight: small ? 38 : 48, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: kind === 'primary' ? t.accent : t.line, backgroundColor: bg, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.55 : 1, alignSelf: small ? 'flex-start' : 'stretch' }}>
      <Text style={{ color: fg, fontWeight: '600', fontSize: small ? 14 : 16 }}>{title}</Text>
    </Pressable>
  );
}
export function Field({ label, ...p }) {
  const t = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <T muted size={13} bold>{label}</T>
      <TextInput placeholderTextColor={t.muted} {...p}
        style={{ minHeight: 48, borderWidth: 1, borderColor: t.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, color: t.ink, backgroundColor: t.surface, fontSize: 16, textAlignVertical: p.multiline ? 'top' : 'center' }} />
    </View>
  );
}
export function Chip({ title, on, onPress }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={{ paddingHorizontal: 12, minHeight: 38, borderRadius: 999, borderWidth: 1, justifyContent: 'center', borderColor: on ? t.accent : t.line, backgroundColor: on ? t.soft : t.surface }}>
      <Text style={{ color: on ? t.accent : t.ink, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}
export function Err({ children }) { const t = useTheme(); return children ? <Text accessibilityRole="alert" style={{ color: t.red, fontWeight: '600' }}>{children}</Text> : null; }
export const row = { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' };
export const styles = StyleSheet.create({ row: row });

export function Pick({ label, options, value, onChange }) {
  return (
    <View style={{ gap: 4 }}>
      {label ? <T muted size={13} bold>{label}</T> : null}
      <View style={row}>{options.map(([v, title]) => <Chip key={String(v)} title={title} on={v === value} onPress={() => onChange(v)} />)}</View>
    </View>
  );
}
export function Check({ label, value, onChange }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="checkbox" accessibilityState={{ checked: !!value }} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 }}>
      <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: value ? t.accent : t.line, backgroundColor: value ? t.accent : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {value ? <Text style={{ color: t.accentInk, fontWeight: '800' }}>✓</Text> : null}
      </View>
      <T style={{ flex: 1 }}>{label}</T>
    </Pressable>
  );
}
