import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Platform } from 'react-native';
import { Button, formatWhen } from './ui';

/** Date + time picker: inline compact control on iOS, two-step date → time dialogs on Android. */
export function DateTimeField({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  if (Platform.OS === 'ios') {
    return (
      <DateTimePicker
        value={value}
        mode="datetime"
        display="compact"
        onChange={(_, d) => d && onChange(d)}
      />
    );
  }
  const open = () =>
    DateTimePickerAndroid.open({
      value,
      mode: 'date',
      onChange: (e, d) => {
        if (e.type !== 'set' || !d) return;
        DateTimePickerAndroid.open({
          value: d,
          mode: 'time',
          onChange: (e2, d2) => e2.type === 'set' && d2 && onChange(d2),
        });
      },
    });
  return <Button label={formatWhen(value)} onPress={open} />;
}
