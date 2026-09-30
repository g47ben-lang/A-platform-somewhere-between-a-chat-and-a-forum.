// Countdown to the next yeshiva calendar milestone (client only). Edit TARGETS to change what is counted.
// Months as Intl names them in Hebrew ('ניסן', 'תשרי', 'חשוון').
const TARGETS: { month: string; day: number; label: string }[] = [
  { month: 'ניסן', day: 1, label: 'בין הזמנים' },
  { month: 'תשרי', day: 1, label: 'ראש השנה' },
  { month: 'חשוון', day: 1, label: 'תחילת זמן חורף' },
];

const fmt = new Intl.DateTimeFormat('he-u-ca-hebrew', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'long' });

function hebrewOf(d: Date): { month: string; day: number } {
  const parts = fmt.formatToParts(d);
  return {
    month: (parts.find((p) => p.type === 'month')?.value ?? '').replace(/^ב/, ''),
    day: Number(parts.find((p) => p.type === 'day')?.value),
  };
}

export interface Countdown {
  label: string;
  days: number;
  date: Date;
}

/** The next target within a year (today counts as 0 days). */
export function nextCountdown(now = new Date()): Countdown | null {
  for (let i = 0; i < 400; i++) {
    const d = new Date(now.getTime() + i * 86400000);
    const h = hebrewOf(d);
    const t = TARGETS.find((x) => x.day === h.day && h.month.startsWith(x.month));
    if (t) return { label: t.label, days: i, date: d };
  }
  return null;
}
