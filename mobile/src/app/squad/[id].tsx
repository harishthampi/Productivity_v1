import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Text } from 'react-native';
import { FormScroll } from '../../components/FormScroll';
import { fromPeople, PeopleEditor, toPerson, type Person } from '../../components/People';
import { Button, Field } from '../../components/ui';
import { deleteSquad, listSquads, saveSquad } from '../../lib/social';
import { makeStyles } from '../../theme';

const close = () => (router.canGoBack() ? router.back() : router.replace('/plans'));

export default function EditSquad() {
  const s = useStyles();
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

  if (loading) return <Text style={[s.pad, s.hint]}>Loading…</Text>;
  return (
    <>
      <Stack.Screen options={{ title: isNew ? 'New squad' : 'Edit squad' }} />
      <FormScroll contentContainerStyle={s.pad}>
        <Text style={s.label}>Squad name</Text>
        <Field
          value={name}
          onChangeText={setName}
          placeholder="e.g. Weekend doubles"
          accessibilityLabel="Squad name"
        />
        <Text style={s.label}>People</Text>
        <Text style={s.hint}>Tap a tier to switch between primary and bench</Text>
        <PeopleEditor people={people} onChange={setPeople} />
        {error && <Text style={s.error}>{error}</Text>}
        <Button label="Save" kind="primary" onPress={save} style={{ marginTop: 24 }} />
        {!isNew && (
          <Button label="Delete squad" kind="danger" onPress={remove} style={{ marginTop: 12 }} />
        )}
      </FormScroll>
    </>
  );
}

const useStyles = makeStyles((t) => ({
  pad: { padding: 16 },
  // Label sits closer to its own field (8) than to the field above (24), as in the task editor.
  label: { fontSize: 15, fontWeight: '500', color: t.muted, marginTop: 24, marginBottom: 8 },
  hint: { fontSize: 14, color: t.muted, marginBottom: 8 },
  error: { color: t.danger, marginTop: 16, fontSize: 15 },
}));
