// Données gardées dans l'appareil : réglages + une fiche par jour (minute par minute).
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Settings = {
  /** Vitesses du contrat VOO (Mb/s) */
  downMin: number;
  downNormal: number;
  downMax: number;
  upMin: number;
  upNormal: number;
  upMax: number;
  /** Test de débit toutes les X minutes (0 = jamais automatiquement) */
  speedEvery: number;
  /** Adresse de la box (vide = trouvée automatiquement) */
  boxIp: string;
  /** Surveillance en cours (relancée à l'ouverture de l'appli) */
  running: boolean;
  /** Nom de l'appareil dans les rapports (« Téléphone Wi-Fi », « PC câble »…) */
  deviceLabel: string;
  /** Serveur IPTV à surveiller (ex. http://monserveur.com:8080), vide = pas de test */
  iptvUrl: string;
  /** 2e serveur IPTV (beaucoup de fournisseurs en donnent deux : connexion / vidéo, ou secours) */
  iptvUrl2: string;
  /** Canal ntfy partagé entre le Chromecast et le téléphone ('' = pas de liaison) */
  ntfyTopic: string;
  /** Cet appareil envoie les alertes et écoute « Ça coupe sur la télé » (oui sur le Chromecast) */
  alertsOn: boolean;
  /** Réglages « télé » déjà appliqués (Chromecast / Android TV) */
  tvInit?: boolean;
};

export const defaultSettings: Settings = {
  downMin: 0,
  downNormal: 0,
  downMax: 0,
  upMin: 0,
  upNormal: 0,
  upMax: 0,
  speedEvery: 30,
  boxIp: '',
  running: false,
  deviceLabel: '',
  iptvUrl: '',
  iptvUrl2: '',
  ntfyTopic: '',
  alertsOn: false,
};

/**
 * Une minute : [mesures, s. internet coupé, s. box injoignable, s. lentes, latence moy. ms, latence max ms, pertes isolées,
 *  gigue internet (somme ms), gigue internet (nb), pics, requêtes internet envoyées, requêtes perdues,
 *  gigue box (somme ms), gigue box (nb), sondes IPTV, sondes IPTV sans réponse, latence IPTV (somme ms des réponses)]
 *  puis la même chose pour le 2e serveur IPTV (sondes, sans réponse, latence),
 *  puis le Wi-Fi (Android, relevé toutes les 5 s) : signal dBm (somme, nb, pire), pire vitesse de liaison (Mb/s), changements de point d'accès.
 *  rssiMin / linkMin : 0 = pas de relevé.
 * Les champs à partir de la gigue n'existent pas dans les mesures d'avant le 18/11/2026 (lire avec ?? 0).
 */
export type MinuteStat = [
  n: number,
  down: number,
  box: number,
  slow: number,
  lat: number,
  max: number,
  loss: number,
  jitSum?: number,
  jitN?: number,
  spikes?: number,
  reqN?: number,
  reqLost?: number,
  boxJitSum?: number,
  boxJitN?: number,
  iptvN?: number,
  iptvLost?: number,
  iptvLatSum?: number,
  iptv2N?: number,
  iptv2Lost?: number,
  iptv2LatSum?: number,
  rssiSum?: number,
  rssiN?: number,
  rssiMin?: number,
  linkMin?: number,
  roams?: number,
];
/** Index des champs ajoutés (gigue, pertes, IPTV) */
export const M = { jitSum: 7, jitN: 8, spikes: 9, reqN: 10, reqLost: 11, boxJitSum: 12, boxJitN: 13, iptvN: 14, iptvLost: 15, iptvLatSum: 16, iptv2N: 17, iptv2Lost: 18, iptv2LatSum: 19, rssiSum: 20, rssiN: 21, rssiMin: 22, linkMin: 23, roams: 24 } as const;
/** Index des champs de chaque serveur IPTV (1 et 2) */
export const IPTV_M = [
  { n: M.iptvN, lost: M.iptvLost, lat: M.iptvLatSum },
  { n: M.iptv2N, lost: M.iptv2Lost, lat: M.iptv2LatSum },
] as const;
export const mv = (m: MinuteStat, i: number) => (m[i] as number | undefined) ?? 0;

export type Cut = {
  start: number; // ms
  end: number; // ms (= start tant que la coupure dure)
  where: 'box' | 'internet' | '?'; // box/Wi-Fi injoignable, ou box OK mais internet coupé (ligne VOO)
  srv?: number; // décrochage IPTV : serveur 2 (absent = serveur 1)
};

export type SpeedTest = {
  at: number;
  down: number | null; // Mb/s
  up: number | null;
  ping: number | null; // ms
  error?: string;
  net?: string; // wifi / ethernet / cellular
};

export type Day = {
  date: string; // AAAA-MM-JJ
  minutes: (MinuteStat | null)[]; // 1440
  cuts: Cut[];
  speeds: SpeedTest[];
  /** Décrochages du serveur IPTV pendant qu'internet marchait */
  iptvCuts?: Cut[];
  /** Points d'accès Wi-Fi vus dans la journée (BSSID), dans l'ordre : A, B, C… */
  aps?: string[];
  /** Événements Wi-Fi : changement de point d'accès, Wi-Fi perdu / revenu */
  wifiEvents?: WifiEvent[];
  /** Appuis sur « Ça vient de couper », avec ce qui était mesuré juste avant */
  marks?: Mark[];
};

export type WifiEvent = { at: number; kind: 'roam' | 'lost' | 'back'; from?: string; to?: string; rssi?: number };

/** Ce que l'appli voyait dans les 2 min avant l'appui sur « Ça vient de couper » */
export type Mark = {
  at: number;
  downS: number; // secondes sans internet
  lost: number; // requêtes perdues (hors coupure)
  jitter: number | null;
  boxJitter: number | null;
  spikes: number;
  boxDown: number; // secondes où la box ne répondait pas
  iptvFails: number[]; // sondes sans réponse, par serveur IPTV
  rssiMin: number | null;
  roam: boolean;
  wifiLost: boolean;
};

export function dayKey(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const emptyDay = (date: string): Day => ({ date, minutes: new Array(1440).fill(null), cuts: [], speeds: [] });

const KEEP_DAYS = 45;

export async function loadSettings(): Promise<Settings> {
  try {
    const raw = await AsyncStorage.getItem('settings');
    return raw ? { ...defaultSettings, ...JSON.parse(raw) } : defaultSettings;
  } catch {
    return defaultSettings;
  }
}
export const saveSettings = (s: Settings) => AsyncStorage.setItem('settings', JSON.stringify(s)).catch(() => {});

export async function loadDay(date: string): Promise<Day> {
  try {
    const raw = await AsyncStorage.getItem(`day:${date}`);
    if (raw) {
      const d = JSON.parse(raw) as Day;
      if (Array.isArray(d.minutes) && d.minutes.length === 1440) return d;
    }
  } catch {}
  return emptyDay(date);
}
export async function saveDay(d: Day) {
  try {
    await AsyncStorage.setItem(`day:${d.date}`, JSON.stringify(d));
  } catch {}
}

/** Jours enregistrés, du plus récent au plus ancien (et ménage des trop vieux) */
export async function listDays(): Promise<string[]> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('day:')).map((k) => k.slice(4));
    keys.sort().reverse();
    const old = keys.slice(KEEP_DAYS);
    if (old.length) AsyncStorage.multiRemove(old.map((k) => `day:${k}`)).catch(() => {});
    return keys.slice(0, KEEP_DAYS);
  } catch {
    return [];
  }
}

export async function clearAllDays() {
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('day:'));
  await AsyncStorage.multiRemove(keys);
}

/** Adresse du serveur IPTV réduite à « http://hôte:port » : on ne garde jamais l'identifiant ni le mot de passe du code Xtream */
export function iptvOrigin(text: string): string {
  const m = text.trim().match(/^(https?:\/\/)?([^\/?#\s]+)/i);
  if (!m || !m[2].includes('.')) return '';
  return `${(m[1] || 'http://').toLowerCase()}${m[2].replace(/^.*@/, '')}`;
}

/** Les adresses IPTV configurées : [serveur 1, serveur 2] (chaîne vide = pas de test) */
export const iptvUrls = (s: Settings) => [iptvOrigin(s.iptvUrl ?? ''), iptvOrigin(s.iptvUrl2 ?? '')];
/** Nom d'un serveur IPTV dans les textes : « serveur IPTV » s'il n'y en a qu'un, sinon « serveur IPTV 1 (hôte) » */
export function iptvName(s: Settings, srv: number) {
  const urls = iptvUrls(s);
  const host = urls[srv - 1]?.replace(/^https?:\/\//, '');
  if (urls.filter(Boolean).length < 2) return 'serveur IPTV';
  return `serveur IPTV ${srv}${host ? ` (${host})` : ''}`;
}

/** Nom court d'un point d'accès : A, B, C… dans l'ordre où il a été vu ce jour-là */
export function apLabel(day: Day, bssid: string | null | undefined) {
  if (!bssid) return '?';
  const i = (day.aps ?? []).indexOf(bssid);
  return i < 0 ? '?' : String.fromCharCode(65 + (i % 26));
}
export const bandOf = (freq: number | null | undefined) => (!freq ? '' : freq >= 5925 ? '6 GHz' : freq >= 4900 ? '5 GHz' : '2,4 GHz');
