const rtf = new Intl.RelativeTimeFormat('he', { numeric: 'auto' });
const dayFmt = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit' });

export function timeAgo(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'עכשיו';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return dayFmt.format(new Date(iso));
}

export function clockTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}

export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (d.toDateString() === today.toDateString()) return 'היום';
  if (d.toDateString() === yesterday.toDateString()) return 'אתמול';
  return dayFmt.format(d);
}

/** Stable pleasant color per user for avatars. */
export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 55% 45%)`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export const ROLE_LABEL = { member: 'חבר/ה', moderator: 'מנחה', admin: 'מנהל/ת' } as const;
export const STATUS_LABEL = { pending: 'ממתין לאישור', active: 'פעיל', banned: 'חסום' } as const;
