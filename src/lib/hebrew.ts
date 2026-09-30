// Hebrew-calendar labels for display ('י"ב בחשוון'), in the same style as the server's hebrew_label().
const DAYS = ['א\'', 'ב\'', 'ג\'', 'ד\'', 'ה\'', 'ו\'', 'ז\'', 'ח\'', 'ט\'', 'י\'', 'י"א', 'י"ב', 'י"ג', 'י"ד', 'ט"ו', 'ט"ז', 'י"ז', 'י"ח', 'י"ט', 'כ\'',
  'כ"א', 'כ"ב', 'כ"ג', 'כ"ד', 'כ"ה', 'כ"ו', 'כ"ז', 'כ"ח', 'כ"ט', 'ל\''];

const fmt = new Intl.DateTimeFormat('he-u-ca-hebrew', { timeZone: 'UTC', day: 'numeric', month: 'long' });

/** Hebrew day number (1-30) and month name of a calendar date. */
export function hebrewParts(d: Date): { day: number; month: string } {
  const parts = fmt.formatToParts(d);
  return {
    day: Number(parts.find((x) => x.type === 'day')?.value),
    month: (parts.find((x) => x.type === 'month')?.value ?? '').replace(/^ב/, ''),
  };
}

export const hebrewDayLetters = (n: number) => DAYS[n - 1] ?? String(n);

/** 'י"ב בחשוון' for a date given as YYYY-MM-DD (read as a calendar day, no time zone shift). */
export function hebrewLabel(iso: string): string {
  const { day, month } = hebrewParts(new Date(iso + 'T12:00:00Z'));
  return `${hebrewDayLetters(day)} ב${month}`;
}
