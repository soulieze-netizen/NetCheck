// Écran « Journée » : frise minute par minute, coupures et tests de débit d'un jour.
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { C, cutSeconds, dayLabel, dur, fmtMbps, hhmm, hhmmss, minuteColor, summarize } from '../analysis';
import { IS_WEB } from '../net';
import { dayKey, listDays, loadDay, type Day } from '../storage';
import { Btn, Card, H, T } from '../ui';
import { useEngine } from './Live';

export function DayScreen() {
  const st = useEngine();
  const [days, setDays] = useState<string[]>([]);
  const [sel, setSel] = useState(dayKey());
  const [day, setDay] = useState<Day | null>(null);
  const today = dayKey();
  useEffect(() => {
    listDays().then((d) => setDays(d.includes(today) ? d : [today, ...d]));
  }, [today]);
  // Aujourd'hui : données en direct ; autres jours : lues une fois
  useEffect(() => {
    if (sel === st?.day?.date) setDay(st.day);
  }, [sel, st?.day, st?.last]);
  useEffect(() => {
    if (sel !== st?.day?.date) loadDay(sel).then(setDay);
  }, [sel]);

  const i = days.indexOf(sel);
  const sum = useMemo(() => (day && st ? summarize(day, st.settings) : null), [day, st?.last, st?.settings]);
  if (!st || !day || !sum) return null;
  const set = st.settings;

  return (
    <ScrollView contentContainerStyle={{ padding: 14 }}>
      <View style={styles.nav}>
        <Btn label="◀" disabled={i < 0 || i >= days.length - 1} onPress={() => setSel(days[i + 1])} />
        <Text style={styles.date}>{dayLabel(sel)}</Text>
        <Btn label="▶" disabled={i <= 0} onPress={() => setSel(days[i - 1])} />
      </View>

      <Card>
        <H>Frise de la journée</H>
        <T muted>Une case = une minute. Chaque ligne = une heure.</T>
        <View style={{ marginTop: 8 }}>
          {Array.from({ length: 24 }, (_, h) => (
            <View key={h} style={styles.hourRow}>
              <Text style={styles.hourLabel}>{String(h).padStart(2, '0')}h</Text>
              <View style={styles.cells}>
                {day.minutes.slice(h * 60, h * 60 + 60).map((m, k) => (
                  <View key={k} style={[styles.cell, { backgroundColor: minuteColor(m) }]} />
                ))}
              </View>
            </View>
          ))}
        </View>
        <View style={styles.legend}>
          <Legend color={C.ok} text="OK" />
          <Legend color={C.slow} text="lente" />
          <Legend color={C.loss} text="perte d’1 s" />
          <Legend color={C.down} text={IS_WEB ? 'coupure' : 'coupure (VOO)'} />
          {!IS_WEB && <Legend color={C.box} text="coupure (Wi-Fi / box)" />}
          <Legend color={C.none} text="pas mesuré" />
        </View>
      </Card>

      <Card>
        <H>Bilan</H>
        {sum.measuredS ? (
          <>
            <T>
              {sum.cuts} coupure{sum.cuts > 1 ? 's' : ''} · {dur(sum.downS)} sans internet · disponibilité{' '}
              {sum.uptime!.toFixed(2).replace('.', ',')} %
            </T>
            <T muted>
              {dur(sum.measuredS)} mesurées · {sum.losses} perte{sum.losses > 1 ? 's' : ''} d’1 s · {sum.slowMin} min lentes · réponse moyenne{' '}
              {sum.avgLat ?? '—'} ms
            </T>
          </>
        ) : (
          <T muted>Aucune mesure ce jour-là.</T>
        )}
      </Card>

      <Card>
        <H>Coupures ({day.cuts.length})</H>
        {day.cuts.length === 0 && <T muted>Aucune.</T>}
        {[...day.cuts].reverse().map((c) => (
          <View key={c.start} style={styles.line}>
            <Text style={styles.time}>{hhmmss(c.start)}</Text>
            <T style={{ flex: 1 }}>{dur(cutSeconds(c))}</T>
            <Text style={{ color: c.where === 'box' ? C.box : c.where === 'internet' ? C.down : C.muted, fontWeight: '700' }}>
              {c.where === 'box' ? 'Wi-Fi / box' : c.where === 'internet' ? 'VOO' : 'internet'}
            </Text>
          </View>
        ))}
      </Card>

      <Card>
        <H>Tests de débit ({day.speeds.length})</H>
        {day.speeds.length === 0 && <T muted>Aucun.</T>}
        {[...day.speeds].reverse().map((t) => {
          const color = t.down == null ? C.muted : set.downMin && t.down < set.downMin ? C.down : set.downNormal && t.down < set.downNormal ? C.slow : C.ok;
          const max = Math.max(set.downMax || 0, ...day.speeds.map((x) => x.down ?? 0), 1);
          return (
            <View key={t.at} style={styles.line}>
              <Text style={styles.time}>{hhmm(t.at)}</Text>
              <View style={{ flex: 1 }}>
                <View style={styles.barBg}>
                  <View style={[styles.bar, { width: `${Math.min(100, ((t.down ?? 0) / max) * 100)}%`, backgroundColor: color }]} />
                  {set.downMin ? <View style={[styles.minMark, { left: `${Math.min(100, (set.downMin / max) * 100)}%` }]} /> : null}
                </View>
                <T muted>
                  {t.error ? `échec : ${t.error}` : `⬇ ${fmtMbps(t.down)} · ⬆ ${fmtMbps(t.up)} · ${t.ping ?? '—'} ms`}
                  {t.net ? ` · ${t.net === 'wifi' ? 'Wi-Fi' : t.net === 'pc' ? 'PC' : t.net}` : ''}
                </T>
              </View>
            </View>
          );
        })}
        {set.downMin ? <T muted>Trait blanc = vitesse minimale du contrat ({set.downMin} Mb/s).</T> : null}
      </Card>
    </ScrollView>
  );
}

function Legend({ color, text }: { color: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <View style={{ width: 10, height: 10, backgroundColor: color, borderRadius: 2 }} />
      <Text style={{ color: C.muted, fontSize: 12 }}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  date: { flex: 1, color: C.text, fontSize: 17, fontWeight: '800', textAlign: 'center', textTransform: 'capitalize' },
  hourRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 2 },
  hourLabel: { color: C.muted, fontSize: 10, width: 26 },
  cells: { flex: 1, flexDirection: 'row', height: 10, gap: 1 },
  cell: { flex: 1, borderRadius: 1 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 10 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  time: { color: C.text, fontWeight: '700', width: 72 },
  barBg: { height: 12, backgroundColor: C.none, borderRadius: 6, overflow: 'hidden', marginBottom: 3 },
  bar: { height: 12, borderRadius: 6 },
  minMark: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: '#fff' },
});
