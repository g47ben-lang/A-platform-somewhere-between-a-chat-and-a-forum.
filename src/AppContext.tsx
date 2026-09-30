import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { RealtimeChannel, Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { subscribe } from './lib/realtime';
import type { Channel, Conversation, Profile } from './types';

interface AppState {
  session: Session | null;
  loading: boolean;
  me: Profile | null;
  profiles: Map<string, Profile>;
  channels: Channel[];
  conversations: Conversation[];
  online: Set<string>;
  isMod: boolean;
  isAdmin: boolean;
  recovering: boolean;
  endRecovery: () => void;
  nameOf: (id: string | null | undefined) => string;
  reloadMe: () => Promise<void>;
  reloadProfiles: () => Promise<void>;
  reloadChannels: () => Promise<void>;
  reloadConversations: () => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [channels, setChannels] = useState<Channel[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (!data.session) setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      setSession(s);
      if (!s) {
        setMe(null);
        setLoading(false);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;

  const reloadMe = useCallback(async () => {
    if (!uid) return;
    const { data } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
    setMe(data as Profile | null);
    setLoading(false);
  }, [uid]);

  const reloadProfiles = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('display_name');
    if (data) setProfiles(new Map((data as Profile[]).map((p) => [p.id, p])));
  }, []);

  const reloadChannels = useCallback(async () => {
    const { data } = await supabase.from('channels').select('*').order('position').order('id');
    if (data) setChannels(data as Channel[]);
  }, []);

  const reloadConversations = useCallback(async () => {
    const { data } = await supabase.rpc('my_conversations');
    if (data) setConversations(data as Conversation[]);
  }, []);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    reloadMe();
  }, [uid, reloadMe]);

  const active = me?.status === 'active';

  // Shared data once approved, kept fresh via realtime.
  useEffect(() => {
    if (!active) return;
    reloadProfiles();
    reloadChannels();
    reloadConversations();
    return subscribe('app', (ch) =>
      ch
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
          reloadProfiles();
          reloadMe();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_messages' }, () => reloadConversations()),
    );
  }, [active, reloadProfiles, reloadChannels, reloadConversations, reloadMe]);

  // While pending, poll so the user is let in as soon as an admin approves.
  useEffect(() => {
    if (!uid || me?.status !== 'pending') return;
    const t = setInterval(reloadMe, 15000);
    return () => clearInterval(t);
  }, [uid, me?.status, reloadMe]);

  // Presence needs one shared topic, so wait for any previous instance to be fully removed.
  useEffect(() => {
    if (!active || !uid) return;
    let cancelled = false;
    let ch: RealtimeChannel | null = null;
    (async () => {
      const stale = supabase.getChannels().filter((c) => c.topic === 'realtime:online');
      await Promise.all(stale.map((c) => supabase.removeChannel(c)));
      if (cancelled) return;
      ch = supabase.channel('online', { config: { presence: { key: uid } } });
      ch.on('presence', { event: 'sync' }, () => {
        if (ch) setOnline(new Set(Object.keys(ch.presenceState())));
      }).subscribe((status) => {
        if (status === 'SUBSCRIBED') ch?.track({ at: Date.now() });
      });
    })();
    return () => {
      cancelled = true;
      if (ch) supabase.removeChannel(ch);
    };
  }, [active, uid]);

  const nameOf = useCallback((id: string | null | undefined) => (id ? profiles.get(id)?.display_name ?? 'משתמש' : 'אנונימי'), [profiles]);

  const value = useMemo<AppState>(
    () => ({
      session,
      loading,
      me,
      profiles,
      channels,
      conversations,
      online,
      isMod: active && (me?.role === 'moderator' || me?.role === 'admin'),
      isAdmin: active && me?.role === 'admin',
      recovering,
      endRecovery: () => setRecovering(false),
      nameOf,
      reloadMe,
      reloadProfiles,
      reloadChannels,
      reloadConversations,
    }),
    [session, loading, me, profiles, channels, conversations, online, active, recovering, nameOf, reloadMe, reloadProfiles, reloadChannels, reloadConversations],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
