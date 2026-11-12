import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from './src/analysis';
import { DayScreen } from './src/screens/DayView';
import { LiveScreen } from './src/screens/Live';
import { ReportScreen } from './src/screens/Report';
import { SettingsScreen } from './src/screens/SettingsScreen';

type Tab = 'live' | 'day' | 'report' | 'settings';
const TABS: { id: Tab; icon: string; label: string }[] = [
  { id: 'live', icon: '📡', label: 'Direct' },
  { id: 'day', icon: '📅', label: 'Journée' },
  { id: 'report', icon: '📄', label: 'Rapport' },
  { id: 'settings', icon: '⚙', label: 'Réglages' },
];

function Main() {
  const [tab, setTab] = useState<Tab>('live');
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>NetCheck</Text>
        <Text style={styles.subtitle}>contrôle de la connexion</Text>
      </View>
      <View style={styles.body}>
        <View style={styles.content}>
          {tab === 'live' && <LiveScreen />}
          {tab === 'day' && <DayScreen />}
          {tab === 'report' && <ReportScreen />}
          {tab === 'settings' && <SettingsScreen />}
        </View>
      </View>
      <View style={[styles.tabs, { paddingBottom: 6 + insets.bottom }]}>
        {TABS.map((t) => (
          <Pressable key={t.id} style={[styles.tab, tab === t.id && styles.tabOn]} onPress={() => setTab(t.id)}>
            <Text style={styles.tabIcon}>{t.icon}</Text>
            <Text style={[styles.tabLabel, tab === t.id && { color: C.text }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  title: { color: C.ok, fontSize: 22, fontWeight: '900' },
  subtitle: { color: C.muted, fontSize: 13 },
  body: { flex: 1, alignItems: 'center' },
  content: { flex: 1, width: '100%', maxWidth: 820 },
  tabs: { flexDirection: 'row', backgroundColor: '#080B14', borderTopWidth: 1, borderTopColor: C.border, paddingTop: 6 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 4, borderRadius: 10, marginHorizontal: 4 },
  tabOn: { backgroundColor: C.panel2 },
  tabIcon: { fontSize: 20 },
  tabLabel: { color: C.muted, fontSize: 12, marginTop: 2 },
});
