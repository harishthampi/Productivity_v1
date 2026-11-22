import { createElement } from 'react';
import { useTheme } from '../theme';

// datetime-local works in local time without a zone, so convert both ways explicitly.
const toLocalInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Web version: the native date-time picker package has no web support. */
export function DateTimeField({ value, onChange }: { value: Date; onChange: (d: Date) => void }) {
  const t = useTheme();
  return createElement('input', {
    type: 'datetime-local',
    value: toLocalInput(value),
    'aria-label': 'Date and time',
    onChange: (e: { target: { value: string } }) => {
      const d = new Date(e.target.value); // "YYYY-MM-DDTHH:mm" parses as local time
      if (!Number.isNaN(d.getTime())) onChange(d);
    },
    style: {
      fontSize: 16,
      padding: 10,
      borderRadius: 12,
      border: `1px solid ${t.border}`,
      color: t.text,
      backgroundColor: t.card,
      colorScheme: t.dark ? 'dark' : 'light',
    },
  });
}
