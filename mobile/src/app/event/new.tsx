import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { DateTimeField } from '../../components/DateTimeField';
import { FormScroll } from '../../components/FormScroll';
import { fromPeople, PeopleEditor, toPerson, type Person } from '../../components/People';
import { Button, Field } from '../../components/ui';
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
    <FormScroll contentContainerStyle={s.pad}>
      {myName === '' && (
        <>
          <Text style={s.label}>Your name (shown on invites)</Text>
          <Field
            value={nameInput}
            onChangeText={setNameInput}
            placeholder="e.g. Sam"
            accessibilityLabel="Your name"
          />
        </>
      )}
      <Text style={s.label}>Activity</Text>
      <Field
        value={title}
        onChangeText={setTitle}
        placeholder="e.g. Badminton doubles"
        accessibilityLabel="Activity title"
      />
      <Text style={s.label}>When</Text>
      <View style={{ alignItems: 'flex-start' }}>
        <DateTimeField value={when} onChange={setWhen} />
      </View>
      <Text style={s.label}>Location (optional)</Text>
      <Field
        value={location}
        onChangeText={setLocation}
        placeholder="e.g. Downtown courts"
        accessibilityLabel="Location"
      />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>Max spots</Text>
          <Field
            value={spots}
            onChangeText={setSpots}
            keyboardType="number-pad"
            placeholder="Any"
            accessibilityLabel="Max spots"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.label}>Min to go ahead</Text>
          <Field
            value={quorum}
            onChangeText={setQuorum}
            keyboardType="number-pad"
            placeholder="Any"
            accessibilityLabel="Minimum quorum"
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
      <Text style={s.label}>Recipients</Text>
      <Text style={s.hint}>
        {primaryCount} primary{spots ? ` of ${spots} spots` : ''} · tap a tier to change it
      </Text>
      <PeopleEditor people={people} onChange={setPeople} allowOff />

      {error && <Text style={s.error}>{error}</Text>}
      <Button
        label={busy ? 'Creating…' : 'Create and get invite links'}
        kind="primary"
        onPress={() => !busy && create()}
        style={{ marginTop: 24 }}
      />
    </FormScroll>
  );
}

const useStyles = makeStyles((t) => ({
  pad: { padding: 16, paddingBottom: 48 },
  // Label sits closer to its own field (8) than to the field above (24), as in the task editor.
  label: { fontSize: 15, fontWeight: '500', color: t.muted, marginTop: 24, marginBottom: 8 },
  hint: { fontSize: 14, color: t.muted, marginBottom: 8, fontVariant: ['tabular-nums'] },
  muted: { color: t.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  error: { color: t.danger, marginTop: 16, fontSize: 15 },
}));
