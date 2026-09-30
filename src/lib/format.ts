const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' });
const dayFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short' });
const fullDayFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
const weekdayFmt = new Intl.DateTimeFormat('he-IL', { weekday: 'long', day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' });

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function timeAgo(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'עכשיו';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return dayFmt.format(new Date(iso));
}

/** Compact stamp for lists: time today, day+month otherwise. */
export function shortStamp(iso: string): string {
  const d = new Date(iso);
  return sameDay(d, new Date()) ? timeFmt.format(d) : dayFmt.format(d);
}

export function clockTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (sameDay(d, today)) return 'היום';
  if (sameDay(d, new Date(today.getTime() - 86400000))) return 'אתמול';
  return weekdayFmt.format(d);
}

export function fullDate(iso: string): string {
  return fullDayFmt.format(new Date(iso));
}

export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const palette = ['#1a73e8', '#188038', '#c5221f', '#e37400', '#9334e6', '#007b83', '#b31412', '#1967d2', '#a142f4', '#137333', '#d01884', '#5f6368'];
  return palette[h % palette.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export const ROLE_LABEL = { member: 'חבר', moderator: 'מנחה', admin: 'מנהל' } as const;
export const STATUS_LABEL = { pending: 'ממתין לאישור', active: 'פעיל', banned: 'חסום' } as const;

export interface Level {
  name: string;
  min: number;
  next: number | null;
}

const LEVELS: Level[] = [
  { name: 'חדש', min: 0, next: 25 },
  { name: 'משתתף', min: 25, next: 100 },
  { name: 'פעיל', min: 100, next: 300 },
  { name: 'ותיק', min: 300, next: 800 },
  { name: 'מוביל', min: 800, next: null },
];

export function levelFor(reputation: number): Level {
  return [...LEVELS].reverse().find((l) => reputation >= l.min) ?? LEVELS[0];
}

export function errorText(err: unknown): string {
  const msg = (err as { message?: string })?.message ?? String(err);
  if (/Invalid login credentials/i.test(msg)) return 'אימייל או סיסמה שגויים';
  if (/already registered/i.test(msg)) return 'כתובת האימייל כבר רשומה';
  if (/Email not confirmed/i.test(msg)) return 'יש לאשר קודם את כתובת האימייל';
  if (/Password should be/i.test(msg)) return 'הסיסמה קצרה מדי';
  if (/rate limit/i.test(msg)) return 'יותר מדי ניסיונות. נסו שוב בעוד כמה דקות';
  if (/row-level security|permission denied/i.test(msg)) return 'אין הרשאה לפעולה הזו';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'אין חיבור לשרת. בדקו את החיבור לאינטרנט';
  return msg;
}
