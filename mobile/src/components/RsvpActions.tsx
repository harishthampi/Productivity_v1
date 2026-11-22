import { useState } from 'react';
import { Text, View } from 'react-native';
import { respond, type RsvpStatus } from '../lib/social';
import { DateTimeField } from './DateTimeField';
import { Button, formatWhen } from './ui';
import { useTheme } from '../theme';

const STATUS_TEXT: Partial<Record<RsvpStatus, string>> = {
  invited: 'You haven’t answered yet.',
  accepted: 'You’re going.',
  declined: 'You declined.',
  time_change_requested: 'You asked for a different time.',
};

/** Accept / Decline / Request Time Change for one invite token. Used in the app and on the web page. */
export function RsvpActions({
  token,
  status,
  proposed,
  scheduledAt,
  onDone,
}: {
  token: string;
  status: RsvpStatus;
  proposed: string[];
  scheduledAt: string;
  onDone: () => void;
}) {
  const t = useTheme();
  const [picking, setPicking] = useState(false);
  const base = new Date(scheduledAt).getTime() + 60 * 60_000;
  const [slots, setSlots] = useState<Date[]>([new Date(base)]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (s: 'accepted' | 'declined' | 'time_change_requested', times: Date[] = []) => {
    setBusy(true);
    setError(null);
    try {
      await respond(token, s, times);
      setPicking(false);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ fontSize: 16, color: t.muted }} accessibilityLiveRegion="polite">
        {STATUS_TEXT[status]}
        {status === 'time_change_requested' && proposed.length
          ? ` (${proposed.map((p) => formatWhen(p)).join(' or ')})`
          : ''}
      </Text>
      {!picking ? (
        <>
          <Button
            label="Accept"
            kind="primary"
            selected={status === 'accepted'}
            onPress={() => !busy && send('accepted')}
          />
          <Button label="Decline" onPress={() => !busy && send('declined')} />
          <Button label="Request Time Change" onPress={() => setPicking(true)} />
        </>
      ) : (
        <>
          <Text style={{ fontSize: 16, fontWeight: '600', color: t.text }}>Suggest 1–2 times</Text>
          {slots.map((d, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <DateTimeField
                value={d}
                onChange={(nd) => setSlots(slots.map((x, j) => (j === i ? nd : x)))}
              />
              {slots.length > 1 && (
                <Button label="✕" onPress={() => setSlots(slots.filter((_, j) => j !== i))} />
              )}
            </View>
          ))}
          {slots.length < 2 && (
            <Button
              label="+ Another time"
              onPress={() => setSlots([...slots, new Date(base + 60 * 60_000)])}
            />
          )}
          <Button
            label="Send"
            kind="primary"
            onPress={() => !busy && send('time_change_requested', slots)}
          />
          <Button label="Back" onPress={() => setPicking(false)} />
        </>
      )}
      {error && <Text style={{ color: t.danger }}>{error}</Text>}
    </View>
  );
}
