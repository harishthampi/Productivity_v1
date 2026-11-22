import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, colors } from '../../../components/ui';
import { DateTimeField } from '../../../components/DateTimeField';
import { isTerminal, type PriorityTier } from '../../../core/tasks';
import { addTask, deleteTask, getSettings, getTask, updateTask } from '../../../lib/store';

const DELAYS: { label: string; value: number | null }[] = [
  { label: '15m', value: 15 },
  { label: '30m', value: 30 },
  { label: '60m', value: 60 },
  { label: 'Off', value: null },
];

const nextHalfHour = () => {
  const d = new Date(Date.now() + 30 * 60_000);
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  return d;
};

const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

export default function EditTask() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const existing = id === 'new' ? undefined : getTask(id);
  const [title, setTitle] = useState(existing?.title ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [when, setWhen] = useState(() =>
    existing ? new Date(existing.scheduled_at) : nextHalfHour(),
  );
  const [delay, setDelay] = useState<number | null>(
    existing ? existing.checkin_delay_mins : getSettings().defaultCheckinDelay,
  );
  const [priority, setPriority] = useState<PriorityTier>(existing?.priority_tier ?? 'standard');
  const [error, setError] = useState<string | null>(null);

  if (id !== 'new' && !existing) return <Text style={s.pad}>Task not found.</Text>;
  if (existing && isTerminal(existing))
    return <Text style={s.pad}>This task is finished and can’t be edited.</Text>;

  const save = () => {
    const input = {
      title,
      notes,
      scheduled_at: when,
      checkin_delay_mins: delay,
      priority_tier: priority,
    };
    try {
      if (existing) updateTask(existing.id, input);
      else addTask(input);
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = () =>
    Alert.alert('Delete task?', 'Its reminders and history will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => (deleteTask(existing!.id), close()) },
    ]);

  return (
    <>
      <Stack.Screen options={{ title: existing ? 'Edit Task' : 'New Task' }} />
      <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>Title</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Submit Report"
          autoFocus={!existing}
          accessibilityLabel="Task title"
          style={s.input}
        />

        <Text style={s.label}>When</Text>
        <View style={{ alignItems: 'flex-start' }}>
          <DateTimeField value={when} onChange={setWhen} />
        </View>

        <Text style={s.label}>Check-in after start</Text>
        <View style={s.chips}>
          {DELAYS.map((d) => (
            <Button
              key={d.label}
              label={d.label}
              selected={delay === d.value}
              onPress={() => setDelay(d.value)}
            />
          ))}
        </View>

        <Text style={s.label}>Priority</Text>
        <View style={s.chips}>
          <Button
            label="Standard"
            selected={priority === 'standard'}
            onPress={() => setPriority('standard')}
          />
          <Button
            label="★ Focus"
            selected={priority === 'focus'}
            onPress={() => setPriority('focus')}
          />
        </View>

        <Text style={s.label}>Notes</Text>
        <TextInput
          value={notes}
          onChangeText={setNotes}
          placeholder="Optional"
          multiline
          accessibilityLabel="Notes"
          style={[s.input, { minHeight: 80 }]}
        />

        {error && (
          <Text style={s.error} accessibilityLiveRegion="assertive">
            {error}
          </Text>
        )}
        <Button label="Save" kind="primary" onPress={save} style={{ marginTop: 24 }} />
        {existing && (
          <Button label="Delete" kind="danger" onPress={remove} style={{ marginTop: 12 }} />
        )}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  pad: { padding: 16 },
  label: { fontSize: 15, fontWeight: '600', color: colors.muted, marginTop: 18, marginBottom: 6 },
  input: {
    fontSize: 17,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    color: colors.text,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  error: { color: colors.danger, marginTop: 16, fontSize: 15 },
});
