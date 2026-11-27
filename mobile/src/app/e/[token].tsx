// /e/:inviteToken. On the web this is the no-install RSVP page; in the app (deep or universal link)
// it claims the invite for the signed-in user and opens the event.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, Text, View } from 'react-native';
import { RsvpActions } from '../../components/RsvpActions';
import { Button, Card, formatWhen } from '../../components/ui';
import { backendReady, claimInvite, getInviteByToken, type InviteSummary } from '../../lib/social';
import { makeStyles, tabular } from '../../theme';

export default function InviteLanding() {
  const s = useStyles();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [summary, setSummary] = useState<InviteSummary | null | undefined>(
    backendReady ? undefined : null,
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    () =>
      getInviteByToken(token).then(setSummary, (e: Error) => {
        setError(e.message);
        setSummary(null);
      }),
    [token],
  );

  useEffect(() => {
    if (!backendReady) return;
    if (Platform.OS === 'web') return void load();
    // In the app: link this invite to me and jump to the event. Falls back to the token page (e.g. owner's own link).
    claimInvite(token).then(
      (eventId) => router.replace({ pathname: '/event/[id]', params: { id: eventId } }),
      () => void load(),
    );
  }, [token, load]);

  if (summary === undefined) return <Text style={[s.pad, s.sub]}>Loading…</Text>;
  if (!summary) {
    return (
      <View style={s.pad}>
        <Stack.Screen options={{ title: 'Invite', headerShown: Platform.OS !== 'web' }} />
        <Text style={s.title}>Invite not found</Text>
        <Text style={s.sub}>
          {error ?? 'This link is invalid or no longer active. Ask the organizer for a new one.'}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[s.pad, { maxWidth: 520, width: '100%', alignSelf: 'center' }]}
    >
      <Stack.Screen options={{ title: 'Invite', headerShown: Platform.OS !== 'web' }} />
      {/* Web visitors may never have heard of the app; the in-app header already says where they are. */}
      {Platform.OS === 'web' && (
        <View style={s.brandRow}>
          <View style={s.brandMark} />
          <Text style={s.brand}>PulsePlan</Text>
        </View>
      )}
      <Text style={s.kicker}>{summary.owner_display_name || 'A friend'} invited you</Text>
      <Text style={s.title}>{summary.title}</Text>
      <Text style={[s.sub, tabular]}>{formatWhen(summary.scheduled_at)}</Text>
      {!!summary.location_text && <Text style={s.sub}>{summary.location_text}</Text>}
      {summary.event_status !== 'active' ? (
        <Text style={s.sub}>This plan is {summary.event_status}.</Text>
      ) : (
        <View style={{ marginTop: 16 }}>
          <RsvpActions
            token={token}
            status={summary.rsvp_status}
            proposed={summary.proposed_times}
            scheduledAt={summary.scheduled_at}
            onDone={() => void load()}
          />
        </View>
      )}
      {Platform.OS === 'web' && (
        <Card style={{ marginTop: 32 }}>
          <Text style={s.sub}>Get reminders and keep your squads in the PulsePlan app.</Text>
          <Button
            label="Open in app"
            onPress={() => void Linking.openURL(`pulseplan://e/${token}`)}
          />
        </Card>
      )}
    </ScrollView>
  );
}

const useStyles = makeStyles((t) => ({
  pad: { padding: 24, gap: 8 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24 },
  brandMark: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.primary },
  brand: { fontSize: 16, fontWeight: '600', color: t.text },
  kicker: { fontSize: 15, fontWeight: '500', color: t.primaryText },
  title: { fontSize: 28, fontWeight: '600', color: t.text },
  sub: { fontSize: 16, color: t.muted },
}));
