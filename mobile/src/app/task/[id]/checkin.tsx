import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Celebration } from '../../../components/Celebration';
import { DateTimeField } from '../../../components/DateTimeField';
import { Button, Card, Chip, formatTime, formatWhen } from '../../../components/ui';
import { isTerminal, retryPresets } from '../../../core/tasks';
import { getStats, resolveTask, useStore } from '../../../lib/store';
import { makeStyles, tabular } from '../../../theme';

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
const LONG_LABEL: Record<string, string> = {
  '+1 hr': '+1 hour',
  '+3 hrs': '+3 hours',
  'Tomorrow 10:00 AM': 'Tomorrow',
};

export default function CheckinSheet() {
  const s = useStyles();
  const { id, done } = useLocalSearchParams<{ id: string; done?: string; retry?: string }>();
  const task = useStore((st) => st.tasks.find((t) => t.id === id));
  const [celebrate, setCelebrate] = useState(done === '1' && task?.status === 'completed');
  const [presets] = useState(() => retryPresets(new Date()));
  const [choice, setChoice] = useState<number | 'custom'>(0);
  const [custom, setCustom] = useState(() => new Date(Date.now() + 60 * 60_000));
  const [error, setError] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());

  if (!task) return <Text style={[s.sub, s.pad]}>Task not found.</Text>;
  if (celebrate) return <Celebration stats={getStats()} onDone={close} />;

  if (isTerminal(task)) {
    return (
      <View style={[s.pad, { gap: 12 }]}>
        <Text style={s.title}>{task.title}</Text>
        <Text style={s.sub}>
          {task.status === 'completed'
            ? 'Completed. Nice follow-through.'
            : 'Logged as missed. That’s useful data, not a verdict. Tomorrow is a fresh start.'}
        </Text>
        <Button label="Close" kind="primary" onPress={close} />
      </View>
    );
  }

  const act = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const retryTime = choice === 'custom' ? custom : presets[choice].at;
  const retryLabel = choice === 'custom' ? formatWhen(custom) : LONG_LABEL[presets[choice].label];

  const elapsed = Math.round((openedAt - Date.parse(task.scheduled_at)) / 60_000);
  const context =
    elapsed >= 0
      ? `Scheduled for ${formatTime(task.scheduled_at)} · ${elapsed} min${elapsed === 1 ? '' : 's'} elapsed`
      : `Starts at ${formatTime(task.scheduled_at)}`;

  return (
    <ScrollView contentContainerStyle={[s.pad, { gap: 14 }]} keyboardShouldPersistTaps="handled">
      <Chip label={context} tone="primary" />
      <Text style={s.title} accessibilityRole="header">
        Did you complete “{task.title}”?
      </Text>
      <Text style={s.sub}>
        Calm follow-through. Be honest with your pace: momentum is built on accurate tracking, not
        perfection.
      </Text>

      <Button
        label="✓ Yes, Completed"
        kind="primary"
        onPress={() => act(() => (resolveTask(task.id, 'complete'), setCelebrate(true)))}
      />

      <Card>
        <Text style={s.trayTitle}>Need more runway?</Text>
        <View style={s.chips}>
          {presets.map((p, i) => (
            <Button
              key={p.label}
              label={`${LONG_LABEL[p.label]} (${formatTime(p.at)})`}
              selected={choice === i}
              onPress={() => setChoice(i)}
              style={s.chip}
            />
          ))}
          <Button
            label="Custom"
            selected={choice === 'custom'}
            onPress={() => setChoice('custom')}
            style={s.chip}
          />
        </View>
        {choice === 'custom' && (
          <View style={{ alignItems: 'flex-start' }}>
            <DateTimeField value={custom} onChange={setCustom} />
          </View>
        )}
        <Button
          label={`Confirm Retry (${retryLabel})`}
          onPress={() => act(() => (resolveTask(task.id, 'retry', retryTime), close()))}
        />
      </Card>

      {error && (
        <Text style={s.error} accessibilityLiveRegion="assertive">
          {error}
        </Text>
      )}

      <Button
        label="Didn’t get to it (Mark Missed)"
        kind="ghost"
        onPress={() => act(() => (resolveTask(task.id, 'miss'), close()))}
      />
      <Text style={s.fine}>
        Zero shaming. We log this calmly to help recalibrate your daily workload.
      </Text>
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  pad: { padding: 20, paddingTop: 28, paddingBottom: 40 },
  title: { fontSize: 24, fontWeight: '800', color: t.text },
  sub: { fontSize: 16, lineHeight: 22, color: t.muted },
  trayTitle: { fontSize: 17, fontWeight: '700', color: t.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999, ...tabular },
  error: { color: t.danger, fontSize: 15 },
  fine: { fontSize: 13, color: t.muted, textAlign: 'center', marginTop: -6 },
}));
