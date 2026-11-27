import { useHeaderHeight } from 'expo-router/react-navigation';
import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  type ScrollViewInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

// Lets a field near the bottom of a form ask to be scrolled above the keyboard.
const RevealContext = createContext<(() => void) | null>(null);
export const useRevealEnd = () => useContext(RevealContext);

/** Form ScrollView that shrinks above the keyboard (Android is edge-to-edge, so 'padding' on both). */
export function FormScroll({
  children,
  contentContainerStyle,
}: {
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  const ref = useRef<ScrollViewInstance>(null);
  const header = useHeaderHeight();
  const revealEnd = useCallback(() => {
    const toEnd = () => ref.current?.scrollToEnd({ animated: true });
    if (Keyboard.isVisible()) return toEnd();
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      sub.remove();
      toEnd();
    });
    setTimeout(() => sub.remove(), 1500); // no keyboard (e.g. hardware keys): don't jump later
  }, []);
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={header}>
      <ScrollView
        ref={ref}
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps="handled"
      >
        <RevealContext.Provider value={revealEnd}>{children}</RevealContext.Provider>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
