// Moteur de surveillance : une sonde par seconde (box, Cloudflare, Google), regroupée minute par minute,
// détection des coupures (et où elles se situent) + test de débit régulier.
import { Platform } from 'react-native';
import NativeBg from '../modules/netcheck-background/src/NetCheckBackgroundModule';
import { setBackground } from './background';
import { IS_WEB, probe, speedTest, TARGETS } from './net';
import {
  dayKey,
  loadDay,
  loadSettings,
  saveDay,
  saveSettings,
  type Cut,
  type Day,
  type MinuteStat,
  type Settings,
  type SpeedTest,
} from './storage';

export const SLOW_MS = 300; // au-delà : connexion lente
const MIN_CUT_S = 2; // coupure = au moins 2 secondes sans internet (1 seule = « perte »)

export type Sample = {
  at: number;
  cf: number | null;
  g: number | null;
  box: number | null | undefined; // undefined = non mesurée (PC, 4G)
  state: 'ok' | 'slow' | 'down' | 'test';
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
  private acc = { n: 0, down: 0, box: 0, slow: 0, latSum: 0, latN: 0, max: 0, loss: 0 };
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
    this.day = await loadDay(dayKey());
    const lastSp = this.day.speeds[this.day.speeds.length - 1];
    this.lastSpeedAt = lastSp?.at ?? 0;
    if (this.settings.running) this.start();
    this.emit();
  }

  /** Recharge le jour courant (après effacement des données) */
  async reload() {
    this.day = await loadDay(dayKey());
    this.minuteIdx = -1;
    this.lastSpeedAt = 0;
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
    };
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
      const best = cf == null ? g : g == null ? cf : Math.min(cf, g);
      const up = best != null;
      let state: Sample['state'] = !up ? 'down' : best! > SLOW_MS ? 'slow' : 'ok';
      if (this.testing) state = 'test'; // pendant le test de débit la ligne est volontairement saturée
      const s: Sample = { at: now, cf, g, box, state };
      this.last = s;
      this.recent.push(s);
      if (this.recent.length > 120) this.recent.shift();
      if (state !== 'test') this.record(s);
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
    const best = s.cf == null ? s.g : s.g == null ? s.cf : Math.min(s.cf, s.g);
    if (s.box === null) a.box++;
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
      const cur: MinuteStat = [a.n, a.down, a.box, a.slow, a.latN ? Math.round(a.latSum / a.latN) : 0, a.max, a.loss];
      // Même minute déjà partiellement remplie (redémarrage) : on additionne
      this.day.minutes[this.minuteIdx] = prev
        ? [
            prev[0] + cur[0],
            prev[1] + cur[1],
            prev[2] + cur[2],
            prev[3] + cur[3],
            weighted(prev[4], prev[0] - prev[1], cur[4], cur[0] - cur[1]),
            Math.max(prev[5], cur[5]),
            prev[6] + cur[6],
          ]
        : cur;
      saveDay(this.day);
    }
    this.acc = { n: 0, down: 0, box: 0, slow: 0, latSum: 0, latN: 0, max: 0, loss: 0 };
  }

  private async rollDay(now: number) {
    const key = dayKey(new Date(now));
    if (this.day && this.day.date === key) return;
    this.closeCut(now);
    this.flushMinute();
    this.minuteIdx = -1;
    if (this.day) await saveDay(this.day);
    this.day = await loadDay(key);
  }

  // ---------- Test de débit ----------
  private maybeSpeedTest(now: number, up: boolean) {
    const every = this.settings?.speedEvery ?? 0;
    if (!every || this.testing || !up || this.openCut) return;
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
