import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { C } from './analysis';
import { IS_TV } from './net';

/** Télécommande (Chromecast) : contour bien visible sur l'élément sélectionné */
export const FOCUS = { borderColor: C.accent, borderWidth: 3 };
export function useFocus() {
  const [focused, setFocused] = useState(false);
  return { focused, onFocus: () => setFocused(true), onBlur: () => setFocused(false) };
}

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
  const f = useFocus();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      onFocus={f.onFocus}
      onBlur={f.onBlur}
      style={({ pressed }) => [
        styles.btn,
        kind === 'primary' && { backgroundColor: C.ok, borderColor: C.ok },
        kind === 'danger' && { backgroundColor: '#5a1d1d', borderColor: C.down },
        (pressed || disabled) && { opacity: 0.6 },
        style,
        f.focused && FOCUS,
      ]}
    >
      <Text style={[styles.btnText, kind === 'primary' && { color: '#06240f' }]}>{label}</Text>
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const f = useFocus();
  if (IS_TV) {
    // Sur la télé : un petit point d'arrêt invisible en haut de chaque carte, pour que les flèches fassent défiler les cartes
    // qui ne contiennent que du texte. Il est en haut et fin, donc la flèche bas descend ensuite vers les champs et boutons
    // de la carte (une carte entière sélectionnable les cachait : on ne pouvait plus écrire dans les champs).
    return (
      <View style={[styles.card, style, f.focused && FOCUS]}>
        <Pressable focusable onFocus={f.onFocus} onBlur={f.onBlur} style={styles.anchor} />
        {children}
      </View>
    );
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Champ de saisie avec contour visible quand il est sélectionné à la télécommande */
export function Input(props: TextInputProps) {
  const f = useFocus();
  return (
    <TextInput
      {...props}
      onFocus={(e) => {
        f.onFocus();
        props.onFocus?.(e);
      }}
      onBlur={(e) => {
        f.onBlur();
        props.onBlur?.(e);
      }}
      style={[props.style, f.focused && FOCUS]}
    />
  );
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
  anchor: { position: 'absolute', top: 0, left: 0, right: 0, height: 6 },
  h: { color: C.text, fontSize: 17, fontWeight: '800', marginBottom: 8 },
  t: { color: C.text, fontSize: 15 },
});
