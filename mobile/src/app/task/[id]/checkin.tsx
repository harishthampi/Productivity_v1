import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Celebration } from '../../../components/Celebration';
import { DateTimeField } from '../../../components/DateTimeField';
import { Button, Card, formatTime, formatWhen } from '../../../components/ui';
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
        <Text style={s.sub}>{task.status === 'completed' ? 'Completed' : 'Logged as missed'}</Text>
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

  const elapsed = Math.round((openedAt - Date.parse(task.scheduled_at)) / 60_000);
  const context =
    elapsed >= 0
      ? `Scheduled ${formatTime(task.scheduled_at)} · ${elapsed} min ago`
      : `Starts at ${formatTime(task.scheduled_at)}`;

  return (
    <ScrollView contentContainerStyle={[s.pad, { gap: 16 }]} keyboardShouldPersistTaps="handled">
      <Text style={s.context}>{context}</Text>
      <Text style={s.title} accessibilityRole="header">
        Did you complete “{task.title}”?
      </Text>

      <Button
        label="Yes, completed"
        kind="primary"
        onPress={() => act(() => (resolveTask(task.id, 'complete'), setCelebrate(true)))}
      />

      <Card>
        <Text style={s.trayTitle}>Retry later</Text>
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
          label={`Retry at ${formatWhen(retryTime)}`}
          onPress={() => act(() => (resolveTask(task.id, 'retry', retryTime), close()))}
        />
      </Card>

      {error && (
        <Text style={s.error} accessibilityLiveRegion="assertive">
          {error}
        </Text>
      )}

      <Button
        label="Mark missed"
        kind="ghost"
        onPress={() => act(() => (resolveTask(task.id, 'miss'), close()))}
      />
      <Text style={s.fine}>Missed tasks help pace your future plans</Text>
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  pad: { padding: 24, paddingTop: 32, paddingBottom: 40 },
  context: { fontSize: 14, fontWeight: '500', color: t.muted, ...tabular },
  title: { fontSize: 24, fontWeight: '600', color: t.text },
  sub: { fontSize: 16, lineHeight: 24, color: t.muted },
  trayTitle: { fontSize: 17, fontWeight: '600', color: t.text },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, paddingVertical: 8, paddingHorizontal: 12, ...tabular },
  error: { color: t.danger, fontSize: 15 },
  fine: { fontSize: 13, color: t.muted, textAlign: 'center' },
}));
