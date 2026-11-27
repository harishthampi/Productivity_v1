import * as AppleAuthentication from 'expo-apple-authentication';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../components/ui';
import {
  sendEmailCode,
  signInWithApple,
  signInWithGoogle,
  verifyEmailCode,
  type EmailMode,
} from '../lib/auth';
import { setOnboarded } from '../lib/store';
import { backdrop, makeStyles, useTheme } from '../theme';

const done = () => router.replace('/');

export default function Welcome() {
  const s = useStyles();
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [mode, setMode] = useState<EmailMode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const run = async (fn: () => Promise<unknown>, after?: (r: unknown) => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      after?.(await fn());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const provider = (fn: () => Promise<boolean>) => run(fn, (ok) => ok && done());

  return (
    <SafeAreaView style={{ flex: 1, ...backdrop(t) }}>
      <ScrollView contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled">
        <Text style={s.title}>PulsePlan</Text>
        <Text style={s.sub}>
          Reminders that check in 30 minutes later, and plans with the friends you actually play
          with.
        </Text>

        <View style={{ gap: 10, marginTop: 28 }}>
          {Platform.OS === 'ios' ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
              cornerRadius={12}
              style={{ height: 48 }}
              onPress={() => void provider(signInWithApple)}
            />
          ) : (
            <Button label="Continue with Apple" onPress={() => void provider(signInWithApple)} />
          )}
          <Button label="Continue with Google" onPress={() => void provider(signInWithGoogle)} />
        </View>

        <Text style={s.or}>or with email</Text>
        {mode === null ? (
          <View style={{ gap: 10 }}>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              accessibilityLabel="Email"
              style={s.input}
            />
            <Button
              label="Email me a code"
              kind="primary"
              onPress={() =>
                void run(
                  () => sendEmailCode(email),
                  (m) => setMode(m as EmailMode),
                )
              }
            />
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <Text style={s.sub}>Enter the 6-digit code we sent to {email.trim()}.</Text>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              keyboardType="number-pad"
              autoComplete="one-time-code"
              accessibilityLabel="Code"
              style={s.input}
            />
            <Button
              label="Verify"
              kind="primary"
              onPress={() => void run(() => verifyEmailCode(email, code, mode), done)}
            />
            <Button label="Use a different email" onPress={() => (setMode(null), setCode(''))} />
          </View>
        )}

        {busy && <Text style={s.sub}>Working…</Text>}
        {error && (
          <Text style={s.error} accessibilityLiveRegion="assertive">
            {error}
          </Text>
        )}

        <Button
          label="Skip for now"
          onPress={() => (setOnboarded(), done())}
          style={{ marginTop: 28 }}
        />
        <Text style={s.fine}>
          Skipping keeps your data on a guest account; sign in later from Profile to keep it if you
          change phones. Times use your timezone ({timezone}).
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((t) => ({
  pad: { padding: 24, paddingTop: 48 },
  title: { fontSize: 34, fontWeight: '800', color: t.text },
  sub: { fontSize: 16, color: t.muted, marginTop: 6 },
  or: { textAlign: 'center', color: t.muted, marginVertical: 20 },
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
  fine: { fontSize: 13, color: t.muted, marginTop: 10, textAlign: 'center' },
}));
