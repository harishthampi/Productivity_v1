import { Redirect, Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { colors } from '../../components/ui';
import { backendReady } from '../../lib/social';
import { useStore } from '../../lib/store';

const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ fontSize: 20, color }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  const onboarded = useStore((s) => !!s.settings.onboarded);
  if (backendReady && !onboarded) return <Redirect href="/welcome" />;
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('◉') }} />
      <Tabs.Screen name="plans" options={{ title: 'Plans', tabBarIcon: icon('☷') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('◔') }} />
    </Tabs>
  );
}
