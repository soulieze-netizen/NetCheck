// Réglages : vitesses du contrat VOO, fréquence des tests de débit, box, données.
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { C } from '../analysis';
import { engine } from '../engine';
import { IS_TV, IS_WEB } from '../net';
import { clearAllDays, iptvOrigin, type Settings } from '../storage';
import { cleanTopic, newTopic } from '../remote';
import { Btn, Card, H, T, Input } from '../ui';
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
        {IS_TV ? (
          <T muted>Désactivé sur le Chromecast : un test sature la ligne pendant ~15 s et couperait la chaîne que tu regardes.</T>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', display: IS_TV ? 'none' : 'flex' }}>
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
        <Input
          value={s.deviceLabel}
          onChangeText={(t) => engine.updateSettings({ deviceLabel: t })}
          placeholder={IS_WEB ? 'ex. PC branché en câble' : 'ex. Téléphone Wi-Fi salon'}
          placeholderTextColor={C.muted}
          style={styles.input}
        />
        {!IS_WEB && (
          <>
            <Text style={styles.sub}>Adresse de la box</Text>
            <Input
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
        <H>🔔 Alertes sur le téléphone</H>
        <T muted>
          Le Chromecast t’envoie une notification à chaque problème (coupure, bascule Wi-Fi, serveur IPTV qui ne répond plus), et le bouton « 📺 Ça
          coupe sur la télé » du téléphone enregistre la coupure sur le Chromecast. Il faut le même nom de canal sur les deux appareils.
        </T>
        <Text style={styles.sub}>Nom du canal (le même sur le Chromecast et le téléphone, à garder secret)</Text>
        <Input
          value={s.ntfyTopic ?? ''}
          onChangeText={(t) => engine.updateSettings({ ntfyTopic: cleanTopic(t) })}
          placeholder="ex. netcheck-k7p2xq3m"
          placeholderTextColor={C.muted}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {!s.ntfyTopic && (
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <Btn label="Créer un nom de canal" onPress={() => engine.updateSettings({ ntfyTopic: newTopic() })} />
          </View>
        )}
        <Text style={styles.sub}>Cet appareil envoie les alertes</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Btn label="Oui (Chromecast)" kind={s.alertsOn ? 'primary' : 'default'} onPress={() => engine.updateSettings({ alertsOn: true })} />
          <Btn label="Non (téléphone)" kind={!s.alertsOn ? 'primary' : 'default'} onPress={() => engine.updateSettings({ alertsOn: false })} />
        </View>
        <T muted style={{ marginTop: 8 }}>
          Sur le téléphone : installe l’appli gratuite « ntfy » (Play Store), appuie sur « + », tape exactement le nom du canal, puis « S’abonner ». Entre
          aussi ce nom ici, dans NetCheck, avec « Non (téléphone) ». Les messages passent par le service public ntfy.sh et ne contiennent que l’heure et le
          type de problème.
        </T>
      </Card>

      <Card>
        <H>📺 Serveurs IPTV</H>
        <T muted>
          Colle l’adresse du serveur de ton code Xtream (ex. http://monserveur.com:8080). Si ton fournisseur t’en a donné deux, mets les deux : chacune
          est testée à part, toutes les 2 s. Si un serveur ne répond plus alors qu’internet marche, c’est le fournisseur IPTV qui coupe, pas VOO. Seuls
          l’adresse et le port sont gardés, jamais ton identifiant ni ton mot de passe.
        </T>
        <IptvField label="Serveur 1" value={s.iptvUrl} onChange={(t) => engine.updateSettings({ iptvUrl: t })} />
        <IptvField label="Serveur 2 (facultatif)" value={s.iptvUrl2} onChange={(t) => engine.updateSettings({ iptvUrl2: t })} />
      </Card>

      <Card>
        <H>Comment bien mesurer</H>
        <T muted>
          • Sur le PC : branche-le en câble à la box, ouvre NetCheck dans le navigateur, lance la surveillance et laisse l’onglet ouvert. Dans
          Windows, mets « Mise en veille : Jamais » (Paramètres → Système → Alimentation).{'\n'}• Sur le téléphone : la surveillance continue écran
          éteint (notification « NetCheck surveille »). Si Android la coupe, autorise NetCheck à fonctionner sans restriction de batterie.{'\n'}• Les
          heures qui comptent le plus : 19h-21h, plusieurs jours de suite.{'\n'}• Comparer PC (câble) et téléphone (Wi-Fi) dit si c’est la ligne VOO ou ton
          Wi-Fi.{'\n'}• Si c’est le Chromecast qui coupe : pose le téléphone à côté de lui, connecté au même répéteur, pour mesurer ce que vit le
          Chromecast.
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

function IptvField({ label, value, onChange }: { label: string; value: string; onChange: (t: string) => void }) {
  const o = iptvOrigin(value ?? '');
  return (
    <>
      <Text style={styles.sub}>{label}</Text>
      <Input
        value={value ?? ''}
        onChangeText={(t) => onChange(t.trim())}
        placeholder="http://serveur:port (vide = pas de test)"
        placeholderTextColor={C.muted}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      {value ? (
        o ? (
          <T muted style={{ marginTop: 4 }}>
            Testé : {o}
            {IS_WEB && o.startsWith('http:')
              ? ' — sur PC, le navigateur bloque les serveurs en http : dans Chrome, cadenas → Paramètres du site → Contenu non sécurisé → Autoriser, puis recharge la page.'
              : ''}
          </T>
        ) : (
          <T style={{ color: C.down, marginTop: 4 }}>Adresse non reconnue.</T>
        )
      ) : null}
    </>
  );
}

function Field({ label, value, onChange }: { label: string; value: number; onChange: (t: string) => void }) {
  const [text, setText] = useState(value ? String(value) : '');
  return (
    <View style={{ flex: 1 }}>
      <Input
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
