import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import type { Stats } from '../core/tasks';
import { Button } from './ui';
import { makeStyles } from '../theme';

export function Celebration({ stats, onDone }: { stats: Stats; onDone: () => void }) {
  const s = useStyles();
  const [scale] = useState(() => new Animated.Value(0.6));

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }).start();
  }, [scale]);

  return (
    <View style={s.wrap} accessibilityLiveRegion="polite">
      <Animated.Text style={[s.emoji, { transform: [{ scale }] }]} accessibilityElementsHidden>
        🎉
      </Animated.Text>
      <Text style={s.title}>Nice work!</Text>
      <Text style={s.line}>{stats.onTime} completed on time</Text>
      <Text style={s.line}>On-time streak: {stats.streak}</Text>
      <Button
        label="Done"
        kind="primary"
        onPress={onDone}
        style={{ marginTop: 24, alignSelf: 'stretch' }}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: t.bg,
  },
  emoji: { fontSize: 72 },
  title: { fontSize: 28, fontWeight: '700', color: t.text, marginVertical: 12 },
  line: { fontSize: 17, color: t.muted, marginTop: 4 },
}));
