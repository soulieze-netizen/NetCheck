// Mesures réseau : petites sondes (chaque seconde) et test de débit.
// Téléphone : requêtes natives (la box est joignable en http).
// PC (navigateur) : requêtes « no-cors » (on ne lit pas la réponse, seul le délai compte) ;
// la box n'est pas joignable depuis une page web, on ne mesure donc qu'internet.
import { fetch as expoFetch } from 'expo/fetch';
import { Platform } from 'react-native';

export const IS_WEB = Platform.OS === 'web';

export const TARGETS = {
  cloudflare: 'https://1.1.1.1/cdn-cgi/trace',
  google: 'https://www.google.com/generate_204',
};
const SPEED_HOST = 'https://speed.cloudflare.com';

let seq = 0;
const bust = (url: string) => `${url}${url.includes('?') ? '&' : '?'}nc=${Date.now()}${seq++}`;

/** Temps de réponse en ms, ou null si pas de réponse dans le délai */
export async function probe(url: string, timeoutMs = 2000): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    if (IS_WEB) {
      await fetch(bust(url), { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
    } else {
      // expo/fetch rend la main dès les en-têtes reçus ; on coupe ensuite pour ne pas télécharger la page
      const res = await expoFetch(bust(url), { signal: ctrl.signal, headers: { 'Cache-Control': 'no-cache' } });
      try {
        res.body?.cancel();
      } catch {}
    }
    return Date.now() - t0;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    try {
      ctrl.abort();
    } catch {}
  }
}

// ---------------- Test de débit ----------------

/** Téléphone : téléchargement de `bytes` octets dans un fichier temporaire, renvoie la durée en ms */
async function downloadOnce(bytes: number): Promise<number> {
  const url = bust(`${SPEED_HOST}/__down?bytes=${Math.round(bytes)}`);
  const t0 = Date.now();
  // Téléchargement natif (plus juste qu'en JavaScript)
  const { File, Paths } = require('expo-file-system') as typeof import('expo-file-system');
  const file = new File(Paths.cache, `speed_${Date.now()}_${seq++}.bin`);
  try {
    await File.downloadFileAsync(url, file);
    return Date.now() - t0;
  } finally {
    try {
      if (file.exists) file.delete();
    } catch {}
  }
}

/**
 * PC (navigateur) : débit descendant en Mb/s, comme fast.com.
 * Plusieurs flux téléchargent en continu pendant 8 s ; on compte les octets vraiment reçus,
 * en ignorant la 1re seconde et demie (montée en vitesse). Ne dépend ni de la taille demandée
 * ni des mesures internes du navigateur (l'ancienne méthode donnait 0,8 Mb/s au lieu de 166).
 */
async function webDownloadMbps(): Promise<number> {
  const STREAMS = 6;
  const DURATION = 8000;
  const WARMUP = 1500;
  const CHUNK = 25e6;
  const ctrl = new AbortController();
  const t0 = performance.now();
  let counted = 0;
  const errors: string[] = [];
  const stream = async () => {
    while (!ctrl.signal.aborted) {
      const res = await fetch(bust(`${SPEED_HOST}/__down?bytes=${CHUNK}`), { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && performance.now() - t0 >= WARMUP) counted += value.byteLength;
      }
    }
  };
  const tasks = Array.from({ length: STREAMS }, () =>
    stream().catch((e) => {
      if (!ctrl.signal.aborted) errors.push(e?.message ?? String(e));
    })
  );
  await new Promise((r) => setTimeout(r, DURATION));
  const elapsed = performance.now() - t0 - WARMUP;
  ctrl.abort();
  await Promise.all(tasks);
  if (errors.length >= STREAMS || counted === 0) {
    throw new Error(`Test descendant impossible${errors[0] ? ` (${errors[0]})` : ''}`);
  }
  return mbps(counted, elapsed);
}

async function uploadOnce(bytes: number): Promise<number> {
  const body = 'x'.repeat(Math.round(bytes));
  const url = bust(`${SPEED_HOST}/__up`);
  const t0 = Date.now();
  if (IS_WEB) {
    // text/plain : pas de requête préalable ; la réponse arrive une fois tout envoyé
    await fetch(url, { method: 'POST', body, mode: 'no-cors', cache: 'no-store', headers: { 'Content-Type': 'text/plain' } });
  } else {
    const res = await expoFetch(url, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } });
    try {
      res.body?.cancel();
    } catch {}
  }
  return Date.now() - t0;
}

const mbps = (bytes: number, ms: number) => (bytes * 8) / 1e6 / (ms / 1000);

/** Plusieurs téléchargements en parallèle : débit total en Mb/s */
async function parallel(fn: (b: number) => Promise<number>, streams: number, bytesEach: number) {
  const t0 = Date.now();
  await Promise.all(Array.from({ length: streams }, () => fn(bytesEach)));
  return mbps(bytesEach * streams, Date.now() - t0);
}

export type SpeedResult = { down: number | null; up: number | null; ping: number | null; error?: string };

/**
 * Test complet (~10-15 s) : ping, descendant, montant.
 * Taille adaptée au débit pour durer ~4 s (une ligne à 1 Gb/s télécharge ~500 Mo par test).
 */
export async function speedTest(onStep?: (s: string) => void): Promise<SpeedResult> {
  const out: SpeedResult = { down: null, up: null, ping: null };
  try {
    onStep?.('Temps de réponse…');
    const pings: number[] = [];
    await probe(TARGETS.cloudflare, 3000); // 1er essai = ouverture de la connexion, pas compté
    for (let i = 0; i < 6; i++) {
      const p = await probe(TARGETS.cloudflare, 3000);
      if (p != null) pings.push(p);
    }
    pings.sort((a, b) => a - b);
    out.ping = pings.length ? pings[Math.floor(pings.length / 2)] : null;

    onStep?.('Débit descendant…');
    if (IS_WEB) {
      out.down = Math.round((await webDownloadMbps()) * 10) / 10;
    } else {
      // Essai : 2 Mo, pour estimer
      const est = mbps(2e6, await downloadOnce(2e6));
      const streams = 4;
      const target = Math.min(Math.max((est * 1e6 * 4) / 8 / streams, 2e6), 125e6); // ~4 s, max 500 Mo au total
      out.down = Math.round((await parallel(downloadOnce, streams, target)) * 10) / 10;
    }

    onStep?.('Débit montant…');
    const estUp = mbps(1e6, await uploadOnce(1e6));
    const upStreams = 2;
    const upTarget = Math.min(Math.max((estUp * 1e6 * 4) / 8 / upStreams, 1e6), 25e6);
    out.up = Math.round((await parallel(uploadOnce, upStreams, upTarget)) * 10) / 10;
  } catch (e: any) {
    out.error = e?.message ?? String(e);
  }
  return out;
}
