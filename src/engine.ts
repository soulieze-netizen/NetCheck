// Moteur de surveillance : une sonde par seconde (box, Cloudflare, Google), regroupée minute par minute,
// détection des coupures (et où elles se situent) + test de débit régulier.
import { Platform } from 'react-native';
import NativeBg from '../modules/netcheck-background/src/NetCheckBackgroundModule';
import { setBackground } from './background';
import { IS_TV, IS_WEB, probe, speedTest, TARGETS } from './net';
import {
  dayKey,
  loadDay,
  loadSettings,
  saveDay,
  saveSettings,
  iptvName,
  iptvUrls,
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
      this.settings = { ...this.settings, tvInit: true, speedEvery: 0, deviceLabel: this.settings.deviceLabel || 'Chromecast' };
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
      recent: this.recent,
      openCut: this.openCut,
      testing: this.testing,
      boxIp: this.boxIp,
      netType: this.netType,
      lastSpeed: this.day?.speeds[this.day.speeds.length - 1] ?? null,
      nextSpeedAt: this.running && every > 0 ? Math.max(Date.now(), this.lastSpeedAt + every * 60000) : null,
      iptv: this.iptv.filter((m) => m.url()).map((m) => m.view()),
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
      const boxUrl = this.boxIp ? `http://${this.boxIp}/` : null;
      const [cf, g, box] = await Promise.all([
        probe(TARGETS.cloudflare),
        probe(TARGETS.google),
        boxUrl ? probe(boxUrl, 1500) : Promise.resolve(undefined),
      ]);
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
      if (this.recent.length > 120) this.recent.shift();
      if (state !== 'test') this.record(s);
      else this.prevBest = this.prevBox = null; // pas de gigue calculée à travers un test de débit
      this.maybeIptv(now);
      this.maybeSpeedTest(now, up);
      this.notify(false);
      this.emit();
    } finally {
      this.busy = false;
    }
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
      ];
      // Même minute déjà partiellement remplie (redémarrage) : on additionne
      if (prev) {
        const merged = cur.map((v, i) => (v as number) + ((prev[i] as number | undefined) ?? 0)) as MinuteStat;
        merged[4] = weighted(prev[4], prev[0] - prev[1], cur[4], cur[0] - cur[1]);
        merged[5] = Math.max(prev[5], cur[5]);
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
      recent: this.recent,
      openCut: this.openCut,
    };
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
    while (this.recent.length && this.recent[0].at < Date.now() - 120000) this.recent.shift();
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
