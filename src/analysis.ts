// Calculs des bilans (jour, plusieurs jours) et verdict en clair.
import type { Cut, Day, Settings, SpeedTest } from './storage';

export const C = {
  bg: '#0B0F1A',
  panel: '#141A2A',
  panel2: '#1E2638',
  border: '#2A3350',
  text: '#E8ECF5',
  muted: '#8A93A8',
  ok: '#2ecc71',
  slow: '#f39c12',
  loss: '#e67e22',
  down: '#e74c3c',
  box: '#5dade2',
  none: '#232a3d',
  accent: '#ffd166',
};

export const cutSeconds = (c: Cut) => Math.max(1, Math.round((c.end - c.start) / 1000));

export function hhmm(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function hhmmss(ms: number) {
  const d = new Date(ms);
  return `${hhmm(ms)}:${String(d.getSeconds()).padStart(2, '0')}`;
}
export function dur(sec: number) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec} s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min ${sec % 60 ? `${sec % 60} s` : ''}`.trim();
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
export function dayLabel(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}
export const fmtMbps = (v: number | null | undefined) => (v == null ? '—' : `${v >= 100 ? Math.round(v) : v.toFixed(1).replace('.', ',')} Mb/s`);

/** Couleur d'une minute de la frise */
export function minuteColor(m: Day['minutes'][number]) {
  if (!m) return C.none;
  const [n, down, box, slow, , , loss] = m;
  if (down >= 2 || (down > 0 && down >= n / 2)) return box > 0 && box >= down ? C.box : C.down;
  if (loss > 0 || down > 0) return C.loss;
  if (slow > n / 4) return C.slow;
  return C.ok;
}

export type DaySummary = {
  date: string;
  measuredS: number;
  downS: number;
  uptime: number | null; // %
  cuts: number;
  micro: number; // < 10 s
  long: number; // >= 10 s
  boxCuts: number;
  lineCuts: number;
  unknownCuts: number;
  longest: number;
  losses: number;
  slowMin: number;
  avgLat: number | null;
  speeds: SpeedTest[];
  avgDown: number | null;
  minDown: number | null;
  avgUp: number | null;
  underMin: number; // tests sous le minimum du contrat
  eveningDown: number | null; // moyenne 19h-21h
};

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarize(day: Day, s: Settings): DaySummary {
  let measured = 0;
  let down = 0;
  let losses = 0;
  let slowMin = 0;
  let latSum = 0;
  let latN = 0;
  for (const m of day.minutes) {
    if (!m) continue;
    measured += m[0];
    down += m[1];
    losses += m[6];
    if (m[3] > m[0] / 4) slowMin++;
    if (m[4]) {
      latSum += m[4] * m[0];
      latN += m[0];
    }
  }
  const cuts = day.cuts;
  const secs = cuts.map(cutSeconds);
  const ok = day.speeds.filter((x) => x.down != null);
  const downs = ok.map((x) => x.down!);
  const evening = ok.filter((x) => {
    const h = new Date(x.at).getHours();
    return h >= 19 && h < 21;
  });
  return {
    date: day.date,
    measuredS: measured,
    downS: down,
    uptime: measured ? (100 * (measured - down)) / measured : null,
    cuts: cuts.length,
    micro: secs.filter((x) => x < 10).length,
    long: secs.filter((x) => x >= 10).length,
    boxCuts: cuts.filter((c) => c.where === 'box').length,
    lineCuts: cuts.filter((c) => c.where === 'internet').length,
    unknownCuts: cuts.filter((c) => c.where === '?').length,
    longest: secs.length ? Math.max(...secs) : 0,
    losses,
    slowMin,
    avgLat: latN ? Math.round(latSum / latN) : null,
    speeds: day.speeds,
    avgDown: avg(downs),
    minDown: downs.length ? Math.min(...downs) : null,
    avgUp: avg(ok.filter((x) => x.up != null).map((x) => x.up!)),
    underMin: s.downMin ? downs.filter((d) => d < s.downMin).length : 0,
    eveningDown: avg(evening.map((x) => x.down!)),
  };
}

/** Bilan en phrases simples */
export function verdict(list: DaySummary[], s: Settings, isPc: boolean): string[] {
  const out: string[] = [];
  const measured = list.reduce((a, d) => a + d.measuredS, 0);
  if (!measured) return ['Pas encore de mesures. Lance la surveillance et laisse tourner au moins une soirée.'];
  const cuts = list.reduce((a, d) => a + d.cuts, 0);
  const box = list.reduce((a, d) => a + d.boxCuts, 0);
  const line = list.reduce((a, d) => a + d.lineCuts, 0);
  const downS = list.reduce((a, d) => a + d.downS, 0);
  const hours = measured / 3600;
  out.push(
    `${dur(measured)} de mesure : ${cuts} coupure${cuts > 1 ? 's' : ''} (${dur(downS)} sans internet au total), soit ${(
      cuts / Math.max(hours, 1)
    ).toFixed(1).replace('.', ',')} par heure.`
  );
  if (cuts) {
    if (isPc) out.push('Mesure sur PC : la box n’est pas testée. Si le PC est branché en câble, les coupures viennent de la box ou de la ligne VOO, pas du Wi-Fi.');
    else if (line >= box * 2 && line > 0) out.push(`La box répondait pendant ${line} coupure(s) sur ${cuts} : le problème vient de la ligne / du réseau VOO, pas de ton Wi-Fi.`);
    else if (box >= line * 2 && box > 0) out.push(`La box elle-même ne répondait plus dans ${box} coupure(s) sur ${cuts} : problème de Wi-Fi (distance, interférences) ou de box qui redémarre.`);
    else if (box + line > 0) out.push(`Mélange : ${line} coupure(s) côté VOO, ${box} côté Wi-Fi / box.`);
  }
  const allSpeeds = list.flatMap((d) => d.speeds.filter((x) => x.down != null));
  if (allSpeeds.length) {
    const downs = allSpeeds.map((x) => x.down!);
    const a = avg(downs)!;
    const under = s.downMin ? downs.filter((d) => d < s.downMin).length : 0;
    let line2 = `Débit descendant moyen ${fmtMbps(a)} (${allSpeeds.length} test${allSpeeds.length > 1 ? 's' : ''}, minimum mesuré ${fmtMbps(Math.min(...downs))}).`;
    if (s.downMin) {
      line2 += ` ${under} test${under > 1 ? 's' : ''} sous le minimum du contrat (${s.downMin} Mb/s)`;
      line2 += s.downNormal ? `, moyenne = ${Math.round((100 * a) / s.downNormal)} % de la vitesse « normalement disponible » (${s.downNormal} Mb/s).` : '.';
    } else line2 += ' Entre les vitesses de ton contrat dans Réglages pour comparer.';
    out.push(line2);
    const ev = allSpeeds.filter((x) => {
      const h = new Date(x.at).getHours();
      return h >= 19 && h < 21;
    });
    const day = allSpeeds.filter((x) => {
      const h = new Date(x.at).getHours();
      return h >= 9 && h < 17;
    });
    if (ev.length && day.length) {
      const e = avg(ev.map((x) => x.down!))!;
      const dd = avg(day.map((x) => x.down!))!;
      if (e < dd * 0.7) out.push(`Le soir (19h-21h) le débit chute à ${fmtMbps(e)} contre ${fmtMbps(dd)} en journée : réseau saturé aux heures de pointe.`);
    }
    if (!isPc && allSpeeds.every((x) => x.net === 'wifi'))
      out.push('Ces débits sont mesurés en Wi-Fi : compare avec le PC branché en câble pour savoir si le Wi-Fi bride la connexion.');
  }
  return out;
}
