import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { C } from './analysis';

export function Btn({
  label,
  onPress,
  kind = 'default',
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'default' | 'primary' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        kind === 'primary' && { backgroundColor: C.ok, borderColor: C.ok },
        kind === 'danger' && { backgroundColor: '#5a1d1d', borderColor: C.down },
        (pressed || disabled) && { opacity: 0.6 },
        style,
      ]}
    >
      <Text style={[styles.btnText, kind === 'primary' && { color: '#06240f' }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export const H = ({ children }: { children: React.ReactNode }) => <Text style={styles.h}>{children}</Text>;
export const T = ({ children, muted, style }: { children: React.ReactNode; muted?: boolean; style?: any }) => (
  <Text style={[styles.t, muted && { color: C.muted, fontSize: 13 }, style]}>{children}</Text>
);

export const styles = StyleSheet.create({
  btn: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: C.panel2,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
  },
  btnText: { color: C.text, fontWeight: '700', fontSize: 15 },
  card: { backgroundColor: C.panel, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  h: { color: C.text, fontSize: 17, fontWeight: '800', marginBottom: 8 },
  t: { color: C.text, fontSize: 15 },
});
