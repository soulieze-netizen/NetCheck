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
};

/** Une minute : [mesures, s. internet coupé, s. box injoignable, s. lentes, latence moy. ms, latence max ms, pertes isolées] */
export type MinuteStat = [number, number, number, number, number, number, number];

export type Cut = {
  start: number; // ms
  end: number; // ms (= start tant que la coupure dure)
  where: 'box' | 'internet' | '?'; // box/Wi-Fi injoignable, ou box OK mais internet coupé (ligne VOO)
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
