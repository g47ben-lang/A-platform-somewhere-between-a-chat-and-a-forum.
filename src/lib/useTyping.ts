import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { joinShared } from './realtime';

const TTL = 4000;

/**
 * "X is typing…" over a realtime broadcast topic (nothing is stored). When the user writes
 * anonymously, the ping carries no name, so typing never reveals an anonymous author.
 */
export function useTyping(topic: string | null, myName: string | undefined) {
  const [typers, setTypers] = useState<Map<string, { name: string | null; until: number }>>(new Map());
  const channel = useRef<RealtimeChannel | null>(null);
  const selfKey = useRef(crypto.randomUUID());
  const lastPing = useRef(0);

  useEffect(() => {
    setTypers(new Map());
    if (!topic) return;
    const leave = joinShared(
      `typing:${topic}`,
      { config: { broadcast: { self: false } } },
      (ch) =>
        ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
          const { key, name, stop } = payload as { key: string; name: string | null; stop?: boolean };
          setTypers((prev) => {
            const next = new Map(prev);
            if (stop) next.delete(key);
            else next.set(key, { name, until: Date.now() + TTL });
            return next;
          });
        }),
      (ch) => (channel.current = ch),
    );
    const prune = setInterval(() => {
      setTypers((prev) => {
        const now = Date.now();
        if (![...prev.values()].some((t) => t.until < now)) return prev;
        return new Map([...prev].filter(([, t]) => t.until >= now));
      });
    }, 1000);
    return () => {
      clearInterval(prune);
      channel.current = null;
      leave();
    };
  }, [topic]);

  const ping = useCallback(
    (anonymous: boolean, stop = false) => {
      const ch = channel.current;
      if (!ch) return;
      const now = Date.now();
      if (!stop && now - lastPing.current < 2500) return;
      lastPing.current = stop ? 0 : now;
      ch.send({ type: 'broadcast', event: 'typing', payload: { key: selfKey.current, name: anonymous ? null : myName ?? null, stop } });
    },
    [myName],
  );

  const names = [...typers.values()].map((t) => t.name ?? 'מישהו');
  let label = '';
  if (names.length === 1) label = `${names[0]} מקליד/ה…`;
  else if (names.length === 2) label = `${names[0]} ו${names[1]} מקלידים…`;
  else if (names.length > 2) label = `${names.length} אנשים מקלידים…`;

  return { typingLabel: label, ping };
}
