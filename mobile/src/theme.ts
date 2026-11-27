// Two themes from the design spec: "Clarity & Momentum" (light) and "Obsidian Amber" (dark).
// Text-on-color pairs are picked for WCAG AA (≥4.5:1); the raw accent hues are used for fills, borders and icons.
import { useMemo } from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

export const light = {
  dark: false,
  bg: '#F8F9FA',
  bgTint: '#EFF4FF',
  card: '#FFFFFF',
  border: 'rgba(15, 23, 42, 0.14)', // inputs, buttons, dividers
  glassEdge: 'rgba(15, 23, 42, 0.08)', // hairline around cards
  shadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
  text: '#0F172A',
  muted: '#526075', // darker than slate-500 so it stays >=4.5:1 on bg
  inactive: '#CBD5E1',
  primary: '#2563EB', // Cobalt
  onPrimary: '#FFFFFF',
  primarySoft: '#DBEAFE',
  primaryText: '#1D4ED8', // cobalt text on primarySoft (4.24:1 → 6:1)
  success: '#16A34A', // Calm Emerald
  successText: '#15803D',
  successSoft: '#DCFCE7',
  retry: '#D97706', // Warm Amber
  retryText: '#B45309',
  retrySoft: '#FEF3C7',
  missed: '#64748B', // Muted Slate, non-punitive
  missedText: '#475569',
  missedSoft: '#F1F5F9',
  danger: '#B91C1C', // only for destructive account actions
  scrim: 'rgba(15, 23, 42, 0.4)',
};

export type Theme = typeof light;

export const dark: Theme = {
  dark: true,
  bg: '#0E0E12', // Pitch obsidian
  bgTint: '#16161B',
  card: '#17171C', // one surface step above bg: depth from steps, not shadows
  border: 'rgba(255, 255, 255, 0.14)',
  glassEdge: 'rgba(255, 255, 255, 0.08)',
  shadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
  text: '#F4F4F5',
  muted: '#A1A1AA',
  inactive: '#39393D',
  primary: '#F97316', // Ember amber
  onPrimary: '#0E0E12', // white on #F97316 is only 2.8:1
  primarySoft: '#2A1A10',
  primaryText: '#F97316',
  success: '#10B981',
  successText: '#34D399',
  successSoft: '#0F2A20',
  retry: '#FBBF24', // a yellower amber so it doesn't read as the brand accent
  retryText: '#FBBF24',
  retrySoft: '#2A2210',
  missed: '#A1A1AA',
  missedText: '#A1A1AA',
  missedSoft: '#1C1C21',
  danger: '#F87171',
  scrim: 'rgba(0, 0, 0, 0.6)',
};

export const radius = 16;

/** Card surface: solid fill, hairline edge, small neutral shadow. */
export const glass = (t: Theme) => ({
  backgroundColor: t.card,
  borderColor: t.glassEdge,
  boxShadow: t.shadow,
});

/** Screen background. */
export const backdrop = (t: Theme) => ({ backgroundColor: t.bg });
export const tabular = { fontVariant: ['tabular-nums' as const] };

export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light);

/** `const useStyles = makeStyles((t) => ({ ... }))`, then `const s = useStyles()` inside a component. */
// Same generic shape as StyleSheet.create, so style literals keep their narrow types.
type NamedStyles = Parameters<typeof StyleSheet.create>[0];
export function makeStyles<S extends NamedStyles>(fn: (t: Theme) => S & NamedStyles) {
  return () => {
    const t = useTheme();
    return useMemo(() => StyleSheet.create(fn(t)), [t]);
  };
}
