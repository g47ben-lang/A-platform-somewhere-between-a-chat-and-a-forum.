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
