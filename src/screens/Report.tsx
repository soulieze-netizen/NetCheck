// Écran « Rapport » : bilan sur plusieurs jours + export PDF (à envoyer à VOO).
import React, { useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { C, cutSeconds, dayLabel, dur, fmtMbps, hhmm, hhmmss, summarize, verdict, type DaySummary } from '../analysis';
import { IS_WEB } from '../net';
import { listDays, loadDay, type Day, type Settings } from '../storage';
import { Btn, Card, H, T } from '../ui';
import { useEngine } from './Live';

const RANGES = [
  { n: 1, label: 'Aujourd’hui' },
  { n: 7, label: '7 jours' },
  { n: 30, label: '30 jours' },
];

export function ReportScreen() {
  const st = useEngine();
  const [n, setN] = useState(7);
  const [days, setDays] = useState<Day[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    listDays().then(async (keys) => setDays(await Promise.all(keys.slice(0, n).map(loadDay))));
  }, [n, st?.day?.cuts.length, st?.day?.speeds.length]);
  if (!st) return null;
  const set = st.settings;
  const sums = days.map((d) => summarize(d, set)).filter((s) => s.measuredS > 0);
  const lines = verdict(sums, set, IS_WEB);

  const exportPdf = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const html = reportHtml(days, sums, lines, set);
      if (IS_WEB) {
        printWeb(html);
      } else {
        const Print = require('expo-print') as typeof import('expo-print');
        const Sharing = require('expo-sharing') as typeof import('expo-sharing');
        const { uri } = await Print.printToFileAsync({ html });
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Rapport NetCheck', UTI: 'com.adobe.pdf' });
      }
    } catch (e: any) {
      setMsg(`Export impossible : ${e?.message ?? e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 14 }}>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {RANGES.map((r) => (
          <Btn key={r.n} label={r.label} kind={r.n === n ? 'primary' : 'default'} onPress={() => setN(r.n)} />
        ))}
      </View>

      <Card>
        <H>Verdict</H>
        {lines.map((l, i) => (
          <T key={i} style={{ marginBottom: 6 }}>
            • {l}
          </T>
        ))}
        <View style={{ flexDirection: 'row', marginTop: 8 }}>
          <Btn label={IS_WEB ? '📄 Imprimer / PDF' : '📄 Exporter en PDF'} disabled={busy || !sums.length} onPress={exportPdf} />
        </View>
        {msg && <T style={{ color: C.down, marginTop: 6 }}>{msg}</T>}
        {IS_WEB && <T muted style={{ marginTop: 6 }}>Dans la fenêtre d’impression, choisis « Enregistrer au format PDF ».</T>}
      </Card>

      <Card>
        <H>Jour par jour</H>
        <View style={[styles.tr, styles.th]}>
          <Text style={[styles.td, { flex: 2 }]}>Jour</Text>
          <Text style={styles.td}>Coupures</Text>
          <Text style={styles.td}>Sans net</Text>
          <Text style={styles.td}>⬇ moy.</Text>
          <Text style={styles.td}>⬇ soir</Text>
        </View>
        {sums.map((s) => (
          <View key={s.date} style={styles.tr}>
            <Text style={[styles.td, { flex: 2, textTransform: 'capitalize' }]} numberOfLines={1}>
              {dayLabel(s.date)}
            </Text>
            <Text style={[styles.td, s.cuts ? { color: C.down } : null]}>{s.cuts}</Text>
            <Text style={styles.td}>{dur(s.downS)}</Text>
            <Text style={[styles.td, under(s.avgDown, set) && { color: C.down }]}>{fmtMbps(s.avgDown)}</Text>
            <Text style={[styles.td, under(s.eveningDown, set) && { color: C.down }]}>{fmtMbps(s.eveningDown)}</Text>
          </View>
        ))}
        {!sums.length && <T muted>Pas encore de mesures.</T>}
      </Card>
    </ScrollView>
  );
}

const under = (v: number | null, s: Settings) => v != null && !!s.downMin && v < s.downMin;

function printWeb(html: string) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow!.document;
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    setTimeout(() => iframe.remove(), 2000);
  }, 300);
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** Rapport imprimable (PDF) */
function reportHtml(days: Day[], sums: DaySummary[], lines: string[], s: Settings) {
  const device = s.deviceLabel || (IS_WEB ? 'PC' : Platform.OS === 'android' ? 'Téléphone Android (Wi-Fi)' : 'Appareil');
  const contract = s.downMin
    ? `Contrat : descendant min. ${s.downMin} / normal ${s.downNormal || '—'} / max. ${s.downMax || '—'} Mb/s · montant min. ${s.upMin || '—'} / normal ${
        s.upNormal || '—'
      } / max. ${s.upMax || '—'} Mb/s`
    : 'Vitesses du contrat non renseignées';
  const rows = sums
    .map(
      (d) => `<tr><td>${esc(dayLabel(d.date))}</td><td>${dur(d.measuredS)}</td><td>${d.cuts} (${d.micro} &lt;10 s)</td><td>${dur(
        d.downS
      )}</td><td>${d.uptime != null ? d.uptime.toFixed(2) : '—'} %</td><td>${d.avgLat ?? '—'} ms</td><td>${fmtMbps(d.avgDown)}</td><td>${fmtMbps(
        d.minDown
      )}</td><td>${d.underMin}/${d.speeds.filter((x) => x.down != null).length}</td></tr>`
    )
    .join('');
  const detail = days
    .filter((d) => d.cuts.length || d.speeds.length)
    .map((d) => {
      const cuts = d.cuts
        .slice(-200)
        .map((c) => `<tr><td>${hhmmss(c.start)}</td><td>${dur(cutSeconds(c))}</td><td>${c.where === 'box' ? 'Wi-Fi / box' : c.where === 'internet' ? 'ligne VOO (box joignable)' : 'internet (box non testée)'}</td></tr>`)
        .join('');
      const sp = d.speeds
        .map((t) => `<tr><td>${hhmm(t.at)}</td><td>${fmtMbps(t.down)}</td><td>${fmtMbps(t.up)}</td><td>${t.ping ?? '—'} ms</td><td>${t.error ? esc(t.error) : ''}</td></tr>`)
        .join('');
      return `<h3>${esc(dayLabel(d.date))}</h3>
      ${cuts ? `<table><tr><th>Début</th><th>Durée</th><th>Où</th></tr>${cuts}</table>` : '<p>Aucune coupure.</p>'}
      ${sp ? `<table><tr><th>Heure</th><th>Descendant</th><th>Montant</th><th>Ping</th><th></th></tr>${sp}</table>` : ''}`;
    })
    .join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Rapport NetCheck</title>
  <style>body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:24px}h1{font-size:20px}h2{font-size:15px;margin-top:18px}h3{font-size:13px;margin:14px 0 4px;text-transform:capitalize}
  table{border-collapse:collapse;width:100%;margin-bottom:8px}td,th{border:1px solid #bbb;padding:3px 5px;text-align:left}th{background:#eee}li{margin-bottom:4px}</style></head><body>
  <h1>Rapport de connexion internet — NetCheck</h1>
  <p>Opérateur : VOO · Appareil de mesure : ${esc(device)} · Édité le ${new Date().toLocaleString('fr-FR')}</p>
  <p>${esc(contract)}</p>
  <p>Méthode : contrôle chaque seconde de la box et de deux serveurs internet (Cloudflare 1.1.1.1, Google) ; coupure = au moins 2 s sans réponse d’internet.
  Test de débit (Cloudflare) toutes les ${s.speedEvery || '—'} min.</p>
  <h2>Bilan</h2><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
  <h2>Jour par jour</h2>
  <table><tr><th>Jour</th><th>Mesuré</th><th>Coupures</th><th>Sans internet</th><th>Disponibilité</th><th>Réponse moy.</th><th>⬇ moyen</th><th>⬇ minimum</th><th>Tests sous le min.</th></tr>${rows}</table>
  <h2>Détail</h2>${detail}
  </body></html>`;
}

const styles = StyleSheet.create({
  tr: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.border, gap: 4 },
  th: { borderBottomColor: C.muted },
  td: { flex: 1, color: C.text, fontSize: 13 },
});
