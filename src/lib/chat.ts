import type { ReactionSummary } from '../components/ChatStream';

/** Groups raw reaction rows into one chip per emoji, in first-used order. */
export function summarizeReactions<T extends { emoji: string }>(rows: T[], isMine: (r: T) => boolean, nameOf: (r: T) => string): ReactionSummary[] {
  const map = new Map<string, ReactionSummary>();
  for (const r of rows) {
    const s = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false, names: [] };
    s.count++;
    s.mine ||= isMine(r);
    s.names.push(nameOf(r));
    map.set(r.emoji, s);
  }
  return [...map.values()];
}

/** Shareable link to one message inside a room or chat (route such as "/" or "/room/3"). */
export function messageLink(route: string, id: number): string {
  const base = window.location.origin + window.location.pathname;
  return `${base}#${route}${route.includes('?') ? '&' : '?'}m=${id}`;
}
