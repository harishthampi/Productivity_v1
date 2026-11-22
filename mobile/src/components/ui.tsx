import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

export const colors = {
  bg: '#F7F7F9',
  card: '#FFFFFF',
  text: '#16161D',
  muted: '#6B6B76',
  primary: '#4F46E5',
  success: '#15803D',
  danger: '#B91C1C',
  warn: '#FEF3C7',
  border: '#E4E4EA',
};

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

type ButtonProps = {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  selected?: boolean;
  style?: ViewStyle;
};

export function Button({ label, onPress, kind = 'secondary', selected, style }: ButtonProps) {
  const filled = kind === 'primary' || selected;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        s.btn,
        filled && { backgroundColor: colors.primary, borderColor: colors.primary },
        kind === 'danger' && { borderColor: colors.danger },
        pressed && { opacity: 0.7 },
        style,
      ]}
    >
      <Text
        style={[
          s.btnText,
          filled && { color: '#fff' },
          kind === 'danger' && { color: colors.danger },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: {
    minHeight: 44,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { fontSize: 16, fontWeight: '600', color: colors.text },
});
