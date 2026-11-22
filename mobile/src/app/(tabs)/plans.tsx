import { router, Tabs, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, colors, formatWhen } from '../../components/ui';
import {
  backendReady,
  listEvents,
  listSquads,
  useLive,
  type Event,
  type RsvpStatus,
} from '../../lib/social';

const RSVP_LABEL: Record<RsvpStatus, string> = {
  bench: 'Bench',
  invited: 'Awaiting your reply',
  accepted: 'Going',
  declined: 'Declined',
  time_change_requested: 'Asked for a new time',
};

export default function Plans() {
  const [tab, setTab] = useState<'plans' | 'squads'>('plans');
  const events = useLive(listEvents);
  const squads = useLive(listSquads);
  const { refresh: refreshEvents } = events;
  const { refresh: refreshSquads } = squads;
  useFocusEffect(
    useCallback(() => {
      if (!backendReady) return;
      refreshEvents();
      refreshSquads();
    }, [refreshEvents, refreshSquads]),
  );

  if (!backendReady) {
    return (
      <View style={s.pad}>
        <Text style={s.h}>Plans need a backend</Text>
        <Text style={s.muted}>
          Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in mobile/.env, then
          restart the app.
        </Text>
      </View>
    );
  }

  const eventRow = (e: Event, sub: string) => (
    <Pressable
      key={e.id}
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/event/[id]', params: { id: e.id } })}
      style={s.row}
    >
      <Text style={s.rowTitle}>{e.title}</Text>
      <Text style={s.muted}>
        {formatWhen(e.scheduled_at)} · {sub}
      </Text>
    </Pressable>
  );

  const error = events.error ?? squads.error;
  return (
    <>
      <Tabs.Screen
        options={{
          headerRight: () =>
            tab === 'plans' ? (
              <Button
                label="+ New Activity"
                kind="primary"
                onPress={() => router.push('/event/new')}
              />
            ) : (
              <Button
                label="+ New Squad"
                kind="primary"
                onPress={() => router.push({ pathname: '/squad/[id]', params: { id: 'new' } })}
              />
            ),
        }}
      />
      <ScrollView contentContainerStyle={s.pad}>
        <View style={s.segment} accessibilityRole="tablist">
          <Button
            label="Upcoming Plans"
            selected={tab === 'plans'}
            onPress={() => setTab('plans')}
            style={{ flex: 1 }}
          />
          <Button
            label="My Squads"
            selected={tab === 'squads'}
            onPress={() => setTab('squads')}
            style={{ flex: 1 }}
          />
        </View>
        {error && <Text style={{ color: colors.danger }}>{error}</Text>}

        {tab === 'plans' ? (
          <>
            <Text style={s.h}>Hosting</Text>
            {events.data?.hosting.length === 0 && <Text style={s.muted}>Nothing planned yet.</Text>}
            {events.data?.hosting.map((e) =>
              eventRow(e, e.max_spots ? `${e.max_spots} spots` : 'Hosting'),
            )}
            <Text style={s.h}>Invited</Text>
            {events.data?.invited.length === 0 && <Text style={s.muted}>No invites yet.</Text>}
            {events.data?.invited.map((e) => eventRow(e, RSVP_LABEL[e.myInvite.rsvp_status]))}
          </>
        ) : (
          <>
            {squads.data?.length === 0 && (
              <Text style={s.muted}>
                Save a group of friends you invite often, like “Badminton A-Team”.
              </Text>
            )}
            {squads.data?.map((sq) => (
              <View key={sq.id} style={s.row}>
                <Text style={s.rowTitle}>{sq.name}</Text>
                <Text style={s.muted}>{sq.squad_members.length} people</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                  <Button
                    label="Plan with them"
                    kind="primary"
                    onPress={() =>
                      router.push({ pathname: '/event/new', params: { squad: sq.id } })
                    }
                  />
                  <Button
                    label="Edit"
                    onPress={() => router.push({ pathname: '/squad/[id]', params: { id: sq.id } })}
                  />
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </>
  );
}

const s = StyleSheet.create({
  pad: { padding: 16, gap: 8 },
  segment: { flexDirection: 'row', gap: 8 },
  h: { fontSize: 20, fontWeight: '700', color: colors.text, marginTop: 16 },
  muted: { color: colors.muted, fontSize: 15 },
  row: {
    padding: 14,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowTitle: { fontSize: 17, fontWeight: '600', color: colors.text },
});
