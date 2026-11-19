// Calculs des bilans (jour, plusieurs jours) et verdict en clair.
import { IPTV_M, iptvName, M, mv, type Cut, type Day, type Mark, type Settings, type SpeedTest } from './storage';

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
  // Stabilité
  jitter: number | null; // gigue internet moyenne (ms)
  boxJitter: number | null; // gigue entre l'appareil et la box (ms) : élevée = Wi-Fi instable
  spikes: number; // pics de temps de réponse
  reqLossPct: number | null; // % de requêtes perdues hors coupures
  // Serveurs IPTV : [serveur 1, serveur 2]
  iptv: IptvSum[];
  // Wi-Fi (Android)
  rssiAvg: number | null;
  rssiMin: number | null;
  linkMin: number | null;
  roams: number;
  wifiLost: number;
  marks: Mark[];
  memMin: number | null; // mémoire libre la plus basse (Mo)
  memLowN: number; // relevés « mémoire basse » (1 toutes les 5 s)
};

/** Ce qui a été vu autour d'un appui sur « Ça vient de couper » */
export function markCauses(m: Mark): string[] {
  const out: string[] = [];
  if (m.downS > 0) out.push(`internet coupé ${m.downS} s`);
  if (m.wifiLost) out.push('Wi-Fi perdu');
  if (m.roam) out.push('changement de point d’accès Wi-Fi');
  if (m.boxDown > 0 && !m.downS) out.push(`box sans réponse ${m.boxDown} s`);
  if (m.rssiMin != null && m.rssiMin <= -75) out.push(`signal Wi-Fi faible (${m.rssiMin} dBm)`);
  m.iptvFails.forEach((f, i) => {
    if (f > 0) out.push(`serveur IPTV${m.iptvFails.length > 1 ? ` ${i + 1}` : ''} sans réponse (${f}×)`);
  });
  if ((m.jitter ?? 0) >= 30) out.push(`gigue ${m.jitter} ms`);
  if (m.spikes >= 3) out.push(`${m.spikes} pics de temps de réponse`);
  if (memIsLow(m.memMinMb, m.memTotalMb, m.memLow)) out.push(`mémoire de l’appareil saturée (${m.memMinMb} Mo libres)`);
  if (m.lost > 0 && !m.downS) out.push(`${m.lost} requête${m.lost > 1 ? 's' : ''} perdue${m.lost > 1 ? 's' : ''}`);
  return out;
}

/** Mémoire basse : signalée par Android, ou moins de 10 % libre */
export const memIsLow = (availMb?: number | null, totalMb?: number | null, low?: boolean) =>
  !!low || (availMb != null && !!totalMb && availMb < totalMb * 0.1);

/** Signal Wi-Fi en mots */
export const rssiWord = (r: number) => (r >= -60 ? 'bon' : r >= -70 ? 'moyen' : 'faible');

export type IptvSum = {
  srv: number;
  n: number; // tests comptés (internet OK)
  lost: number;
  lossPct: number | null;
  avgLat: number | null;
  cuts: number;
  downS: number;
  longest: number;
};

function wifiStats(day: Day) {
  let sum = 0,
    n = 0,
    min = 0,
    link = 0,
    roams = 0,
    mem = 0,
    memLowN = 0;
  for (const m of day.minutes) {
    if (!m) continue;
    sum += mv(m, M.rssiSum);
    n += mv(m, M.rssiN);
    const rm = mv(m, M.rssiMin),
      lm = mv(m, M.linkMin);
    if (rm && (!min || rm < min)) min = rm;
    if (lm && (!link || lm < link)) link = lm;
    roams += mv(m, M.roams);
    const mm = mv(m, M.memMin);
    if (mm && (!mem || mm < mem)) mem = mm;
    memLowN += mv(m, M.memLowN);
  }
  return {
    rssiAvg: n ? Math.round(sum / n) : null,
    rssiMin: min || null,
    linkMin: link || null,
    roams,
    wifiLost: (day.wifiEvents ?? []).filter((e) => e.kind === 'lost').length,
    marks: day.marks ?? [],
    memMin: mem || null,
    memLowN,
  };
}

/** Gigue et pertes calculées sur une liste de minutes */
export function stability(minutes: Day['minutes']) {
  let jitS = 0,
    jitN = 0,
    bjS = 0,
    bjN = 0,
    spikes = 0,
    reqN = 0,
    reqLost = 0;
  const ip = IPTV_M.map(() => ({ n: 0, lost: 0, lat: 0 }));
  for (const m of minutes) {
    if (!m) continue;
    jitS += mv(m, M.jitSum);
    jitN += mv(m, M.jitN);
    bjS += mv(m, M.boxJitSum);
    bjN += mv(m, M.boxJitN);
    spikes += mv(m, M.spikes);
    reqN += mv(m, M.reqN);
    reqLost += mv(m, M.reqLost);
    IPTV_M.forEach((f, i) => {
      ip[i].n += mv(m, f.n);
      ip[i].lost += mv(m, f.lost);
      ip[i].lat += mv(m, f.lat);
    });
  }
  return {
    jitter: jitN ? Math.round(jitS / jitN) : null,
    boxJitter: bjN ? Math.round(bjS / bjN) : null,
    spikes,
    reqLossPct: reqN ? (100 * reqLost) / reqN : null,
    iptvStats: ip.map((x) => ({
      n: x.n,
      lost: x.lost,
      lossPct: x.n ? (100 * x.lost) / x.n : null,
      avgLat: x.n > x.lost ? Math.round(x.lat / (x.n - x.lost)) : null,
    })),
  };
}

export const pct = (v: number | null | undefined, digits = 1) => (v == null ? '—' : `${v.toFixed(digits).replace('.', ',')} %`);

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
  const stab = stability(day.minutes);
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
    ...stab,
    ...wifiStats(day),
    iptv: stab.iptvStats.map((x, i) => {
      const cuts = (day.iptvCuts ?? []).filter((c) => (c.srv ?? 1) === i + 1);
      return {
        srv: i + 1,
        ...x,
        cuts: cuts.length,
        downS: cuts.reduce((a, c) => a + cutSeconds(c), 0),
        longest: Math.max(0, ...cuts.map(cutSeconds)),
      };
    }),
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
  // Stabilité : ce qui fait saccader la vidéo sans vraie coupure
  const wavg = (f: (d: DaySummary) => number | null) => {
    let sum = 0,
      w = 0;
    for (const d of list) {
      const v = f(d);
      if (v != null) {
        sum += v * d.measuredS;
        w += d.measuredS;
      }
    }
    return w ? sum / w : null;
  };
  const jit = wavg((d) => d.jitter);
  const bjit = wavg((d) => d.boxJitter);
  const loss = wavg((d) => d.reqLossPct);
  const spikes = list.reduce((a, d) => a + d.spikes, 0);
  const spikesH = spikes / Math.max(hours, 1);
  if (jit != null) {
    const facts = `gigue moyenne ${Math.round(jit)} ms, ${spikes} pic${spikes > 1 ? 's' : ''} de temps de réponse (${spikesH
      .toFixed(1)
      .replace('.', ',')} par heure), ${pct(loss, 2)} de requêtes perdues hors coupures`;
    const unstable = jit >= 30 || spikesH >= 20 || (loss ?? 0) >= 1;
    if (unstable) {
      out.push(`Connexion instable : ${facts}. De quoi faire saccader ou couper une vidéo sans que ce soit une vraie coupure.`);
      if (!isPc && bjit != null) {
        // La box est testée via sa page d'administration : si elle répond moins régulièrement qu'internet (qui passe pourtant
        // par elle), c'est sa page qui est lente, pas le Wi-Fi → on ne conclut rien de cette mesure.
        if (bjit > jit * 1.2)
          out.push(
            `La box répond moins régulièrement qu’internet (gigue box ${Math.round(bjit)} ms, internet ${Math.round(jit)} ms) : c’est la box qui tarde à répondre à l’appli, cette mesure ne permet pas d’accuser le Wi-Fi.`
          );
        else if (bjit >= 15 && bjit >= jit * 0.5)
          out.push(`L’instabilité existe déjà entre l’appareil et la box (gigue box ${Math.round(bjit)} ms) : c’est le Wi-Fi ou le répéteur qui est en cause.`);
        else if (bjit < 10)
          out.push(`La box, elle, répond de façon régulière (gigue box ${Math.round(bjit)} ms) : l’instabilité vient d’après la box, donc de la ligne / du réseau VOO.`);
      }
    } else out.push(`Connexion stable : ${facts}.`);
  }

  // Serveurs IPTV
  const bad: string[] = [];
  const good: string[] = [];
  for (const srv of [1, 2]) {
    const xs = list.map((d) => d.iptv[srv - 1]).filter(Boolean);
    const n = xs.reduce((a, x) => a + x.n, 0);
    if (!n) continue;
    const lost = xs.reduce((a, x) => a + x.lost, 0);
    const cutsN = xs.reduce((a, x) => a + x.cuts, 0);
    const down = xs.reduce((a, x) => a + x.downS, 0);
    const okN = xs.reduce((a, x) => a + (x.n - x.lost), 0);
    const lat = okN ? xs.reduce((a, x) => a + (x.avgLat ?? 0) * (x.n - x.lost), 0) / okN : null;
    const lossPct = (100 * lost) / n;
    const name = iptvName(s, srv);
    const Name = name[0].toUpperCase() + name.slice(1);
    if (cutsN || lossPct >= 2) {
      bad.push(name);
      out.push(
        `${Name} : ${cutsN} décrochage${cutsN > 1 ? 's' : ''} (${dur(down)} au total) et ${pct(lossPct)} de tests sans réponse, alors qu’internet marchait. Ces coupures-là viennent du fournisseur IPTV, pas de VOO.`
      );
    } else {
      good.push(name);
      out.push(`${Name} : il a toujours répondu (${pct(lossPct)} d’échecs, ${lat != null ? Math.round(lat) : '—'} ms en moyenne).`);
    }
  }
  if (bad.length && good.length) out.push(`Seul le ${bad[0]} décroche : si tes chaînes passent par lui, c’est lui qui coupe l’image.`);
  else if (!bad.length && good.length)
    out.push('Si l’image coupe quand même, le fournisseur IPTV n’y est pour rien : regarde plutôt le Wi-Fi du Chromecast.');

  // Wi-Fi de l'appareil (Android)
  const wN = list.filter((d) => d.rssiAvg != null);
  if (wN.length && !isPc) {
    const roams = list.reduce((a, d) => a + d.roams, 0);
    const lostW = list.reduce((a, d) => a + d.wifiLost, 0);
    const avg = Math.round(wN.reduce((a, d) => a + d.rssiAvg! * d.measuredS, 0) / Math.max(1, wN.reduce((a, d) => a + d.measuredS, 0)));
    const worst = Math.min(...wN.map((d) => d.rssiMin ?? 0));
    out.push(`Signal Wi-Fi de l’appareil : ${rssiWord(avg)} (moyenne ${avg} dBm, pire ${worst} dBm).`);
    if (roams)
      out.push(
        `L’appareil a changé ${roams} fois de point d’accès Wi-Fi (box ↔ répéteurs). Chaque bascule coupe la connexion quelques secondes, quelle que soit l’appli : c’est une cause classique de coupures sur un Chromecast. Remède : un nom de Wi-Fi différent pour le répéteur (le Chromecast reste sur un seul point d’accès), ou un adaptateur Ethernet.`
      );
    if (lostW) out.push(`Le Wi-Fi a été complètement perdu ${lostW} fois.`);
  }

  // Mémoire de l'appareil (Android)
  const memDays = list.filter((d) => d.memMin != null);
  if (memDays.length && !isPc) {
    const low = list.reduce((a, d) => a + d.memLowN, 0);
    const worst = Math.min(...memDays.map((d) => d.memMin!));
    if (low)
      out.push(
        `L’appareil a manqué de mémoire (au plus bas ${worst} Mo libres, ${dur(low * 5)} en « mémoire basse ») : les applis peuvent alors figer ou recharger sans aucun problème de réseau. Remède : vider le cache des applis, désinstaller celles qui ne servent pas, redémarrer le Chromecast de temps en temps.`
      );
    else out.push(`Mémoire de l’appareil : jamais saturée (au plus bas ${worst} Mo libres).`);
  }

  // Coupures signalées avec « Ça vient de couper »
  const marks = list.flatMap((d) => d.marks);
  if (marks.length) {
    let net = 0,
      wifi = 0,
      iptv = 0,
      unstable = 0,
      nothing = 0,
      memLow = 0;
    for (const m of marks) {
      const c = markCauses(m);
      if (!c.length) nothing++;
      if (m.downS > 0) net++;
      if (m.wifiLost || m.roam || (m.rssiMin != null && m.rssiMin <= -75)) wifi++;
      if (m.iptvFails.some((f) => f > 0)) iptv++;
      if ((m.jitter ?? 0) >= 30 || m.spikes >= 3 || (m.lost > 0 && !m.downS)) unstable++;
      if (memIsLow(m.memMinMb, m.memTotalMb, m.memLow)) memLow++;
    }
    const parts = [
      net && `${net} pendant une coupure d’internet`,
      wifi && `${wifi} avec un problème de Wi-Fi (bascule, perte ou signal faible)`,
      iptv && `${iptv} avec le serveur IPTV sans réponse`,
      unstable && `${unstable} avec une connexion instable (gigue, pics, pertes)`,
      memLow && `${memLow} avec la mémoire de l’appareil saturée`,
      nothing && `${nothing} sans rien d’anormal mesuré`,
    ].filter(Boolean);
    out.push(`Coupures que tu as signalées : ${marks.length}. ${parts.join(' ; ')}.`);
    if (nothing && nothing === marks.length)
      out.push(
        'À aucune de ces coupures la connexion n’allait mal : le problème vient plutôt de l’appareil lui-même (Chromecast surchargé, appli) ou du flux vidéo chez le fournisseur.'
      );
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
