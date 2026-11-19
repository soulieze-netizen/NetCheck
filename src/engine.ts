// Moteur de surveillance : une sonde par seconde (box, Cloudflare, Google), regroupée minute par minute,
// détection des coupures (et où elles se situent) + test de débit régulier.
import { Platform } from 'react-native';
import NativeBg from '../modules/netcheck-background/src/NetCheckBackgroundModule';
import { setBackground } from './background';
import { askScanPermission } from './diagnostic';
import { dur, hhmm, hhmmss, markCauses } from './analysis';
import { cleanTopic, Remote, type RemoteStatus } from './remote';
import { IS_TV, IS_WEB, probe, speedTest, TARGETS } from './net';
import {
  dayKey,
  loadDay,
  loadSettings,
  saveDay,
  saveSettings,
  iptvName,
  iptvUrls,
  apLabel,
  M,
  bandOf,
  type Mark,
  type Cut,
  type Day,
  type MinuteStat,
  type Settings,
  type SpeedTest,
} from './storage';

export const SLOW_MS = 300; // au-delà : connexion lente
const MIN_CUT_S = 2; // coupure = au moins 2 secondes sans internet (1 seule = « perte »)
// Pic = temps de réponse anormal par rapport à l'habitude (médiane des 60 dernières secondes)
const SPIKE_FACTOR = 3;
const SPIKE_MIN_MS = 150;
const IPTV_EVERY_MS = 2000; // serveur IPTV testé toutes les 2 s (assez pour voir un décrochage, sans le harceler)
const IPTV_TIMEOUT_MS = 3000;
const WIFI_EVERY_MS = 5000; // signal Wi-Fi relevé toutes les 5 s (Android)
const MARK_WINDOW_MS = 120000; // « Ça vient de couper » : on regarde les 2 min d'avant (le temps de quitter la chaîne et d'ouvrir l'appli)
const IPTV_MIN_CUT = 2; // décrochage IPTV = au moins 2 sondes de suite sans réponse alors qu'internet marche

const bestOf = (cf: number | null, g: number | null) => (cf == null ? g : g == null ? cf : Math.min(cf, g));
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
};

export type Sample = {
  at: number;
  cf: number | null;
  g: number | null;
  box: number | null | undefined; // undefined = non mesurée (PC, 4G)
  state: 'ok' | 'slow' | 'down' | 'test';
  spike?: boolean; // temps de réponse anormalement haut par rapport à l'habitude
};

/** Dernière sonde d'un serveur IPTV */
export type IptvSample = { at: number; ms: number | null };
/** Relevé Wi-Fi (Android) */
export type WifiSample = { at: number; rssi: number; link: number; freq: number; bssid: string | null; ssid: string | null };

export type IptvView = {
  srv: number; // 1 ou 2
  url: string;
  name: string;
  blocked: boolean; // PC + serveur en http : aucune réponse depuis le début, le navigateur bloque sans doute le test
  recent: IptvSample[]; // 2 dernières minutes
  openCut: Cut | null;
};

export type EngineState = {
  running: boolean;
  settings: Settings;
  day: Day | null;
  last: Sample | null;
  recent: Sample[]; // 2 dernières minutes
  openCut: Cut | null;
  testing: string | null; // étape du test de débit en cours
  boxIp: string | null;
  netType: string;
  lastSpeed: SpeedTest | null;
  nextSpeedAt: number | null;
  iptv: IptvView[]; // serveurs IPTV configurés (0, 1 ou 2)
  wifi: (WifiSample & { ap: string; band: string }) | null; // dernier relevé Wi-Fi (Android en Wi-Fi)
  wifiRecent: WifiSample[]; // 2 dernières minutes
  wifiRoamsRecent: number; // changements de point d'accès sur 2 min
  lastMark: Mark | null;
  remote: RemoteStatus;
};

type Listener = (s: EngineState) => void;

class Engine {
  private listeners = new Set<Listener>();
  private settings: Settings | null = null;
  private day: Day | null = null;
  private running = false;
  private busy = false;
  private ticker: { stop: () => void } | null = null;
  private recent: Sample[] = [];
  private last: Sample | null = null;
  // Minute en cours
  private minuteIdx = -1;
  private acc = newAcc();
  private prevBest: number | null = null;
  private prevBox: number | null = null;
  // Serveurs IPTV
  private iptv = [new IptvMonitor(this, 1), new IptvMonitor(this, 2)];
  // Wi-Fi
  private wifiAt = 0;
  private wifiRecent: WifiSample[] = [];
  private lastBssid: string | null = null;
  private lastFreq = 0;
  private hadWifi = false;
  private askedLocation = false;
  private lastMark: Mark | null = null;
  // Box : si elle ne répond jamais à l'ouverture de connexion alors qu'internet marche, on repasse à la page web
  private tcpFailsWhileUp = 0;
  private tcpBroken = false;
  // Liaison téléphone ↔ Chromecast (ntfy)
  private remote = new Remote(
    () => (this.settings ? cleanTopic(this.settings.ntfyTopic) : ''),
    () => `NetCheck · ${this.settings?.deviceLabel || (IS_TV ? 'Chromecast' : 'appareil')}`,
    (at) => {
      this.mark(at, true);
    },
    () => this.emit()
  );
  private wifiLostAt = 0;
  // Coupure en cours
  private downSince = 0;
  private downBox = false;
  private downBoxKnown = false;
  private openCut: Cut | null = null;
  private testing: string | null = null;
  private lastSpeedAt = 0;
  private boxIp: string | null = null;
  private boxCheckedAt = 0;
  private netType = IS_WEB ? 'pc' : 'wifi';
  private lastNotif = 0;

  async init() {
    if (this.settings) return;
    this.settings = await loadSettings();
    if (IS_TV && !this.settings.tvInit) {
      // Sur la télé : pas de test de débit automatique (il saturerait la ligne et couperait la chaîne qu'on regarde)
      // et c'est elle qui envoie les alertes au téléphone
      this.settings = { ...this.settings, tvInit: true, speedEvery: 0, alertsOn: true, deviceLabel: this.settings.deviceLabel || 'Chromecast' };
      saveSettings(this.settings);
    }
    this.day = await loadDay(dayKey());
    const lastSp = this.day.speeds[this.day.speeds.length - 1];
    this.lastSpeedAt = lastSp?.at ?? 0;
    // Sur la télé, la surveillance démarre dès l'ouverture : on lance l'appli une fois et on retourne à sa chaîne
    if (this.settings.running || IS_TV) this.start();
    this.emit();
  }

  /** Recharge le jour courant après effacement des données : on vide aussi tout ce qui est gardé en mémoire */
  async reload() {
    this.day = await loadDay(dayKey());
    this.minuteIdx = -1;
    this.lastSpeedAt = 0;
    this.acc = newAcc();
    this.recent = [];
    this.last = null;
    this.prevBest = this.prevBox = null;
    this.downSince = 0;
    this.openCut = null;
    this.iptv.forEach((m) => m.reset());
    this.wifiRecent = [];
    this.lastBssid = null;
    this.lastFreq = 0;
    this.hadWifi = false;
    this.lastMark = null;
    this.emit();
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    this.init().then(() => l(this.state()));
    return () => {
      this.listeners.delete(l);
    };
  }

  state(): EngineState {
    const every = this.settings?.speedEvery ?? 0;
    return {
      running: this.running,
      settings: this.settings!,
      day: this.day,
      last: this.last,
      recent: this.recent.slice(-120),
      openCut: this.openCut,
      testing: this.testing,
      boxIp: this.boxIp,
      netType: this.netType,
      lastSpeed: this.day?.speeds[this.day.speeds.length - 1] ?? null,
      nextSpeedAt: this.running && every > 0 ? Math.max(Date.now(), this.lastSpeedAt + every * 60000) : null,
      iptv: this.iptv.filter((m) => m.url()).map((m) => m.view()),
      wifi: (() => {
        const w = this.wifiRecent[this.wifiRecent.length - 1];
        if (!w || !this.day || Date.now() - w.at > 15000) return null;
        return { ...w, ap: apLabel(this.day, w.bssid), band: bandOf(w.freq) };
      })(),
      wifiRecent: this.wifiRecent.filter((w) => w.at > Date.now() - 120000),
      wifiRoamsRecent: (this.day?.wifiEvents ?? []).filter((e) => e.kind === 'roam' && e.at > Date.now() - 120000).length,
      lastMark: this.lastMark,
      remote: this.remote.status,
    };
  }

  /** Adresse (origine) du serveur IPTV n° srv, '' si non configuré */
  iptvUrlOf(srv: number) {
    return this.settings ? iptvUrls(this.settings)[srv - 1] : '';
  }
  iptvNameOf(srv: number) {
    return this.settings ? iptvName(this.settings, srv) : 'serveur IPTV';
  }

  private emit() {
    const s = this.state();
    this.listeners.forEach((l) => l(s));
  }

  async updateSettings(patch: Partial<Settings>) {
    await this.init();
    this.settings = { ...this.settings!, ...patch };
    saveSettings(this.settings);
    if ('boxIp' in patch) this.boxCheckedAt = 0;
    if ('iptvUrl' in patch) this.iptv[0].reset();
    if ('iptvUrl2' in patch) this.iptv[1].reset();
    this.emit();
  }

  // ---------- Démarrer / arrêter ----------
  start() {
    if (this.running) return;
    this.running = true;
    this.updateSettings({ running: true });
    this.ticker = startTicker(() => this.tick());
    this.notify(true);
    this.emit();
    // Android : la permission « position » donne le point d'accès Wi-Fi (box ou répéteur) auquel l'appareil est accroché
    if (!IS_WEB && !this.askedLocation) {
      this.askedLocation = true;
      askScanPermission().catch(() => {});
    }
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    this.ticker?.stop();
    this.ticker = null;
    this.closeCut(Date.now());
    this.iptv.forEach((m) => m.close(Date.now()));
    this.flushMinute();
    if (this.day) await saveDay(this.day);
    this.updateSettings({ running: false });
    setBackground(null);
    this.emit();
  }

  // ---------- Une mesure par seconde ----------
  private async tick() {
    if (this.busy || !this.running) return;
    this.busy = true;
    try {
      const now = Date.now();
      await this.rollDay(now);
      this.refreshBox(now);
      const [cf, g, box] = await Promise.all([probe(TARGETS.cloudflare), probe(TARGETS.google), this.probeBox()]);
      if (!this.running) return; // arrêtée (ou données effacées) pendant la mesure
      const best = bestOf(cf, g);
      const up = best != null;
      let state: Sample['state'] = !up ? 'down' : best! > SLOW_MS ? 'slow' : 'ok';
      if (this.testing) state = 'test'; // pendant le test de débit la ligne est volontairement saturée
      const s: Sample = { at: now, cf, g, box, state };
      if (up && state !== 'test') {
        const base = median(this.recent.slice(-60).filter((x) => x.state === 'ok' || x.state === 'slow').map((x) => bestOf(x.cf, x.g)!));
        if (base != null && best! >= Math.max(base * SPIKE_FACTOR, base + SPIKE_MIN_MS)) s.spike = true;
      }
      this.last = s;
      this.recent.push(s);
      if (this.recent.length > 180) this.recent.shift(); // 3 min gardées (« Ça coupe sur la télé » arrive avec un peu de retard)
      if (state !== 'test') this.record(s);
      else this.prevBest = this.prevBox = null; // pas de gigue calculée à travers un test de débit
      this.maybeIptv(now);
      this.maybeWifi(now);
      this.remote.tick(now, !!this.settings?.alertsOn, !!this.settings?.alertsOn);
      this.maybeSpeedTest(now, up);
      this.notify(false);
      this.emit();
    } finally {
      this.busy = false;
    }
  }

  /**
   * Temps de réponse de la box. Android : temps d'ouverture d'une connexion (le système de la box répond, pas sa page web
   * d'administration, qui est lente et irrégulière). Sinon (ancien module) : la page web.
   */
  private async probeBox(): Promise<number | null | undefined> {
    if (!this.boxIp) return undefined;
    if (NativeBg?.tcpPing && !this.tcpBroken) {
      try {
        const ms = await NativeBg.tcpPing(this.boxIp, 80, 1500);
        if (ms != null) {
          this.tcpFailsWhileUp = 0;
          return Math.round(ms);
        }
        // Internet passe forcément par la box : s'il répond et pas la box, c'est la méthode qui ne marche pas avec cette box
        if (this.last && this.last.state !== 'down' && ++this.tcpFailsWhileUp >= 5) this.tcpBroken = true;
        return null;
      } catch {}
    }
    return probe(`http://${this.boxIp}/`, 1500);
  }

  // ---------- Signal Wi-Fi (Android, toutes les 5 s) ----------
  private maybeWifi(now: number) {
    if (IS_WEB || !NativeBg || !this.day || now - this.wifiAt < WIFI_EVERY_MS) return;
    this.wifiAt = now;
    if (this.netType !== 'wifi') {
      this.hadWifi = false;
      return;
    }
    let w: ReturnType<NonNullable<typeof NativeBg>['wifiInfo']> = null;
    try {
      w = NativeBg.wifiInfo();
    } catch {}
    const day = this.day;
    const events = (day.wifiEvents ??= []);
    if (!w || w.rssi <= -127) {
      if (this.hadWifi) {
        events.push({ at: now, kind: 'lost' });
        this.wifiLostAt = now;
      }
      this.hadWifi = false;
      return;
    }
    const s: WifiSample = { at: now, rssi: w.rssi, link: w.linkSpeed, freq: w.frequency, bssid: w.bssid, ssid: w.ssid };
    if (s.bssid && !(day.aps ??= []).includes(s.bssid)) day.aps.push(s.bssid);
    if (!this.hadWifi && this.lastBssid !== null) {
      events.push({ at: now, kind: 'back', to: apLabel(day, s.bssid), rssi: s.rssi });
      if (this.wifiLostAt) this.alert(`${hhmm(this.wifiLostAt)} : Wi-Fi perdu pendant ${dur(Math.round((now - this.wifiLostAt) / 1000))}`);
      this.wifiLostAt = 0;
    }
    // Changement de point d'accès (box ↔ répéteur) : BSSID différent, ou à défaut changement de bande (2,4 ↔ 5 GHz)
    const roam =
      this.hadWifi &&
      ((s.bssid && this.lastBssid && s.bssid !== this.lastBssid) ||
        (!s.bssid && this.lastFreq && bandOf(this.lastFreq) !== bandOf(s.freq)));
    if (roam) {
      events.push({
        at: now,
        kind: 'roam',
        from: s.bssid ? apLabel(day, this.lastBssid) : bandOf(this.lastFreq),
        to: s.bssid ? apLabel(day, s.bssid) : bandOf(s.freq),
        rssi: s.rssi,
      });
      this.acc.roams++;
      const e = events[events.length - 1];
      this.alert(`${hhmm(now)} : bascule Wi-Fi du point d’accès ${e.from} vers ${e.to} (${s.rssi} dBm)`);
    }
    this.hadWifi = true;
    this.lastBssid = s.bssid ?? this.lastBssid;
    this.lastFreq = s.freq;
    const a = this.acc;
    a.rssiSum += s.rssi;
    a.rssiN++;
    if (!a.rssiMin || s.rssi < a.rssiMin) a.rssiMin = s.rssi;
    if (s.link > 0 && (!a.linkMin || s.link < a.linkMin)) a.linkMin = s.link;
    this.wifiRecent.push(s);
    while (this.wifiRecent.length && this.wifiRecent[0].at < now - 180000) this.wifiRecent.shift();
  }

  // ---------- « Ça vient de couper » ----------
  /**
   * Enregistre l'appui avec un résumé de ce qui était mesuré dans les 2 min d'avant.
   * `at` : heure de l'appui (sur le téléphone, pour « Ça coupe sur la télé ») ; `fromPhone` : renvoyer le résultat en alerte.
   */
  async mark(at = Date.now(), fromPhone = false) {
    await this.ensureDay();
    if (!this.day) return;
    const now = at;
    const from = now - MARK_WINDOW_MS;
    const xs = this.recent.filter((x) => x.at >= from && x.at <= now + 5000 && x.state !== 'test');
    const jit = (vals: (number | null | undefined)[]) => {
      let sum = 0,
        n = 0;
      for (let i = 1; i < vals.length; i++) {
        const p = vals[i - 1],
          c = vals[i];
        if (typeof p === 'number' && typeof c === 'number') {
          sum += Math.abs(c - p);
          n++;
        }
      }
      return n ? Math.round(sum / n) : null;
    };
    const wifi = this.wifiRecent.filter((w) => w.at >= from);
    const ev = (this.day.wifiEvents ?? []).filter((e) => e.at >= from);
    const m: Mark = {
      at: now,
      downS: xs.filter((x) => x.state === 'down').length,
      lost: xs.filter((x) => x.state !== 'down').reduce((a, x) => a + (x.cf == null ? 1 : 0) + (x.g == null ? 1 : 0), 0),
      jitter: jit(xs.map((x) => bestOf(x.cf, x.g))),
      boxJitter: jit(xs.map((x) => x.box)),
      spikes: xs.filter((x) => x.spike).length,
      boxDown: xs.filter((x) => x.box === null).length,
      iptvFails: this.iptv.filter((i) => i.url()).map((i) => i.failsSince(from)),
      rssiMin: wifi.length ? Math.min(...wifi.map((w) => w.rssi)) : null,
      roam: ev.some((e) => e.kind === 'roam'),
      wifiLost: ev.some((e) => e.kind === 'lost'),
    };
    (this.day.marks ??= []).push(m);
    this.lastMark = m;
    await saveDay(this.day);
    if (fromPhone || this.settings?.alertsOn)
      this.remote.alert(`Coupure signalée à ${hhmmss(now)} : ${markCauses(m).join(', ') || 'rien d’anormal mesuré (ni internet, ni Wi-Fi, ni IPTV)'}`);
    this.emit();
  }

  /** Téléphone : « Ça coupe sur la télé » → le Chromecast enregistre la coupure avec ses mesures */
  remoteMark() {
    return this.remote.sendMark();
  }

  /** Alerte envoyée au téléphone (si cet appareil envoie les alertes) */
  alert(text: string) {
    if (this.settings?.alertsOn) this.remote.alert(text);
  }

  private async ensureDay() {
    if (!this.day) this.day = await loadDay(dayKey());
  }

  private refreshBox(now: number) {
    if (now - this.boxCheckedAt < 60000) return;
    this.boxCheckedAt = now;
    if (IS_WEB) {
      this.boxIp = null; // une page web ne peut pas joindre la box
      return;
    }
    let type = 'wifi';
    try {
      type = NativeBg?.networkType() ?? 'wifi';
    } catch {}
    this.netType = type;
    if (type === 'cellular' || type === 'none') {
      this.boxIp = null;
      return;
    }
    let gw: string | null = null;
    try {
      gw = NativeBg?.gateway() ?? null;
    } catch {}
    this.boxIp = this.settings?.boxIp?.trim() || gw || '192.168.0.1';
  }

  private record(s: Sample) {
    const d = new Date(s.at);
    const idx = d.getHours() * 60 + d.getMinutes();
    if (idx !== this.minuteIdx) {
      this.flushMinute();
      this.minuteIdx = idx;
    }
    // Toutes les 15 s, la minute en cours est ajoutée à la journée (bilans à jour, rien de perdu si l'appli est fermée)
    else if (this.acc.n >= 15) this.flushMinute();
    const a = this.acc;
    a.n++;
    const best = bestOf(s.cf, s.g);
    if (s.box === null) a.box++;
    // Gigue = écart de temps de réponse d'une seconde à l'autre
    if (best != null && this.prevBest != null) {
      a.jitSum += Math.abs(best - this.prevBest);
      a.jitN++;
    }
    this.prevBest = best;
    const boxMs = typeof s.box === 'number' ? s.box : null;
    if (boxMs != null && this.prevBox != null) {
      a.boxJitSum += Math.abs(boxMs - this.prevBox);
      a.boxJitN++;
    }
    this.prevBox = boxMs;
    if (s.spike) a.spikes++;
    // Requêtes perdues : hors coupures (une coupure est déjà comptée à part)
    if (s.state !== 'down') {
      a.reqN += 2;
      a.reqLost += (s.cf == null ? 1 : 0) + (s.g == null ? 1 : 0);
    }
    if (s.state === 'down') {
      a.down++;
      if (!this.downSince) {
        this.downSince = s.at;
        this.downBox = false;
        this.downBoxKnown = false;
      }
      if (s.box === null) this.downBox = true;
      if (s.box != null) this.downBoxKnown = true;
      // Coupure confirmée au bout de 2 secondes
      if (!this.openCut && s.at - this.downSince >= (MIN_CUT_S - 1) * 1000) {
        this.openCut = { start: this.downSince, end: s.at, where: '?' };
        this.day!.cuts.push(this.openCut);
      }
      if (this.openCut) {
        this.openCut.end = s.at + 1000;
        this.openCut.where = this.downBox ? 'box' : this.downBoxKnown ? 'internet' : '?';
      }
    } else {
      if (this.downSince && !this.openCut) a.loss++; // une seule seconde perdue
      this.closeCut(s.at);
      if (best != null) {
        a.latSum += best;
        a.latN++;
        a.max = Math.max(a.max, best);
      }
      if (s.state === 'slow') a.slow++;
    }
  }

  private closeCut(at: number) {
    if (this.openCut) {
      const c = this.openCut;
      if (this.running && at > c.start)
        this.alert(
          `${hhmmss(c.start)} : internet coupé ${dur(Math.round((at - c.start) / 1000))} (${
            c.where === 'box' ? 'Wi-Fi / box injoignable' : c.where === 'internet' ? 'box joignable : ligne VOO' : 'cause inconnue'
          })`
        );
      this.openCut.end = at;
      this.openCut = null;
      if (this.day) saveDay(this.day);
    }
    this.downSince = 0;
  }

  private flushMinute() {
    const a = this.acc;
    if (this.minuteIdx >= 0 && a.n > 0 && this.day) {
      const prev = this.day.minutes[this.minuteIdx];
      const cur: MinuteStat = [
        a.n,
        a.down,
        a.box,
        a.slow,
        a.latN ? Math.round(a.latSum / a.latN) : 0,
        a.max,
        a.loss,
        a.jitSum,
        a.jitN,
        a.spikes,
        a.reqN,
        a.reqLost,
        a.boxJitSum,
        a.boxJitN,
        a.iptvN,
        a.iptvLost,
        a.iptvLatSum,
        a.iptv2N,
        a.iptv2Lost,
        a.iptv2LatSum,
        a.rssiSum,
        a.rssiN,
        a.rssiMin,
        a.linkMin,
        a.roams,
      ];
      // Même minute déjà partiellement remplie (redémarrage) : on additionne
      if (prev) {
        const merged = cur.map((v, i) => (v as number) + ((prev[i] as number | undefined) ?? 0)) as MinuteStat;
        merged[4] = weighted(prev[4], prev[0] - prev[1], cur[4], cur[0] - cur[1]);
        merged[5] = Math.max(prev[5], cur[5]);
        // « pire » valeur : 0 = pas de relevé
        const minNz = (x?: number, y?: number) => (!x ? y ?? 0 : !y ? x : Math.min(x, y));
        merged[M.rssiMin] = minNz(prev[M.rssiMin], cur[M.rssiMin]);
        merged[M.linkMin] = minNz(prev[M.linkMin], cur[M.linkMin]);
        this.day.minutes[this.minuteIdx] = merged;
      } else this.day.minutes[this.minuteIdx] = cur;
      saveDay(this.day);
    }
    this.acc = newAcc();
  }

  private async rollDay(now: number) {
    const key = dayKey(new Date(now));
    if (this.day && this.day.date === key) return;
    this.closeCut(now);
    this.iptv.forEach((m) => m.close(now));
    this.flushMinute();
    this.minuteIdx = -1;
    if (this.day) await saveDay(this.day);
    this.day = await loadDay(key);
  }

  // ---------- Serveurs IPTV (toutes les 2 s, en parallèle des sondes internet) ----------
  private maybeIptv(now: number) {
    if (this.testing) return;
    for (const m of this.iptv) m.maybe(now);
  }

  /** Appelé par un moniteur IPTV : internet est-il coupé en ce moment ? (alors ce n'est pas la faute du serveur) */
  internetDown() {
    return this.last?.state === 'down' || !!this.openCut;
  }
  canRecordIptv() {
    return this.running && !this.testing && !!this.day;
  }
  addIptvCut(c: Cut) {
    if (!this.day) return;
    (this.day.iptvCuts ??= []).push(c);
  }
  saveToday() {
    if (this.day) saveDay(this.day);
  }
  iptvAcc() {
    return this.acc;
  }
  changed() {
    this.emit();
  }

  // ---------- Test de débit ----------
  private maybeSpeedTest(now: number, up: boolean) {
    const every = this.settings?.speedEvery ?? 0;
    if (IS_TV || !every || this.testing || !up || this.openCut) return;
    if (now - this.lastSpeedAt < every * 60000) return;
    this.runSpeedTest();
  }

  async runSpeedTest() {
    if (this.testing) return;
    await this.init();
    this.testing = 'Démarrage…';
    this.lastSpeedAt = Date.now();
    this.emit();
    const r = await speedTest((step) => {
      this.testing = step;
      this.emit();
    });
    const t: SpeedTest = { at: Date.now(), down: r.down, up: r.up, ping: r.ping, error: r.error, net: this.netType };
    await this.rollDay(Date.now());
    this.day!.speeds.push(t);
    await saveDay(this.day!);
    this.testing = null;
    this.emit();
    return t;
  }

  // ---------- Notification Android ----------
  private notify(force: boolean) {
    if (Platform.OS !== 'android' || !this.running) return;
    const now = Date.now();
    if (!force && now - this.lastNotif < 30000) return;
    this.lastNotif = now;
    const d = this.day;
    const cuts = d?.cuts.length ?? 0;
    const sp = d?.speeds[d.speeds.length - 1];
    const state = this.last?.state === 'down' ? '🔴 Coupure en cours' : this.last?.state === 'slow' ? '🟠 Lente' : '🟢 OK';
    setBackground({
      title: `NetCheck surveille · ${state}`,
      text: `Aujourd'hui : ${cuts} coupure${cuts > 1 ? 's' : ''}${sp?.down != null ? ` · dernier débit ${Math.round(sp.down)} Mb/s` : ''}`,
    });
  }
}

function newAcc() {
  return {
    n: 0,
    down: 0,
    box: 0,
    slow: 0,
    latSum: 0,
    latN: 0,
    max: 0,
    loss: 0,
    jitSum: 0,
    jitN: 0,
    spikes: 0,
    reqN: 0,
    reqLost: 0,
    boxJitSum: 0,
    boxJitN: 0,
    iptvN: 0,
    iptvLost: 0,
    iptvLatSum: 0,
    iptv2N: 0,
    iptv2Lost: 0,
    iptv2LatSum: 0,
    rssiSum: 0,
    rssiN: 0,
    rssiMin: 0,
    linkMin: 0,
    roams: 0,
  };
}

/** Surveillance d'un serveur IPTV (toutes les 2 s, ne bloque pas la mesure de chaque seconde) */
class IptvMonitor {
  private busy = false;
  private at = 0;
  private recent: IptvSample[] = [];
  private fails = 0;
  private failSince = 0;
  private openCut: Cut | null = null;
  // PC + serveur http : tant qu'aucune réponse n'est arrivée, on suppose que le navigateur bloque (contenu mixte) et on ne compte rien
  private seenOk = false;
  private tried = 0;

  constructor(
    private eng: Engine,
    readonly srv: number
  ) {}

  url() {
    return this.eng.iptvUrlOf(this.srv);
  }
  /** Page web en https + serveur en http : bloqué par défaut par le navigateur (« contenu non sécurisé » à autoriser) */
  private mixed() {
    return IS_WEB && this.url().startsWith('http:');
  }
  view(): IptvView {
    return {
      srv: this.srv,
      url: this.url(),
      name: this.eng.iptvNameOf(this.srv),
      blocked: this.mixed() && !this.seenOk && this.tried >= 3,
      recent: this.recent.filter((x) => x.at > Date.now() - 120000),
      openCut: this.openCut,
    };
  }

  /** Sondes sans réponse depuis `from` (pour « Ça vient de couper ») */
  failsSince(from: number) {
    return this.recent.filter((x) => x.at >= from && x.ms == null).length;
  }

  reset() {
    this.close(Date.now());
    this.recent = [];
    this.seenOk = false;
    this.tried = 0;
  }

  maybe(now: number) {
    const url = this.url();
    if (!url || this.busy || now - this.at < IPTV_EVERY_MS) return;
    this.at = now;
    this.busy = true;
    probe(`${url}/`, IPTV_TIMEOUT_MS)
      .then((ms) => this.record(now, ms))
      .finally(() => {
        this.busy = false;
      });
  }

  private record(at: number, ms: number | null) {
    if (!this.eng.canRecordIptv()) return;
    if (this.mixed() && !this.seenOk) {
      // Pas encore de réponse : peut-être bloqué par le navigateur, on ne compte pas d'échec
      this.tried++;
      if (ms == null) return this.eng.changed();
      this.seenOk = true;
    }
    this.recent.push({ at, ms });
    while (this.recent.length && this.recent[0].at < Date.now() - 180000) this.recent.shift();
    // Si internet est lui-même coupé, ce n'est pas la faute du serveur IPTV : on ne compte pas
    if (this.eng.internetDown()) {
      this.close(at);
      return this.eng.changed();
    }
    const a = this.eng.iptvAcc();
    if (this.srv === 1) a.iptvN++;
    else a.iptv2N++;
    if (ms == null) {
      if (this.srv === 1) a.iptvLost++;
      else a.iptv2Lost++;
      if (!this.fails) this.failSince = at;
      this.fails++;
      if (!this.openCut && this.fails >= IPTV_MIN_CUT) {
        this.openCut = { start: this.failSince, end: at + IPTV_EVERY_MS, where: '?', ...(this.srv === 2 ? { srv: 2 } : {}) };
        this.eng.addIptvCut(this.openCut);
      }
      if (this.openCut) this.openCut.end = at + IPTV_EVERY_MS;
    } else {
      if (this.srv === 1) a.iptvLatSum += ms;
      else a.iptv2LatSum += ms;
      this.close(at);
    }
    this.eng.changed();
  }

  close(at: number) {
    if (this.openCut) {
      const c = this.openCut;
      this.eng.alert(`${hhmmss(c.start)} : ${this.eng.iptvNameOf(this.srv)} sans réponse ${dur(Math.round((at - c.start) / 1000))} (internet OK)`);
      this.openCut.end = at;
      this.openCut = null;
      this.eng.saveToday();
    }
    this.fails = 0;
  }
}

/** Moyenne de deux latences moyennes, pondérée par le nombre de secondes avec réponse */
function weighted(a: number, wa: number, b: number, wb: number) {
  if (wa <= 0) return b;
  if (wb <= 0) return a;
  return Math.round((a * wa + b * wb) / (wa + wb));
}

/** Horloge d'une seconde. Sur PC, dans un « worker » : continue même onglet en arrière-plan. */
function startTicker(fn: () => void): { stop: () => void } {
  if (IS_WEB && typeof Worker !== 'undefined' && typeof Blob !== 'undefined') {
    try {
      const code = 'setInterval(function(){postMessage(0)},1000);';
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      const w = new Worker(url);
      w.onmessage = () => fn();
      return {
        stop: () => {
          w.terminate();
          URL.revokeObjectURL(url);
        },
      };
    } catch {}
  }
  const id = setInterval(fn, 1000);
  return { stop: () => clearInterval(id) };
}

export const engine = new Engine();
