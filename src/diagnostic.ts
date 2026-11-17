// Diagnostic « box » : relevé fait par le téléphone, à l'intérieur du réseau de la maison.
// - le Wi-Fi du téléphone (force du signal, bande, canal, vitesse de liaison) ;
// - les Wi-Fi voisins (encombrement du canal) ;
// - la réactivité de la box et d'internet (20 essais chacun) ;
// - les pages de la box (192.168.0.1) et du modem câble (192.168.100.1) : modèle, signal si lisible sans mot de passe.
// Rien n'est modifié dans la box : on regarde seulement. Le rapport ne contient aucun mot de passe.
import { fetch as expoFetch } from 'expo/fetch';
import { PermissionsAndroid, Platform } from 'react-native';
import Native, { type ScanNet, type WifiInfo } from '../modules/netcheck-background/src/NetCheckBackgroundModule';
import { probe, TARGETS } from './net';

export type Band = '2,4 GHz' | '5 GHz' | '6 GHz';
export type Neighbor = ScanNet & { band: Band; channel: number; mine: boolean; overlaps: boolean };
export type Rtt = { tries: number; ok: number; median: number | null; worst: number | null };
export type PageInfo = {
  url: string;
  reachable: boolean;
  status?: number;
  title?: string;
  model?: string;
  needsLogin?: boolean;
  signal?: string; // extrait de texte avec des niveaux (dBmV, dB…) si la page les montre sans mot de passe
};

export type Diagnostic = {
  at: number;
  netType: string;
  wifi: (WifiInfo & { band: Band | null; channel: number | null }) | null;
  scan: { done: boolean; reason?: string; neighbors: Neighbor[] };
  bestChannel: { band: Band; channel: number; now: number; crowd: number } | null;
  box: { ip: string; rtt: Rtt; page: PageInfo };
  modem: PageInfo | null;
  internet: Rtt;
  findings: { level: 'ok' | 'warn' | 'bad'; text: string }[];
};

// ---------- Outils Wi-Fi ----------

export function bandOf(f: number): Band {
  if (f < 3000) return '2,4 GHz';
  if (f < 5925) return '5 GHz';
  return '6 GHz';
}
export function channelOf(f: number): number {
  if (f === 2484) return 14;
  if (f < 3000) return Math.round((f - 2407) / 5);
  if (f < 5925) return Math.round((f - 5000) / 5);
  return Math.round((f - 5950) / 5);
}
/** Plage de fréquences occupée par un réseau (en 2,4 GHz un canal déborde sur ±11 MHz) */
function range(center: number, width: number, freq: number): [number, number] {
  const half = freq < 3000 ? Math.max(11, width / 2) : width / 2;
  return [center - half, center + half];
}
const overlap = (a: [number, number], b: [number, number]) => a[0] < b[1] && b[0] < a[1];

export function signalWord(rssi: number) {
  if (rssi >= -55) return 'excellent';
  if (rssi >= -67) return 'bon';
  if (rssi >= -75) return 'faible';
  return 'très faible';
}
const STANDARD: Record<number, string> = { 1: 'ancien', 4: 'Wi-Fi 4', 5: 'Wi-Fi 5', 6: 'Wi-Fi 6', 7: 'Wi-Fi 7', 8: 'Wi-Fi 7' };

// ---------- Mesures ----------

async function rttSeries(url: string, n: number, timeoutMs: number, onTick?: (i: number) => void): Promise<Rtt> {
  const vals: number[] = [];
  for (let i = 0; i < n; i++) {
    onTick?.(i);
    const t = await probe(url, timeoutMs);
    if (t != null) vals.push(t);
    await new Promise((r) => setTimeout(r, 150));
  }
  vals.sort((a, b) => a - b);
  return {
    tries: n,
    ok: vals.length,
    median: vals.length ? vals[Math.floor(vals.length / 2)] : null,
    worst: vals.length ? vals[vals.length - 1] : null,
  };
}

const MODEL_RE =
  /(connect\s*box|giga\s*box|ch7465\w*|tc\d{4}\w*|cga\d{4}\w*|technicolor|compal|sagemcom|f@st\s*\d+\w*|ubee|hitron|arris|tg\d{4}\w*|cbn|voo\s*box|fritz!?box)/i;

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readPage(url: string): Promise<PageInfo> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await expoFetch(url, { signal: ctrl.signal, headers: { 'Cache-Control': 'no-cache' } });
    let html = '';
    try {
      html = (await res.text()).slice(0, 300000);
    } catch {}
    const text = htmlToText(html);
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim().slice(0, 80);
    const model = (MODEL_RE.exec(title ?? '') ?? MODEL_RE.exec(html))?.[1]?.trim();
    const needsLogin = res.status === 401 || /type=["']?password/i.test(html) || /login|connexion|mot de passe|password/i.test(title ?? '');
    // Niveaux du signal câble, si la page les affiche sans mot de passe
    let signal: string | undefined;
    const m = /.{0,200}(dBmV|SNR|MER)[\s\S]{0,400}/i.exec(text);
    if (m) signal = m[0].slice(0, 600);
    return { url, reachable: true, status: res.status, title, model, needsLogin, signal };
  } catch {
    return { url, reachable: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Demande la permission « position » (obligatoire pour voir les Wi-Fi voisins). */
export async function askScanPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const perms = [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    if (Number(Platform.Version) >= 33) perms.push('android.permission.NEARBY_WIFI_DEVICES' as any);
    const res = await PermissionsAndroid.requestMultiple(perms);
    return res[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

// ---------- Diagnostic complet ----------

export async function runDiagnostic(onStep: (s: string) => void): Promise<Diagnostic> {
  const findings: Diagnostic['findings'] = [];
  const netType = (() => {
    try {
      return Native?.networkType() ?? 'other';
    } catch {
      return 'other';
    }
  })();

  // 1. Wi-Fi du téléphone
  onStep('Lecture du Wi-Fi du téléphone…');
  const allowed = await askScanPermission();
  let raw: WifiInfo | null = null;
  try {
    raw = Native?.wifiInfo() ?? null;
  } catch {}
  const wifi = raw ? { ...raw, band: raw.frequency > 0 ? bandOf(raw.frequency) : null, channel: raw.frequency > 0 ? channelOf(raw.frequency) : null } : null;

  // 2. Wi-Fi voisins
  onStep('Recherche des Wi-Fi voisins (10 s)…');
  const scan: Diagnostic['scan'] = { done: false, neighbors: [] };
  let locOn = true;
  try {
    locOn = Native?.locationEnabled() ?? false;
  } catch {}
  if (!Native) scan.reason = 'module Android absent';
  else if (!allowed) scan.reason = 'autorisation « Position » refusée';
  else if (!locOn) scan.reason = 'localisation du téléphone désactivée';
  else {
    try {
      const out = await Native.scanWifi();
      if (out.ok) {
        scan.done = true;
        const myRange = wifi?.frequency
          ? range(
              out.results.find((r) => r.bssid === wifi.bssid)?.center ?? wifi.frequency,
              out.results.find((r) => r.bssid === wifi.bssid)?.width ?? 20,
              wifi.frequency
            )
          : null;
        scan.neighbors = out.results
          .map((r) => ({
            ...r,
            band: bandOf(r.frequency),
            channel: channelOf(r.frequency),
            mine: (!!wifi?.bssid && r.bssid === wifi.bssid) || (!!wifi?.ssid && r.ssid === wifi.ssid),
            overlaps: !!myRange && overlap(myRange, range(r.center, r.width, r.frequency)),
          }))
          .sort((a, b) => b.level - a.level);
      } else scan.reason = out.error === 'permission' ? 'autorisation refusée' : out.error;
    } catch (e: any) {
      scan.reason = e?.message ?? String(e);
    }
  }

  // 3. Box et internet
  let ip = '192.168.0.1';
  try {
    ip = Native?.gateway() ?? ip;
  } catch {}
  onStep(`Réactivité de la box (${ip})…`);
  const boxRtt = await rttSeries(`http://${ip}/`, 20, 1500, (i) => onStep(`Réactivité de la box… ${i + 1}/20`));
  onStep('Réactivité d’internet…');
  const internet = await rttSeries(TARGETS.cloudflare, 20, 3000, (i) => onStep(`Réactivité d’internet… ${i + 1}/20`));

  // 4. Pages de la box et du modem câble
  onStep('Lecture de la page de la box…');
  const page = await readPage(`http://${ip}/`);
  let modem: PageInfo | null = null;
  if (ip !== '192.168.100.1') {
    onStep('Recherche de la page du modem câble…');
    modem = await readPage('http://192.168.100.1/');
  }

  // ---------- Conclusions ----------
  if (netType !== 'wifi') {
    findings.push({ level: 'warn', text: `Le téléphone n'est pas en Wi-Fi (${netType}) : connecte-le au Wi-Fi de la maison et relance.` });
  }
  if (wifi) {
    const w = signalWord(wifi.rssi);
    findings.push({
      level: wifi.rssi >= -67 ? 'ok' : wifi.rssi >= -75 ? 'warn' : 'bad',
      text: `Signal Wi-Fi à cet endroit : ${w} (${wifi.rssi} dBm).${wifi.rssi < -67 ? ' Rapproche-toi de la box pour comparer : si tout va mieux près de la box, c’est la portée (répéteur ou Wi-Fi maillé).' : ''}`,
    });
    const other5 = scan.neighbors.find((n) => n.mine && n.band !== '2,4 GHz' && n.bssid !== wifi.bssid);
    if (wifi.band === '2,4 GHz' && other5) {
      findings.push({
        level: 'warn',
        text: `Le téléphone est sur le 2,4 GHz alors que ta box émet aussi en ${other5.band} (${other5.level} dBm ici). Le 5 GHz est bien plus rapide et moins encombré à courte distance.`,
      });
    }
  }
  const crowd = scan.neighbors.filter((n) => !n.mine && n.overlaps && n.level > -82);
  if (wifi && scan.done) {
    const strong = crowd.filter((n) => n.level > -70).length;
    findings.push({
      level: strong >= 2 || crowd.length >= 5 ? 'bad' : crowd.length >= 2 ? 'warn' : 'ok',
      text: `Canal ${wifi.channel} (${wifi.band}) : ${crowd.length} réseau(x) voisin(s) sur la même fréquence, dont ${strong} fort(s).`,
    });
  }
  // Meilleur canal pour la bande utilisée
  let bestChannel: Diagnostic['bestChannel'] = null;
  if (wifi?.band && scan.done && wifi.band !== '6 GHz') {
    const cands = wifi.band === '2,4 GHz' ? [1, 6, 11] : [36, 40, 44, 48, 149, 153, 157, 161];
    const freqOf = (ch: number) => (wifi.band === '2,4 GHz' ? 2407 + ch * 5 : 5000 + ch * 5);
    const score = (ch: number) => {
      const f = freqOf(ch);
      const r = range(f, 20, f);
      return scan.neighbors
        .filter((n) => !n.mine && n.band === wifi.band && n.level > -85)
        .filter((n) => overlap(r, range(n.center, n.width, n.frequency)))
        .reduce((s, n) => s + Math.pow(10, (n.level + 100) / 20), 0);
    };
    const scored = cands.map((ch) => ({ ch, s: score(ch) })).sort((a, b) => a.s - b.s);
    const nowScore = wifi.channel != null ? score(wifi.channel) : Infinity;
    const best = scored[0];
    if (best && best.ch !== wifi.channel && best.s < nowScore * 0.5) {
      const n = scan.neighbors.filter((x) => !x.mine && x.band === wifi.band && x.level > -85).filter((x) => {
        const f = freqOf(best.ch);
        return overlap(range(f, 20, f), range(x.center, x.width, x.frequency));
      }).length;
      bestChannel = { band: wifi.band, channel: best.ch, now: wifi.channel ?? 0, crowd: n };
      findings.push({
        level: 'warn',
        text: `Le canal ${best.ch} est moins encombré (${n} voisin(s)) que ton canal actuel ${wifi.channel}. Changer de canal dans la box peut réduire les coupures.`,
      });
    }
  }
  // Box / internet
  const boxLoss = boxRtt.tries - boxRtt.ok;
  const netLoss = internet.tries - internet.ok;
  if (boxRtt.ok === 0) {
    findings.push({ level: 'warn', text: `La box (${ip}) ne répond pas en http : impossible de mesurer le Wi-Fi seul.` });
  } else {
    const bad = boxLoss > 0 || (boxRtt.median ?? 0) > 40 || (boxRtt.worst ?? 0) > 300;
    findings.push({
      level: boxLoss > 1 || (boxRtt.median ?? 0) > 80 ? 'bad' : bad ? 'warn' : 'ok',
      text: `Téléphone ↔ box : ${boxRtt.median} ms en moyenne, pire ${boxRtt.worst} ms, ${boxLoss} perte(s) sur 20.${bad ? ' Le Wi-Fi entre le téléphone et la box est instable.' : ' Le Wi-Fi jusqu’à la box est correct.'}`,
    });
  }
  findings.push({
    level: netLoss > 1 || (internet.median ?? 999) > 100 ? 'bad' : netLoss > 0 || (internet.median ?? 999) > 50 ? 'warn' : 'ok',
    text: `Téléphone ↔ internet : ${internet.median ?? '—'} ms en moyenne, pire ${internet.worst ?? '—'} ms, ${netLoss} perte(s) sur 20.`,
  });
  if (boxRtt.ok >= 19 && (boxRtt.median ?? 0) < 30 && (netLoss > 1 || (internet.median ?? 0) > 100)) {
    findings.push({
      level: 'bad',
      text: 'La box répond bien mais internet non : le problème vient plutôt de la ligne VOO (câble, signal) que du Wi-Fi.',
    });
  }
  const model = page.model ?? modem?.model;
  findings.push({
    level: 'ok',
    text: model
      ? `Modèle de box repéré : ${model}.`
      : page.reachable
        ? `Page de la box trouvée (« ${page.title ?? 'sans titre'} ») mais modèle non reconnu.`
        : 'Page de la box introuvable.',
  });

  return { at: Date.now(), netType, wifi, scan, bestChannel, box: { ip, rtt: boxRtt, page }, modem, internet, findings };
}

// ---------- Rapport texte (à partager) ----------

export function reportText(d: Diagnostic): string {
  const L: string[] = [];
  const dt = new Date(d.at);
  L.push(`NetCheck — diagnostic box du ${dt.toLocaleDateString('fr-FR')} à ${dt.toLocaleTimeString('fr-FR').slice(0, 5)}`);
  L.push('');
  L.push('CONCLUSIONS');
  for (const f of d.findings) L.push(`${f.level === 'ok' ? '✅' : f.level === 'warn' ? '⚠️' : '❌'} ${f.text}`);
  L.push('');
  L.push('WI-FI DU TÉLÉPHONE');
  if (d.wifi) {
    L.push(`Réseau : ${d.wifi.ssid ?? '(nom masqué)'} · ${d.wifi.band ?? '?'} · canal ${d.wifi.channel ?? '?'}`);
    L.push(`Signal : ${d.wifi.rssi} dBm (${signalWord(d.wifi.rssi)}) · liaison ${d.wifi.linkSpeed} Mb/s${d.wifi.rxSpeed ? ` (réception ${d.wifi.rxSpeed})` : ''}`);
    if (d.wifi.standard) L.push(`Norme : ${STANDARD[d.wifi.standard] ?? d.wifi.standard}`);
  } else L.push(`Pas de Wi-Fi (${d.netType})`);
  L.push('');
  L.push('WI-FI VISIBLES');
  if (!d.scan.done) L.push(`Scan impossible : ${d.scan.reason ?? '?'}`);
  else {
    const mine = d.scan.neighbors.filter((n) => n.mine);
    const others = d.scan.neighbors.filter((n) => !n.mine);
    for (const n of mine) L.push(`[à toi] ${n.band} canal ${n.channel} (${n.width} MHz) : ${n.level} dBm`);
    L.push(`${others.length} réseau(x) voisin(s) :`);
    for (const n of others.slice(0, 25))
      L.push(`- ${n.band} canal ${n.channel} (${n.width} MHz) : ${n.level} dBm${n.overlaps ? ' ← même fréquence que toi' : ''}`);
  }
  L.push('');
  L.push('BOX ET INTERNET');
  const r = (x: Rtt) => (x.ok ? `${x.median} ms (pire ${x.worst} ms), ${x.tries - x.ok} perte(s)/${x.tries}` : `aucune réponse sur ${x.tries}`);
  L.push(`Box ${d.box.ip} : ${r(d.box.rtt)}`);
  L.push(`Internet : ${r(d.internet)}`);
  L.push('');
  L.push('PAGES DE LA BOX');
  const p = (x: PageInfo) =>
    x.reachable
      ? `${x.url} → code ${x.status}, titre « ${x.title ?? '—'} »${x.model ? `, modèle ${x.model}` : ''}${x.needsLogin ? ', demande un mot de passe' : ''}`
      : `${x.url} → pas de réponse`;
  L.push(p(d.box.page));
  if (d.box.page.signal) L.push(`Signal lu : ${d.box.page.signal}`);
  if (d.modem) {
    L.push(p(d.modem));
    if (d.modem.signal) L.push(`Signal lu : ${d.modem.signal}`);
  }
  return L.join('\n');
}
