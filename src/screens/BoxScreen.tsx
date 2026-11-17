// Écran « Box » : diagnostic du Wi-Fi et de la box, fait par le téléphone depuis la maison.
// Le rapport se partage (WhatsApp, Claude…) pour être analysé. Rien n'est modifié dans la box.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { C } from '../analysis';
import { reportText, runDiagnostic, signalWord, type Diagnostic } from '../diagnostic';
import { IS_WEB } from '../net';
import { Btn, Card, H, T } from '../ui';

const LAST_KEY = 'lastDiagnostic';
const COLOR = { ok: C.ok, warn: C.slow, bad: C.down };
const ICON = { ok: '✅', warn: '⚠️', bad: '❌' };

export function BoxScreen() {
  const [d, setD] = useState<Diagnostic | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(LAST_KEY)
      .then((raw) => raw && setD(JSON.parse(raw)))
      .catch(() => {});
  }, []);

  if (IS_WEB) {
    return (
      <ScrollView contentContainerStyle={styles.pad}>
        <Card>
          <H>Diagnostic de la box</H>
          <T muted>Disponible seulement sur le téléphone Android : un navigateur ne peut pas lire la box ni les Wi-Fi voisins.</T>
        </Card>
      </ScrollView>
    );
  }

  const run = async () => {
    setErr(null);
    setStep('Démarrage…');
    try {
      const res = await runDiagnostic(setStep);
      setD(res);
      AsyncStorage.setItem(LAST_KEY, JSON.stringify(res)).catch(() => {});
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setStep(null);
    }
  };

  const share = () => {
    if (d) Share.share({ title: 'Diagnostic NetCheck', message: reportText(d) }).catch(() => {});
  };

  return (
    <ScrollView contentContainerStyle={styles.pad}>
      <Card>
        <H>Diagnostic de la box</H>
        <T muted>
          Lance-le depuis la maison, téléphone en Wi-Fi, à l’endroit où ça coupe. Environ 30 secondes. L’appli regarde seulement : elle ne change rien dans la box.
        </T>
        <T muted style={{ marginTop: 6 }}>
          Android va demander l’autorisation « Position » : c’est obligatoire pour voir les Wi-Fi des voisins. L’appli ne te localise pas.
        </T>
        <View style={{ height: 10 }} />
        <Btn label={step ? step : d ? '🔄 Relancer le diagnostic' : '🩺 Lancer le diagnostic'} kind="primary" onPress={run} disabled={!!step} />
        {err && <T style={{ color: C.down, marginTop: 8 }}>{err}</T>}
      </Card>

      {d && !step && (
        <>
          <Card>
            <View style={styles.row}>
              <H>Résultat</H>
              <Text style={styles.date}>
                {new Date(d.at).toLocaleDateString('fr-FR')} {new Date(d.at).toLocaleTimeString('fr-FR').slice(0, 5)}
              </Text>
            </View>
            {d.findings.map((f, i) => (
              <View key={i} style={styles.finding}>
                <Text style={{ fontSize: 15 }}>{ICON[f.level]}</Text>
                <Text style={[styles.findText, { color: f.level === 'ok' ? C.text : COLOR[f.level] }]}>{f.text}</Text>
              </View>
            ))}
            <View style={{ height: 8 }} />
            <Btn label="📤 Partager le rapport" onPress={share} />
          </Card>

          {d.wifi && (
            <Card>
              <H>Ton Wi-Fi ici</H>
              <T>
                {d.wifi.ssid ?? '(nom masqué)'} · {d.wifi.band} · canal {d.wifi.channel}
              </T>
              <T muted>
                Signal {d.wifi.rssi} dBm ({signalWord(d.wifi.rssi)}) · liaison {d.wifi.linkSpeed} Mb/s
              </T>
            </Card>
          )}

          <Card>
            <H>Wi-Fi visibles</H>
            {!d.scan.done ? (
              <T muted>Scan impossible : {d.scan.reason}</T>
            ) : (
              d.scan.neighbors.slice(0, 30).map((n) => (
                <View key={n.bssid} style={styles.net}>
                  <Text style={[styles.netName, n.mine && { color: C.ok }]} numberOfLines={1}>
                    {n.mine ? '★ ' : ''}
                    {n.ssid || '(caché)'}
                  </Text>
                  <Text style={[styles.netInfo, n.overlaps && !n.mine && { color: C.slow }]}>
                    {n.band === '2,4 GHz' ? '2,4' : n.band === '5 GHz' ? '5' : '6'} · c.{n.channel} · {n.level} dBm
                  </Text>
                </View>
              ))
            )}
            {d.scan.done && <T muted>★ = ta box · orange = sur la même fréquence que toi</T>}
          </Card>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  date: { color: C.muted, fontSize: 13 },
  finding: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  findText: { flex: 1, fontSize: 15, lineHeight: 21 },
  net: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.border },
  netName: { color: C.text, flex: 1, marginRight: 8 },
  netInfo: { color: C.muted, fontVariant: ['tabular-nums'] },
});
