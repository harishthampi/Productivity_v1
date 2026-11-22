import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Celebration } from '../../../components/Celebration';
import { Button, colors, DateTimeField, formatWhen } from '../../../components/ui';
import { isTerminal, retryPresets } from '../../../core/tasks';
import { getStats, resolveTask, useStore } from '../../../lib/store';

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

export default function Checkin() {
  const { id, done, retry } = useLocalSearchParams<{ id: string; done?: string; retry?: string }>();
  const task = useStore((s) => s.tasks.find((t) => t.id === id));
  const [celebrate, setCelebrate] = useState(done === '1' && task?.status === 'completed');
  const [mode, setMode] = useState<'ask' | 'retry'>(retry === '1' ? 'retry' : 'ask');
  const [custom, setCustom] = useState(() => new Date(Date.now() + 60 * 60_000));
  const [error, setError] = useState<string | null>(null);

  if (!task) return <Text style={s.pad}>Task not found.</Text>;
  if (celebrate) return <Celebration stats={getStats()} onDone={close} />;

  if (isTerminal(task)) {
    return (
      <View style={s.pad}>
        <Text style={s.title}>{task.title}</Text>
        <Text style={s.sub}>
          {task.status === 'completed' ? 'Completed.' : 'Marked missed. Tomorrow is a fresh start.'}
        </Text>
        <Button label="Close" kind="primary" onPress={close} style={{ marginTop: 24 }} />
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
  const retryAt = (at: Date) => act(() => (resolveTask(task.id, 'retry', at), close()));

  if (mode === 'retry') {
    return (
      <ScrollView contentContainerStyle={[s.pad, { gap: 10 }]}>
        <Text style={s.title}>When will you try again?</Text>
        {retryPresets(new Date()).map((p) => (
          <Button
            key={p.label}
            label={`${p.label} · ${formatWhen(p.at)}`}
            onPress={() => retryAt(p.at)}
          />
        ))}
        <Text style={s.sub}>Or pick a time</Text>
        <View style={{ alignItems: 'flex-start' }}>
          <DateTimeField value={custom} onChange={setCustom} />
        </View>
        <Button label="Retry at this time" kind="primary" onPress={() => retryAt(custom)} />
        {error && <Text style={s.error}>{error}</Text>}
        <Button label="Back" onPress={() => setMode('ask')} />
      </ScrollView>
    );
  }

  const due = task.checkin_due_at && new Date(task.checkin_due_at) <= new Date();
  return (
    <View style={[s.pad, { gap: 12 }]}>
      <Text style={s.title}>
        {due
          ? `${task.checkin_delay_mins} mins since "${task.title}" started. Did you complete it?`
          : `Did you complete "${task.title}"?`}
      </Text>
      <Button
        label="Yes, Completed"
        kind="primary"
        onPress={() => act(() => (resolveTask(task.id, 'complete'), setCelebrate(true)))}
      />
      <Button label="Retry Later" onPress={() => setMode('retry')} />
      <Button
        label="Mark Missed"
        kind="danger"
        onPress={() => act(() => (resolveTask(task.id, 'miss'), close()))}
      />
      {error && <Text style={s.error}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  pad: { padding: 20 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 8 },
  sub: { fontSize: 16, color: colors.muted, marginTop: 8 },
  error: { color: colors.danger, fontSize: 15 },
});
