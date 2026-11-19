// Écran « Direct » : état de la connexion à la seconde près.
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { C, cutSeconds, dur, fmtMbps, hhmm, markCauses, pct, rssiWord, summarize } from '../analysis';
import { engine, SLOW_MS, type EngineState, type Sample } from '../engine';
import { IS_TV, IS_WEB } from '../net';
import { Btn, Card, H, T } from '../ui';

export function useEngine() {
  const [st, setSt] = useState<EngineState | null>(null);
  useEffect(() => engine.subscribe(setSt), []);
  return st;
}

const ms = (v: number | null | undefined) => (v === undefined ? 'non mesurée' : v === null ? 'ne répond pas' : `${v} ms`);
const msColor = (v: number | null | undefined) =>
  v === undefined ? C.muted : v === null ? C.down : v > SLOW_MS ? C.slow : C.ok;

export function LiveScreen() {
  const st = useEngine();
  if (!st || !st.settings) return null;
  const s = st.last;
  const sum = st.day ? summarize(st.day, st.settings) : null;
  const state = !st.running ? 'off' : st.testing ? 'test' : s?.state ?? 'wait';
  const big = {
    off: { color: C.muted, text: 'Surveillance arrêtée' },
    wait: { color: C.muted, text: 'Démarrage…' },
    ok: { color: C.ok, text: 'Connexion OK' },
    slow: { color: C.slow, text: 'Connexion lente' },
    down: {
      color: C.down,
      text: s?.box === null ? 'Coupure : la box ne répond pas (Wi-Fi / box)' : s?.box ? 'Coupure : box OK, internet coupé (VOO)' : 'Coupure d’internet',
    },
    test: { color: C.accent, text: `Test de débit : ${st.testing}` },
  }[state];
  const sp = st.lastSpeed;
  const set = st.settings;
  const two = st.iptv.length > 1;
  const label = (srv: number) => `📺 Serveur IPTV${two ? ` ${srv}` : ''}`;

  return (
    <ScrollView contentContainerStyle={{ padding: 14 }}>
      <Card style={{ borderColor: big.color, borderWidth: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={[styles.dot, { backgroundColor: big.color }]} />
          <Text style={[styles.big, { color: big.color }]}>{big.text}</Text>
        </View>
        {st.openCut && (
          <T style={{ color: C.down, marginTop: 6 }}>Coupure en cours depuis {hhmm(st.openCut.start)} ({dur(cutSeconds(st.openCut))})</T>
        )}
        <View style={{ marginTop: 10, gap: 4 }}>
          <Row label={`🏠 Box${st.boxIp ? ` (${st.boxIp})` : ''}`} value={IS_WEB ? 'non mesurée sur PC' : ms(s?.box)} color={msColor(s?.box)} />
          <Row label="🌐 Cloudflare" value={ms(s?.cf)} color={msColor(s?.cf)} />
          <Row label="🌐 Google" value={ms(s?.g)} color={msColor(s?.g)} />
          {st.wifi && (
            <Row
              label={`📶 Wi-Fi${st.wifi.ap !== '?' ? ` · point d’accès ${st.wifi.ap}` : ''}`}
              value={`${st.wifi.rssi} dBm · ${st.wifi.link} Mb/s · ${st.wifi.band}`}
              color={st.wifi.rssi >= -60 ? C.ok : st.wifi.rssi >= -70 ? C.slow : C.down}
            />
          )}
          {st.iptv.map((v) => {
            const last = v.recent[v.recent.length - 1];
            return (
              <Row
                key={v.srv}
                label={label(v.srv)}
                value={v.blocked ? 'bloqué par le navigateur' : !st.running || !last ? '—' : ms(last.ms)}
                color={v.blocked || !last ? C.muted : msColor(last.ms)}
              />
            );
          })}
        </View>
        {st.wifi && st.wifi.ap === '?' && (
          <T muted style={{ marginTop: 6 }}>
            Pour voir à quel point d’accès (box ou répéteur) l’appareil est accroché, autorise la position pour NetCheck et active la localisation
            {IS_TV ? ' (Paramètres → Confidentialité → Localisation)' : ''}.
          </T>
        )}
        {st.iptv.some((v) => v.blocked) && (
          <T muted style={{ marginTop: 6 }}>
            Un serveur IPTV ne répond jamais depuis le PC : le navigateur bloque sans doute les serveurs en http. Dans Chrome : cadenas à gauche de
            l’adresse → Paramètres du site → Contenu non sécurisé → Autoriser, puis recharge la page.
          </T>
        )}
        {st.iptv.map((v) =>
          v.openCut ? (
            <T key={v.srv} style={{ color: C.down, marginTop: 6 }}>
              Le {v.name} ne répond plus depuis {hhmm(v.openCut.start)} alors qu’internet marche (fournisseur IPTV)
            </T>
          ) : null
        )}
        <Spark samples={st.recent} />
        <T muted>Les 2 dernières minutes, une barre par seconde (hauteur = temps de réponse).</T>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {st.running && <Btn label="⚠️ Ça vient de couper" kind="primary" onPress={() => engine.mark()} />}
          {!st.settings.alertsOn && !!st.settings.ntfyTopic && (
            <Btn label="📺 Ça coupe sur la télé" kind="primary" onPress={() => engine.remoteMark()} />
          )}
          {st.running ? (
            <Btn label="⏹ Arrêter la surveillance" kind="danger" onPress={() => engine.stop()} />
          ) : (
            <Btn label="▶ Démarrer la surveillance" kind="primary" onPress={() => engine.start()} />
          )}
          <Btn label="⚡ Tester le débit" disabled={!!st.testing} onPress={() => engine.runSpeedTest()} />
        </View>
        {!st.settings.alertsOn && !!st.settings.ntfyTopic && st.remote.lastMarkSentAt && (
          <T style={{ marginTop: 8 }}>
            📺 Envoyé au Chromecast à {hhmm(st.remote.lastMarkSentAt)} : il l’enregistre avec ses mesures dans les 10 s, et le résultat arrive en
            notification ntfy.
          </T>
        )}
        {st.settings.alertsOn && !!st.settings.ntfyTopic && (
          <T muted style={{ marginTop: 8 }}>
            🔔 Alertes envoyées sur le canal ntfy « {st.settings.ntfyTopic} »
            {st.remote.lastSentAt ? ` · dernière à ${hhmm(st.remote.lastSentAt)}` : ''}.
          </T>
        )}
        {!!st.settings.ntfyTopic && st.remote.lastError && (
          <T style={{ color: C.down, marginTop: 6 }}>Liaison ntfy : {st.remote.lastError} (nouvel essai dans 1 min).</T>
        )}
        {st.running && !st.lastMark && (
          <T muted style={{ marginTop: 8 }}>
            Quand l’image coupe, appuie sur « ⚠️ Ça vient de couper » : l’appli garde ce qu’elle mesurait juste avant.
          </T>
        )}
        {st.lastMark && (
          <T style={{ marginTop: 8 }}>
            Coupure signalée à {hhmm(st.lastMark.at)} :{' '}
            {markCauses(st.lastMark).join(', ') || 'rien d’anormal mesuré dans les 2 min d’avant (ni internet, ni Wi-Fi, ni serveur IPTV)'}.
          </T>
        )}
        {IS_TV && (
          <T muted style={{ marginTop: 8 }}>
            Sur le Chromecast, la surveillance tourne toute seule en arrière-plan : tu peux retourner à ta chaîne. Pas de test de débit automatique ici
            (il saturerait la ligne et couperait l’image).
          </T>
        )}
        {IS_WEB && st.running && (
          <T muted style={{ marginTop: 8 }}>
            Laisse cet onglet ouvert (il peut être en arrière-plan) et empêche la mise en veille du PC.
          </T>
        )}
      </Card>

      {st.running && <Stability st={st} />}

      <Card>
        <H>Aujourd’hui</H>
        {sum && sum.measuredS > 0 ? (
          <>
            <T>
              {sum.cuts} coupure{sum.cuts > 1 ? 's' : ''} ({sum.micro} micro &lt; 10 s · {sum.long} longue{sum.long > 1 ? 's' : ''})
              {sum.cuts ? ` · plus longue ${dur(sum.longest)}` : ''}
            </T>
            {sum.cuts > 0 && !IS_WEB && (
              <T muted>
                Côté Wi-Fi / box : {sum.boxCuts} · côté VOO : {sum.lineCuts}
                {sum.unknownCuts ? ` · ? ${sum.unknownCuts}` : ''}
              </T>
            )}
            <T muted>
              Disponibilité {sum.uptime!.toFixed(2).replace('.', ',')} % sur {dur(sum.measuredS)} mesurées · {sum.losses} perte
              {sum.losses > 1 ? 's' : ''} d’1 s · temps de réponse moyen {sum.avgLat ?? '—'} ms
            </T>
            {sum.jitter != null && (
              <T muted>
                Gigue moyenne {sum.jitter} ms{!IS_WEB && sum.boxJitter != null ? ` (box ${sum.boxJitter} ms)` : ''} · {sum.spikes} pic
                {sum.spikes > 1 ? 's' : ''} · {pct(sum.reqLossPct, 2)} de requêtes perdues
              </T>
            )}
            {sum.iptv
              .filter((x) => x.n > 0)
              .map((x) => (
                <T muted key={x.srv}>
                  {label(x.srv)} : {x.cuts} décrochage{x.cuts > 1 ? 's' : ''}
                  {x.cuts ? ` (plus long ${dur(x.longest)})` : ''} · {pct(x.lossPct)} sans réponse · {x.avgLat ?? '—'} ms
                </T>
              ))}
          </>
        ) : (
          <T muted>Pas encore de mesure aujourd’hui.</T>
        )}
      </Card>

      <Card>
        <H>Dernier test de débit</H>
        {sp ? (
          <>
            <T muted>
              {hhmm(sp.at)} · {sp.net === 'wifi' ? 'Wi-Fi' : sp.net === 'cellular' ? '4G/5G' : sp.net === 'pc' ? 'PC' : sp.net ?? ''}
            </T>
            {sp.error ? (
              <T style={{ color: C.down }}>Échec : {sp.error}</T>
            ) : (
              <View style={{ flexDirection: 'row', gap: 18, marginTop: 6, flexWrap: 'wrap' }}>
                <Speed label="⬇ Descendant" v={sp.down} min={set.downMin} normal={set.downNormal} />
                <Speed label="⬆ Montant" v={sp.up} min={set.upMin} normal={set.upNormal} />
                <View>
                  <T muted>Ping</T>
                  <Text style={styles.speed}>{sp.ping ?? '—'} ms</Text>
                </View>
              </View>
            )}
          </>
        ) : (
          <T muted>Aucun test pour l’instant.</T>
        )}
        {st.nextSpeedAt && !st.testing ? <T muted style={{ marginTop: 6 }}>Prochain test automatique vers {hhmm(st.nextSpeedAt)}.</T> : null}
        {!set.downMin && <T muted style={{ marginTop: 6 }}>Entre les vitesses de ton contrat VOO dans Réglages pour les comparer.</T>}
      </Card>
    </ScrollView>
  );
}

/** Stabilité sur les 2 dernières minutes : gigue, pics, pertes, IPTV */
function Stability({ st }: { st: EngineState }) {
  const xs = st.recent.filter((x) => x.state !== 'test');
  const jit = (vals: (number | null | undefined)[]) => {
    let sum = 0,
      n = 0;
    for (let i = 1; i < vals.length; i++) {
      const a = vals[i - 1],
        b = vals[i];
      if (typeof a === 'number' && typeof b === 'number') {
        sum += Math.abs(b - a);
        n++;
      }
    }
    return n ? Math.round(sum / n) : null;
  };
  const bestOf = (x: Sample) => (x.cf == null ? x.g : x.g == null ? x.cf : Math.min(x.cf, x.g));
  const j = jit(xs.map(bestOf));
  const bj = IS_WEB ? null : jit(xs.map((x) => x.box));
  const spikes = xs.filter((x) => x.spike).length;
  const up = xs.filter((x) => x.state !== 'down');
  const req = up.length * 2;
  const lost = up.reduce((a, x) => a + (x.cf == null ? 1 : 0) + (x.g == null ? 1 : 0), 0);
  const lossPct = req ? (100 * lost) / req : null;
  const level = (v: number | null, warn: number, bad: number) => (v == null ? C.muted : v >= bad ? C.down : v >= warn ? C.slow : C.ok);
  return (
    <Card>
      <H>Stabilité (2 dernières min)</H>
      <View style={{ gap: 4 }}>
        <Row label="Gigue internet" value={j == null ? '—' : `${j} ms`} color={level(j, 15, 30)} />
        {!IS_WEB && (
          <Row
            label="Gigue jusqu’à la box (Wi-Fi)"
            value={bj == null ? '—' : `${bj} ms`}
            color={bj != null && j != null && bj > j * 1.2 ? C.muted : level(bj, 10, 20)}
          />
        )}
        <Row label="Pics de temps de réponse" value={String(spikes)} color={level(spikes, 2, 6)} />
        <Row label="Requêtes perdues" value={pct(lossPct)} color={level(lossPct, 0.5, 2)} />
        {st.wifiRecent.length > 0 && (
          <>
            <Row
              label="📶 Pire signal Wi-Fi"
              value={(() => {
                const r = Math.min(...st.wifiRecent.map((w) => w.rssi));
                return `${r} dBm (${rssiWord(r)})`;
              })()}
              color={(() => {
                const r = Math.min(...st.wifiRecent.map((w) => w.rssi));
                return r >= -60 ? C.ok : r >= -70 ? C.slow : C.down;
              })()}
            />
            <Row label="📶 Changements de point d’accès" value={String(st.wifiRoamsRecent)} color={st.wifiRoamsRecent ? C.down : C.ok} />
          </>
        )}
        {st.iptv
          .filter((v) => !v.blocked)
          .map((v) => {
            const lostN = v.recent.filter((x) => x.ms == null).length;
            return (
              <Row
                key={v.srv}
                label={`📺 IPTV${st.iptv.length > 1 ? ` ${v.srv}` : ''} sans réponse`}
                value={v.recent.length ? `${lostN} / ${v.recent.length}` : '—'}
                color={level(v.recent.length ? lostN : null, 1, 2)}
              />
            );
          })}
      </View>
      {!IS_WEB && bj != null && j != null && bj > j * 1.2 && (
        <T muted style={{ marginTop: 6 }}>
          La box répond moins régulièrement qu’internet, qui passe pourtant par elle : c’est la box qui est lente à répondre à l’appli, pas le
          Wi-Fi. Cette ligne ne compte pas.
        </T>
      )}
      <T muted style={{ marginTop: 6 }}>
        La gigue, c’est l’irrégularité du temps de réponse d’une seconde à l’autre. Au-delà de ~30 ms, une vidéo en direct peut saccader ou couper
        sans que la connexion soit vraiment tombée.
      </T>
    </Card>
  );
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <T>{label}</T>
      <Text style={{ color, fontWeight: '700', fontSize: 15 }}>{value}</Text>
    </View>
  );
}

function Speed({ label, v, min, normal }: { label: string; v: number | null; min: number; normal: number }) {
  const color = v == null ? C.muted : min && v < min ? C.down : normal && v < normal ? C.slow : C.ok;
  return (
    <View>
      <T muted>{label}</T>
      <Text style={[styles.speed, { color }]}>{fmtMbps(v)}</Text>
      {min ? <T muted>min. contrat {min} · normal {normal || '—'}</T> : null}
    </View>
  );
}

function Spark({ samples }: { samples: Sample[] }) {
  const pad = Array.from({ length: Math.max(0, 120 - samples.length) });
  return (
    <View style={styles.spark}>
      {pad.map((_, i) => (
        <View key={'p' + i} style={styles.sparkBar} />
      ))}
      {samples.map((s) => {
        const best = s.cf == null ? s.g : s.g == null ? s.cf : Math.min(s.cf, s.g);
        const h = s.state === 'down' ? 100 : best == null ? 0 : Math.min(100, 8 + (best / 600) * 92);
        const color =
          s.state === 'down' ? (s.box === null ? C.box : C.down) : s.state === 'slow' || s.spike ? C.slow : s.state === 'test' ? C.accent : C.ok;
        return <View key={s.at} style={[styles.sparkBar, { height: `${h}%`, backgroundColor: color }]} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  dot: { width: 16, height: 16, borderRadius: 8 },
  big: { fontSize: 20, fontWeight: '800', flexShrink: 1 },
  speed: { color: C.text, fontSize: 22, fontWeight: '800' },
  spark: { flexDirection: 'row', alignItems: 'flex-end', height: 56, marginTop: 12, marginBottom: 4, gap: 1 },
  sparkBar: { flex: 1, height: 2, backgroundColor: C.none },
});
