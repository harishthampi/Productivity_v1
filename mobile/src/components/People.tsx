import { Contact } from 'expo-contacts';
import { useState } from 'react';
import { Platform, Text, TextInput, View } from 'react-native';
import type { InviteTier, Recipient } from '../lib/social';
import { Button } from './ui';
import { makeStyles, useTheme } from '../theme';

export type Person = Recipient & { key: string; tier: InviteTier | 'off' };

let n = 0;
export const toPerson = (r: Recipient): Person => ({ ...r, key: `p${n++}`, tier: r.default_tier });
export const fromPeople = (people: Person[]): Recipient[] =>
  people
    .filter((p) => p.tier !== 'off')
    .map(({ key: _k, tier, ...r }) => ({ ...r, default_tier: tier as InviteTier }));

const TIER_LABEL = { primary: 'Primary', bench: 'Bench', off: 'Not invited' } as const;

/** Edit a list of people: tap the tier to cycle, add from contacts or by hand. `allowOff` adds "Not invited". */
export function PeopleEditor({
  people,
  onChange,
  allowOff = false,
}: {
  people: Person[];
  onChange: (p: Person[]) => void;
  allowOff?: boolean;
}) {
  const s = useStyles();
  const t = useTheme();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cycle = (p: Person) => {
    const order: Person['tier'][] = allowOff ? ['primary', 'bench', 'off'] : ['primary', 'bench'];
    const tier = order[(order.indexOf(p.tier) + 1) % order.length];
    onChange(people.map((x) => (x.key === p.key ? { ...x, tier } : x)));
  };
  const add = (display_name: string, contact_ref: string | null) =>
    onChange([
      ...people,
      toPerson({ display_name, contact_ref, member_user_id: null, default_tier: 'primary' }),
    ]);

  const addManual = () => {
    if (!name.trim()) return setError('Enter a name');
    add(name.trim(), contact.trim() || null);
    setName('');
    setContact('');
    setError(null);
  };

  const pickContact = async () => {
    try {
      const c = await Contact.presentPicker();
      if (!c) return;
      const [full, phones, emails] = await Promise.all([
        c.getFullName(),
        c.getPhones(),
        c.getEmails(),
      ]);
      add(full || 'Friend', phones[0]?.number ?? emails[0]?.address ?? null);
    } catch (e) {
      setError(`Couldn't open contacts: ${(e as Error).message}`);
    }
  };

  return (
    <View style={{ gap: 8 }}>
      {people.length === 0 && <Text style={s.muted}>No one yet.</Text>}
      {people.map((p) => (
        <View key={p.key} style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={[s.name, p.tier === 'off' && s.muted]}>{p.display_name}</Text>
            {!!p.contact_ref && <Text style={s.muted}>{p.contact_ref}</Text>}
          </View>
          <Button
            label={TIER_LABEL[p.tier]}
            selected={p.tier === 'primary'}
            onPress={() => cycle(p)}
          />
          <Button
            label="✕"
            onPress={() => onChange(people.filter((x) => x.key !== p.key))}
            style={{ paddingHorizontal: 12 }}
          />
        </View>
      ))}
      {Platform.OS !== 'web' && <Button label="+ From contacts" onPress={pickContact} />}
      <View style={s.manual}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          accessibilityLabel="Name"
          style={s.input}
        />
        <TextInput
          value={contact}
          onChangeText={setContact}
          placeholder="Phone or email (optional)"
          accessibilityLabel="Phone or email"
          style={s.input}
        />
        <Button label="Add person" onPress={addManual} />
      </View>
      {error && <Text style={{ color: t.danger }}>{error}</Text>}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.border,
  },
  name: { fontSize: 16, fontWeight: '600', color: t.text },
  muted: { color: t.muted },
  manual: { gap: 8, marginTop: 4 },
  input: {
    fontSize: 16,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.border,
    backgroundColor: t.card,
    color: t.text,
  },
}));
