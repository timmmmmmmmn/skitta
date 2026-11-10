// Kostenbewaking: Skitta blijft ruim onder de gratis limieten van Cloudflare. Wordt een grens bereikt,
// dan weigert Skitta het (foto's versturen of bellen via TURN) in plaats van dat er kosten ontstaan.
//
// Gratis per maand (november 2026): R2 10 GB opslag, 1 miljoen schrijf- en 10 miljoen leesacties;
// Realtime TURN 1000 GB. We houden ongeveer de helft aan als grens.

import { HttpError } from './util.js';

export const LIMITS = {
  r2Bytes: 7 * 1024 ** 3, // totale opslag
  r2Writes: 500_000, // per maand
  r2Reads: 5_000_000, // per maand (de meeste komen uit de cache)
  turnBytes: 400 * 1000 ** 3, // per maand
  userDailyBytes: 200 * 1024 ** 2, // uploads per persoon per dag
  fileBytes: 25 * 1024 ** 2 // per bijlage (de apps verkleinen foto's en video's eerst)
};

const month = () => new Date().toISOString().slice(0, 7);
const day = () => new Date().toISOString().slice(0, 10);

export const usageKey = {
  write: () => `r2_write:${month()}`,
  read: () => `r2_read:${month()}`,
  turn: () => `turn_bytes:${month()}`,
  upload: (uid) => `upload:${uid}:${day()}`
};

export function bump(env, key, n = 1) {
  return env.DB.prepare('INSERT INTO usage (key, n) VALUES (?, ?) ON CONFLICT DO UPDATE SET n = n + excluded.n').bind(key, n);
}

export async function used(env, key) {
  const row = await env.DB.prepare('SELECT n FROM usage WHERE key = ?').bind(key).first();
  return row?.n || 0;
}

export async function storedBytes(env) {
  const row = await env.DB.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM media WHERE in_r2 = 1').first();
  return row.n;
}

// Mag deze upload? Gooit een nette foutmelding als een grens bereikt is.
export async function checkUpload(env, uid, size) {
  if (size > LIMITS.fileBytes) throw new HttpError(413, `Bijlagen mogen maximaal ${LIMITS.fileBytes / 1024 ** 2} MB zijn`);
  const [stored, writes, today] = await Promise.all([storedBytes(env), used(env, usageKey.write()), used(env, usageKey.upload(uid))]);
  if (stored + size > LIMITS.r2Bytes) throw new HttpError(507, 'De opslag van Skitta is vol. Vraag de beheerder om oude bijlagen op te ruimen.');
  if (writes >= LIMITS.r2Writes) throw new HttpError(429, 'Skitta heeft deze maand het maximale aantal bijlagen bereikt. Volgende maand kan het weer.');
  if (today + size > LIMITS.userDailyBytes) throw new HttpError(429, 'Je hebt vandaag al veel bijlagen verstuurd. Morgen kan het weer.');
}

export async function canRead(env) {
  return (await used(env, usageKey.read())) < LIMITS.r2Reads;
}

export async function turnAllowed(env) {
  return (await used(env, usageKey.turn())) < LIMITS.turnBytes;
}

export async function usageReport(env) {
  const [stored, writes, reads, turn] = await Promise.all([
    storedBytes(env), used(env, usageKey.write()), used(env, usageKey.read()), used(env, usageKey.turn())
  ]);
  return {
    r2_bytes: stored, r2_bytes_max: LIMITS.r2Bytes,
    r2_writes: writes, r2_writes_max: LIMITS.r2Writes,
    r2_reads: reads, r2_reads_max: LIMITS.r2Reads,
    turn_bytes: turn, turn_bytes_max: LIMITS.turnBytes
  };
}
