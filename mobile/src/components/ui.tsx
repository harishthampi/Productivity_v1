import { useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Pressable,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { makeStyles, radius, tabular, useTheme, type Theme } from '../theme';

export const formatWhen = (d: Date | string) =>
  new Date(d).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const formatTime = (d: Date | string) =>
  new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

// ─── Button ───
type ButtonProps = {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'ghost' | 'danger';
  selected?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function Button({
  label,
  onPress,
  kind = 'secondary',
  selected,
  disabled,
  style,
  accessibilityLabel,
}: ButtonProps) {
  const s = useStyles();
  const filled = kind === 'primary' || selected;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.btn,
        filled && s.btnFilled,
        kind === 'ghost' && s.btnGhost,
        kind === 'danger' && s.btnDanger,
        (pressed || disabled) && { opacity: pressed ? 0.75 : 0.5 },
        pressed && { transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      <Text
        style={[
          s.btnText,
          filled && s.btnTextFilled,
          kind === 'ghost' && s.btnTextGhost,
          kind === 'danger' && s.btnTextDanger,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Layout pieces ───
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const s = useStyles();
  return <View style={[s.card, style]}>{children}</View>;
}

export function Label({ children }: { children: ReactNode }) {
  const s = useStyles();
  return <Text style={s.label}>{children}</Text>;
}

export function Field(props: TextInputProps) {
  const s = useStyles();
  const t = useTheme();
  return <TextInput placeholderTextColor={t.muted} {...props} style={[s.input, props.style]} />;
}

// ─── Chips: status pills with a tone. Always carry text, never color alone. ───
export type Tone = 'primary' | 'success' | 'retry' | 'missed';
const toneColors = (t: Theme, tone: Tone) =>
  ({
    primary: { bg: t.primarySoft, fg: t.primaryText },
    success: { bg: t.successSoft, fg: t.successText },
    retry: { bg: t.retrySoft, fg: t.retryText },
    missed: { bg: t.missedSoft, fg: t.missedText },
  })[tone];

export function Chip({ label, tone = 'missed' }: { label: string; tone?: Tone }) {
  const s = useStyles();
  const c = toneColors(useTheme(), tone);
  return (
    <View style={[s.chip, { backgroundColor: c.bg }]}>
      <Text style={[s.chipText, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const t = useTheme();
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '•';
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: t.primarySoft,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: t.primaryText, fontWeight: '700', fontSize: size * 0.4 }}>
        {initials}
      </Text>
    </View>
  );
}

/** Thin progress bar with a rounded data end. `value` is 0..1. */
export function Progress({ value, tone = 'primary' }: { value: number; tone?: Tone | 'brand' }) {
  const t = useTheme();
  const fill = tone === 'brand' || tone === 'primary' ? t.primary : toneColors(t, tone).fg;
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: t.inactive, overflow: 'hidden' }}>
      <View
        style={{
          width: `${Math.max(0, Math.min(1, value)) * 100}%`,
          height: 8,
          borderRadius: 4,
          backgroundColor: fill,
        }}
      />
    </View>
  );
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced, () => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

const useStyles = makeStyles((t) => ({
  btn: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnFilled: { backgroundColor: t.primary, borderColor: t.primary },
  btnGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  btnDanger: { borderColor: t.danger },
  btnText: { fontSize: 16, fontWeight: '600', color: t.text },
  btnTextFilled: { color: t.onPrimary },
  btnTextGhost: { color: t.muted, fontWeight: '500' },
  btnTextDanger: { color: t.danger },
  card: {
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.border,
    borderRadius: radius,
    padding: 16,
    gap: 10,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: t.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  input: {
    fontSize: 17,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.card,
    color: t.text,
  },
  chip: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  chipText: { fontSize: 13, fontWeight: '600', ...tabular },
}));
