import { Redirect, Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { backendReady } from '../../lib/social';
import { useStore } from '../../lib/store';
import { backdrop, useTheme } from '../../theme';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  const t = useTheme();
  const onboarded = useStore((s) => !!s.settings.onboarded);
  if (backendReady && !onboarded) return <Redirect href="/welcome" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false, // each tab draws its own large header, per the design
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
        sceneStyle: backdrop(t),
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('◉') }} />
      <Tabs.Screen name="plans" options={{ title: 'Plans', tabBarIcon: icon('☷') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('◔') }} />
    </Tabs>
  );
}
