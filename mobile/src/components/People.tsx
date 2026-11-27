import { Contact, ContactField, requestPermissionsAsync } from 'expo-contacts';
import { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import type { InviteTier, Recipient } from '../lib/social';
import { useRevealEnd } from './FormScroll';
import { Button, Field } from './ui';
import { makeStyles, useTheme } from '../theme';

type Suggestion = { id: string; name: string; ref: string | null };
const FIELDS = [ContactField.FULL_NAME, ContactField.PHONES, ContactField.EMAILS] as const;

/** Contacts whose name matches what's typed. Asks for contacts access on the first search; denied = no suggestions. */
function useContactSearch(query: string) {
  const [results, setResults] = useState<Suggestion[]>([]);
  const q = Platform.OS === 'web' ? '' : query.trim();
  useEffect(() => {
    if (q.length < 2) return;
    let live = true;
    const timer = setTimeout(async () => {
      try {
        if (!(await requestPermissionsAsync()).granted) return;
        const found = await Contact.getAllDetails(FIELDS, { name: q, limit: 5 });
        if (!live) return;
        setResults(
          found.map((c) => ({
            id: c.id,
            name: c.fullName || q,
            ref: c.phones?.[0]?.number ?? c.emails?.[0]?.address ?? null,
          })),
        );
      } catch {
        // Suggestions are a convenience; the picker and manual entry still work.
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);
  return q.length < 2 ? [] : results;
}

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
  const suggestions = useContactSearch(name).filter(
    (c) => !people.some((p) => p.display_name === c.name && p.contact_ref === c.ref),
  );
  const revealEnd = useRevealEnd();
  const shown = suggestions.length;
  useEffect(() => {
    if (shown) revealEnd?.(); // suggestions push the Name field down; keep it above the keyboard
  }, [shown, revealEnd]);

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
            label="Remove"
            kind="ghost"
            accessibilityLabel={`Remove ${p.display_name}`}
            onPress={() => onChange(people.filter((x) => x.key !== p.key))}
            style={{ paddingHorizontal: 8 }}
          />
        </View>
      ))}
      {Platform.OS !== 'web' && <Button label="Add from contacts" onPress={pickContact} />}
      <View style={s.manual}>
        {suggestions.map((c) => (
          <Pressable
            key={c.id}
            accessibilityRole="button"
            accessibilityLabel={`Add ${c.name} from contacts`}
            onPress={() => {
              add(c.name, c.ref);
              setName('');
              setError(null);
            }}
            style={({ pressed }) => [s.suggestion, pressed && { opacity: 0.6 }]}
          >
            <Text style={s.name}>{c.name}</Text>
            {!!c.ref && <Text style={s.muted}>{c.ref}</Text>}
          </Pressable>
        ))}
        <Field
          value={name}
          onChangeText={setName}
          onFocus={() => revealEnd?.()}
          placeholder="Name (type to search contacts)"
          accessibilityLabel="Name"
        />
        <Field
          value={contact}
          onChangeText={setContact}
          placeholder="Phone or email (optional)"
          accessibilityLabel="Phone or email"
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
    padding: 12,
    borderRadius: 12,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.border,
  },
  name: { fontSize: 16, fontWeight: '500', color: t.text },
  muted: { color: t.muted },
  manual: { gap: 8, marginTop: 4 },
  suggestion: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: t.card,
    borderWidth: 1,
    borderColor: t.border,
  },
}));
