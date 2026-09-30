import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Channel, Profile } from './types';

interface AppState {
  session: Session | null;
  loading: boolean;
  me: Profile | null;
  profiles: Map<string, Profile>;
  channels: Channel[];
  online: Set<string>;
  isMod: boolean;
  isAdmin: boolean;
  recovering: boolean;
  endRecovery: () => void;
  reloadMe: () => Promise<void>;
  reloadProfiles: () => Promise<void>;
  reloadChannels: () => Promise<void>;
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

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    reloadMe();
  }, [uid, reloadMe]);

  const active = me?.status === 'active';

  // Load shared data once approved; keep member list fresh via realtime.
  useEffect(() => {
    if (!active) return;
    reloadProfiles();
    reloadChannels();
    const ch = supabase
      .channel('profiles-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        reloadProfiles();
        reloadMe();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [active, reloadProfiles, reloadChannels, reloadMe]);

  // While pending, poll so the user is let in as soon as an admin approves.
  useEffect(() => {
    if (!uid || me?.status !== 'pending') return;
    const t = setInterval(reloadMe, 15000);
    return () => clearInterval(t);
  }, [uid, me?.status, reloadMe]);

  // Presence: who is online right now.
  useEffect(() => {
    if (!active || !uid) return;
    const ch = supabase.channel('online', { config: { presence: { key: uid } } });
    ch.on('presence', { event: 'sync' }, () => {
      setOnline(new Set(Object.keys(ch.presenceState())));
    }).subscribe((status) => {
      if (status === 'SUBSCRIBED') ch.track({ at: Date.now() });
    });
    return () => {
      supabase.removeChannel(ch);
    };
  }, [active, uid]);

  const value = useMemo<AppState>(
    () => ({
      session,
      loading,
      me,
      profiles,
      channels,
      online,
      isMod: active && (me?.role === 'moderator' || me?.role === 'admin'),
      isAdmin: active && me?.role === 'admin',
      recovering,
      endRecovery: () => setRecovering(false),
      reloadMe,
      reloadProfiles,
      reloadChannels,
    }),
    [session, loading, me, profiles, channels, online, active, recovering, reloadMe, reloadProfiles, reloadChannels],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
