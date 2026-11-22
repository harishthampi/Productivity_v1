import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { fromPeople, PeopleEditor, toPerson, type Person } from '../../components/People';
import { Button, colors } from '../../components/ui';
import { deleteSquad, listSquads, saveSquad } from '../../lib/social';

const close = () => (router.canGoBack() ? router.back() : router.replace('/plans'));

export default function EditSquad() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const [name, setName] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew) return;
    listSquads()
      .then((all) => {
        const sq = all.find((x) => x.id === id);
        if (!sq) return setError('Squad not found');
        setName(sq.name);
        setPeople([...sq.squad_members].sort((a, b) => a.sort_order - b.sort_order).map(toPerson));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, isNew]);

  const save = async () => {
    try {
      await saveSquad(
        isNew ? null : id,
        name,
        fromPeople(people).map((m, i) => ({ ...m, sort_order: i })),
      );
      close();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = () =>
    Alert.alert('Delete squad?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => void deleteSquad(id).then(close, (e: Error) => setError(e.message)),
      },
    ]);

  if (loading) return <Text style={s.pad}>Loading…</Text>;
  return (
    <>
      <Stack.Screen options={{ title: isNew ? 'New Squad' : 'Edit Squad' }} />
      <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
        <Text style={s.label}>Squad name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="e.g. Weekend Doubles"
          accessibilityLabel="Squad name"
          style={s.input}
        />
        <Text style={s.label}>People · tap a tier to switch Primary / Bench</Text>
        <PeopleEditor people={people} onChange={setPeople} />
        {error && <Text style={s.error}>{error}</Text>}
        <Button label="Save" kind="primary" onPress={save} style={{ marginTop: 24 }} />
        {!isNew && (
          <Button label="Delete squad" kind="danger" onPress={remove} style={{ marginTop: 12 }} />
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
  error: { color: colors.danger, marginTop: 16, fontSize: 15 },
});
