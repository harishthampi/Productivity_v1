import { Redirect, Tabs } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { type ColorValue } from 'react-native';
import { backendReady } from '../../lib/social';
import { useStore } from '../../lib/store';
import { backdrop, useTheme } from '../../theme';

// SF Symbols on iOS, Material Symbols on Android and web.
const icon = (name: SymbolViewProps['name']) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <SymbolView name={name} size={22} tintColor={color} />;
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
      <Tabs.Screen
        name="index"
        options={{
          title: 'Today',
          tabBarIcon: icon({ ios: 'calendar', android: 'today', web: 'today' }),
        }}
      />
      <Tabs.Screen
        name="plans"
        options={{
          title: 'Plans',
          tabBarIcon: icon({ ios: 'person.2', android: 'group', web: 'group' }),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: icon({
            ios: 'person.crop.circle',
            android: 'account_circle',
            web: 'account_circle',
          }),
        }}
      />
    </Tabs>
  );
}
