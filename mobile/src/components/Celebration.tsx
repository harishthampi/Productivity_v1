import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Animated, Easing, Text } from 'react-native';
import type { Stats } from '../core/tasks';
import { Button } from './ui';
import { makeStyles, tabular } from '../theme';

export function Celebration({ stats, onDone }: { stats: Stats; onDone: () => void }) {
  const s = useStyles();
  const [enter] = useState(() => new Animated.Value(0));

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // One short fade-and-rise; the haptic carries the "celebration".
    Animated.timing(enter, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  const rise = enter.interpolate({ inputRange: [0, 1], outputRange: [8, 0] });
  return (
    <Animated.View
      style={[s.wrap, { opacity: enter, transform: [{ translateY: rise }] }]}
      accessibilityLiveRegion="polite"
    >
      <Text style={s.title}>Task complete</Text>
      {stats.streak > 0 && (
        <>
          <Text style={s.figure}>{stats.streak}</Text>
          <Text style={s.line}>on time in a row</Text>
        </>
      )}
      <Text style={s.meta}>{stats.onTime} completed on time so far</Text>
      <Button label="Done" kind="primary" onPress={onDone} style={s.done} />
    </Animated.View>
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
  title: { fontSize: 17, fontWeight: '500', color: t.successText },
  figure: { fontSize: 72, fontWeight: '500', color: t.text, marginTop: 8, ...tabular },
  line: { fontSize: 17, color: t.muted },
  meta: { fontSize: 14, color: t.muted, marginTop: 16, ...tabular },
  done: { marginTop: 32, alignSelf: 'stretch' },
}));
