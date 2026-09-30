import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../supabase';

/**
 * Subscribe to realtime changes under a unique topic and return a cleanup function.
 *
 * Topics must be unique per subscription: supabase.channel(name) returns the existing channel
 * while a previous removeChannel() is still in flight, and adding handlers to an already
 * subscribed channel throws. That crash used to blank the whole app.
 */
export function subscribe(name: string, setup: (ch: RealtimeChannel) => RealtimeChannel): () => void {
  const ch = setup(supabase.channel(`${name}:${crypto.randomUUID()}`));
  ch.subscribe();
  return () => {
    supabase.removeChannel(ch);
  };
}

/**
 * Join a topic that several clients must share (presence, broadcast). Any stale instance of the
 * same topic is fully removed first, for the reason described above.
 */
export function joinShared(
  topic: string,
  config: Parameters<typeof supabase.channel>[1],
  setup: (ch: RealtimeChannel) => RealtimeChannel,
  onReady?: (ch: RealtimeChannel) => void,
): () => void {
  let cancelled = false;
  let ch: RealtimeChannel | null = null;
  (async () => {
    const stale = supabase.getChannels().filter((c) => c.topic === `realtime:${topic}`);
    await Promise.all(stale.map((c) => supabase.removeChannel(c)));
    if (cancelled) return;
    ch = setup(supabase.channel(topic, config));
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED' && ch && !cancelled) onReady?.(ch);
    });
  })();
  return () => {
    cancelled = true;
    if (ch) supabase.removeChannel(ch);
  };
}
