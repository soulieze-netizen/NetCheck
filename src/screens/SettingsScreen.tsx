// Réglages : vitesses du contrat VOO, fréquence des tests de débit, box, données.
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { C } from '../analysis';
import { engine } from '../engine';
import { IS_WEB } from '../net';
import { clearAllDays, type Settings } from '../storage';
import { Btn, Card, H, T } from '../ui';
import { useEngine } from './Live';

type NumKey = 'downMin' | 'downNormal' | 'downMax' | 'upMin' | 'upNormal' | 'upMax';

export function SettingsScreen() {
  const st = useEngine();
  const [confirm, setConfirm] = useState(false);
  if (!st) return null;
  const s = st.settings;
  const setNum = (k: NumKey) => (t: string) => engine.updateSettings({ [k]: Number(t.replace(',', '.').replace(/[^\d.]/g, '')) || 0 } as Partial<Settings>);

  return (
    <ScrollView contentContainerStyle={{ padding: 14 }} keyboardShouldPersistTaps="handled">
      <Card>
        <H>Mon contrat VOO</H>
        <T muted>
          Les 3 vitesses obligatoires figurent dans ton contrat ou ton espace client VOO (« minimale », « normalement disponible », «
          maximale »). Elles servent de référence dans les bilans.
        </T>
        <Text style={styles.sub}>⬇ Descendant (Mb/s)</Text>
        <View style={styles.row3}>
          <Field label="minimale" value={s.downMin} onChange={setNum('downMin')} />
          <Field label="normale" value={s.downNormal} onChange={setNum('downNormal')} />
          <Field label="maximale" value={s.downMax} onChange={setNum('downMax')} />
        </View>
        <Text style={styles.sub}>⬆ Montant (Mb/s)</Text>
        <View style={styles.row3}>
          <Field label="minimale" value={s.upMin} onChange={setNum('upMin')} />
          <Field label="normale" value={s.upNormal} onChange={setNum('upNormal')} />
          <Field label="maximale" value={s.upMax} onChange={setNum('upMax')} />
        </View>
      </Card>

      <Card>
        <H>Test de débit automatique</H>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {[0, 15, 30, 60].map((n) => (
            <Btn
              key={n}
              label={n ? `${n} min` : 'Jamais'}
              kind={s.speedEvery === n ? 'primary' : 'default'}
              onPress={() => engine.updateSettings({ speedEvery: n })}
            />
          ))}
        </View>
        <T muted style={{ marginTop: 6 }}>
          Chaque test dure ~15 s et consomme d’autant plus de données que ta ligne est rapide (jusqu’à ~500 Mo sur une ligne à 1 Gb/s). Le
          contrôle chaque seconde, lui, reste léger (~80 Mo par jour).
        </T>
      </Card>

      <Card>
        <H>Appareil</H>
        <T muted>Nom affiché dans le rapport PDF.</T>
        <TextInput
          value={s.deviceLabel}
          onChangeText={(t) => engine.updateSettings({ deviceLabel: t })}
          placeholder={IS_WEB ? 'ex. PC branché en câble' : 'ex. Téléphone Wi-Fi salon'}
          placeholderTextColor={C.muted}
          style={styles.input}
        />
        {!IS_WEB && (
          <>
            <Text style={styles.sub}>Adresse de la box</Text>
            <TextInput
              value={s.boxIp}
              onChangeText={(t) => engine.updateSettings({ boxIp: t.trim() })}
              placeholder={`automatique${st.boxIp ? ` (${st.boxIp})` : ''}`}
              placeholderTextColor={C.muted}
              style={styles.input}
              autoCapitalize="none"
              keyboardType="numbers-and-punctuation"
            />
            <T muted>Laisse vide : l’appli la trouve seule (en général 192.168.0.1 chez VOO).</T>
          </>
        )}
      </Card>

      <Card>
        <H>Comment bien mesurer</H>
        <T muted>
          • Sur le PC : branche-le en câble à la box, ouvre NetCheck dans le navigateur, lance la surveillance et laisse l’onglet ouvert. Dans
          Windows, mets « Mise en veille : Jamais » (Paramètres → Système → Alimentation).{'\n'}• Sur le téléphone : la surveillance continue écran
          éteint (notification « NetCheck surveille »). Si Android la coupe, autorise NetCheck à fonctionner sans restriction de batterie.{'\n'}• Les
          heures qui comptent le plus : 19h-21h, plusieurs jours de suite.{'\n'}• Comparer PC (câble) et téléphone (Wi-Fi) dit si c’est la ligne VOO ou ton
          Wi-Fi.
        </T>
      </Card>

      <Card>
        <H>Données</H>
        <T muted>Les mesures restent sur cet appareil (45 jours).</T>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          {confirm ? (
            <>
              <Btn
                label="Oui, tout effacer"
                kind="danger"
                onPress={async () => {
                  await engine.stop();
                  await clearAllDays();
                  setConfirm(false);
                  engine.reload();
                }}
              />
              <Btn label="Annuler" onPress={() => setConfirm(false)} />
            </>
          ) : (
            <Btn label="🗑 Effacer toutes les mesures" onPress={() => setConfirm(true)} />
          )}
        </View>
      </Card>
      <T muted style={{ textAlign: 'center', marginBottom: 20 }}>
        NetCheck 1.0
      </T>
    </ScrollView>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (t: string) => void }) {
  const [text, setText] = useState(value ? String(value) : '');
  return (
    <View style={{ flex: 1 }}>
      <TextInput
        value={text}
        onChangeText={(t) => {
          setText(t);
          onChange(t);
        }}
        keyboardType="numeric"
        placeholder="—"
        placeholderTextColor={C.muted}
        style={styles.input}
      />
      <Text style={{ color: C.muted, fontSize: 12, textAlign: 'center' }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  sub: { color: C.text, fontWeight: '700', marginTop: 12, marginBottom: 6 },
  row3: { flexDirection: 'row', gap: 8 },
  input: {
    backgroundColor: C.panel2,
    color: C.text,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 16,
    marginTop: 6,
  },
});
