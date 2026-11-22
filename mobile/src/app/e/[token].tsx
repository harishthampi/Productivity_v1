// /e/:inviteToken. On the web this is the no-install RSVP page; in the app (deep or universal link)
// it claims the invite for the signed-in user and opens the event.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RsvpActions } from '../../components/RsvpActions';
import { Button, colors, formatWhen } from '../../components/ui';
import { backendReady, claimInvite, getInviteByToken, type InviteSummary } from '../../lib/social';

export default function InviteLanding() {
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

  if (summary === undefined) return <Text style={s.pad}>Loading…</Text>;
  if (!summary) {
    return (
      <View style={s.pad}>
        <Stack.Screen options={{ title: 'Invite' }} />
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
      <Stack.Screen options={{ title: 'Invite' }} />
      <Text style={s.kicker}>{summary.owner_display_name || 'A friend'} invited you</Text>
      <Text style={s.title}>{summary.title}</Text>
      <Text style={s.sub}>{formatWhen(summary.scheduled_at)}</Text>
      {!!summary.location_text && <Text style={s.sub}>📍 {summary.location_text}</Text>}
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
        <View style={s.banner}>
          <Text style={s.sub}>Get reminders and keep your squads in the PulsePlan app.</Text>
          <Button
            label="Open in app"
            onPress={() => void Linking.openURL(`pulseplan://e/${token}`)}
          />
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  pad: { padding: 20, gap: 6 },
  kicker: { fontSize: 15, fontWeight: '600', color: colors.primary },
  title: { fontSize: 26, fontWeight: '700', color: colors.text },
  sub: { fontSize: 16, color: colors.muted },
  banner: {
    marginTop: 28,
    padding: 14,
    gap: 10,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
