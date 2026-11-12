// Écran « Direct » : état de la connexion à la seconde près.
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { C, cutSeconds, dur, fmtMbps, hhmm, summarize } from '../analysis';
import { engine, SLOW_MS, type EngineState, type Sample } from '../engine';
import { IS_WEB } from '../net';
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
        </View>
        <Spark samples={st.recent} />
        <T muted>Les 2 dernières minutes, une barre par seconde (hauteur = temps de réponse).</T>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {st.running ? (
            <Btn label="⏹ Arrêter la surveillance" kind="danger" onPress={() => engine.stop()} />
          ) : (
            <Btn label="▶ Démarrer la surveillance" kind="primary" onPress={() => engine.start()} />
          )}
          <Btn label="⚡ Tester le débit" disabled={!!st.testing} onPress={() => engine.runSpeedTest()} />
        </View>
        {IS_WEB && st.running && (
          <T muted style={{ marginTop: 8 }}>
            Laisse cet onglet ouvert (il peut être en arrière-plan) et empêche la mise en veille du PC.
          </T>
        )}
      </Card>

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
        const color = s.state === 'down' ? (s.box === null ? C.box : C.down) : s.state === 'slow' ? C.slow : s.state === 'test' ? C.accent : C.ok;
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
