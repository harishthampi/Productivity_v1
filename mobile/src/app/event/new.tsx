import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { DateTimeField } from '../../components/DateTimeField';
import { fromPeople, PeopleEditor, toPerson, type Person } from '../../components/People';
import { Button } from '../../components/ui';
import { createEvent, getMyName, listSquads, setMyName, type Squad } from '../../lib/social';
import { makeStyles } from '../../theme';

const tomorrowAt10 = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
};
const toInt = (s: string) => (s.trim() ? Number.parseInt(s, 10) : null);

export default function CreateActivity() {
  const s = useStyles();
  const { squad } = useLocalSearchParams<{ squad?: string }>();
  const [squads, setSquads] = useState<Squad[]>([]);
  const [myName, setMyNameState] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(tomorrowAt10);
  const [location, setLocation] = useState('');
  const [spots, setSpots] = useState('');
  const [quorum, setQuorum] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyName().then(setMyNameState, () => setMyNameState(''));
    listSquads()
      .then((all) => {
        setSquads(all);
        const pre = all.find((x) => x.id === squad);
        if (pre) pickSquad(pre);
      })
      .catch((e: Error) => setError(e.message));
  }, [squad]);

  function pickSquad(sq: Squad) {
    setPeople([...sq.squad_members].sort((a, b) => a.sort_order - b.sort_order).map(toPerson));
  }

  const primaryCount = people.filter((p) => p.tier === 'primary').length;

  const create = async () => {
    const max_spots = toInt(spots);
    const min_accepted_quorum = toInt(quorum);
    if ((spots.trim() && !(max_spots! >= 1)) || (quorum.trim() && !(min_accepted_quorum! >= 1)))
      return setError('Spots and quorum must be whole numbers above 0');
    setBusy(true);
    setError(null);
    try {
      if (!myName) {
        if (!nameInput.trim()) throw new Error('Add your name so friends know who’s inviting them');
        await setMyName(nameInput);
      }
      const id = await createEvent(
        {
          title,
          location_text: location.trim() || null,
          scheduled_at: when.toISOString(),
          max_spots,
          min_accepted_quorum,
        },
        fromPeople(people),
      );
      router.replace({ pathname: '/event/[id]', params: { id } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
      {myName === '' && (
        <>
          <Text style={s.label}>Your name (shown on invites)</Text>
          <TextInput
            value={nameInput}
            onChangeText={setNameInput}
            placeholder="e.g. Sam"
            accessibilityLabel="Your name"
            style={s.input}
          />
        </>
      )}
      <Text style={s.label}>Activity</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Badminton Doubles"
        accessibilityLabel="Activity title"
        style={s.input}
      />
      <Text style={s.label}>When</Text>
      <View style={{ alignItems: 'flex-start' }}>
        <DateTimeField value={when} onChange={setWhen} />
      </View>
      <Text style={s.label}>Location (optional)</Text>
      <TextInput
        value={location}
        onChangeText={setLocation}
        placeholder="e.g. Downtown courts"
        accessibilityLabel="Location"
        style={s.input}
      />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>Max spots</Text>
          <TextInput
            value={spots}
            onChangeText={setSpots}
            keyboardType="number-pad"
            placeholder="Any"
            accessibilityLabel="Max spots"
            style={s.input}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>Min to go ahead</Text>
          <TextInput
            value={quorum}
            onChangeText={setQuorum}
            keyboardType="number-pad"
            placeholder="Any"
            accessibilityLabel="Minimum quorum"
            style={s.input}
          />
        </View>
      </View>

      <Text style={s.label}>Invite from a squad</Text>
      <View style={s.chips}>
        {squads.length === 0 && <Text style={s.muted}>No squads yet. Add people below.</Text>}
        {squads.map((sq) => (
          <Button
            key={sq.id}
            label={sq.name}
            selected={squad === sq.id}
            onPress={() => pickSquad(sq)}
          />
        ))}
      </View>
      <Text style={s.label}>
        Recipients · {primaryCount} primary{spots ? ` of ${spots} spots` : ''} · tap a tier to
        change
      </Text>
      <PeopleEditor people={people} onChange={setPeople} allowOff />

      {error && <Text style={s.error}>{error}</Text>}
      <Button
        label={busy ? 'Creating…' : 'Create & get invite links'}
        kind="primary"
        onPress={() => !busy && create()}
        style={{ marginTop: 24 }}
      />
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  pad: { padding: 16, paddingBottom: 48 },
  label: { fontSize: 15, fontWeight: '600', color: t.muted, marginTop: 18, marginBottom: 6 },
  muted: { color: t.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: {
    fontSize: 17,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.card,
    color: t.text,
  },
  error: { color: t.danger, marginTop: 16, fontSize: 15 },
}));
