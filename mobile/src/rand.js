import * as Crypto from 'expo-crypto';
export const bytes = (n) => Crypto.getRandomBytes(n);
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newCode() { const b = bytes(10); let o = ''; for (let i = 0; i < 10; i++) o += ALPHA[b[i] % ALPHA.length]; return o; }
export function newKey() {
  const b = bytes(24); const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let o = ''; for (let i = 0; i < 24; i++) o += A[b[i] % 64]; return o;
}
export const showCode = (c) => String(c || '').replace(/^(.{4})(.{4})(.*)$/, '$1-$2-$3');
