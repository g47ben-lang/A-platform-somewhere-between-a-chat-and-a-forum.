import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { joinShared, subscribe } from './lib/realtime';
import { notify } from './lib/notify';
import type { Conversation, DmMessage, Message, Profile, Room } from './types';

interface AppState {
  session: Session | null;
  loading: boolean;
  me: Profile | null;
  profiles: Map<string, Profile>;
  rooms: Room[];
  /** The database is older than this app (schema.sql not re-run yet). */
  schemaOutdated: boolean;
  mainRoom: Room | undefined;
  conversations: Conversation[];
  online: Set<string>;
  isMod: boolean;
  isAdmin: boolean;
  recovering: boolean;
  endRecovery: () => void;
  nameOf: (id: string | null | undefined) => string;
  reloadMe: () => Promise<void>;
  reloadProfiles: () => Promise<void>;
  reloadRooms: () => Promise<void>;
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
  const [rooms, setRooms] = useState<Room[]>([]);
  const [schemaOutdated, setSchemaOutdated] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [recovering, setRecovering] = useState(false);
  const meRef = useRef<Profile | null>(null);
  const profilesRef = useRef(profiles);
  meRef.current = me;
  profilesRef.current = profiles;

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

  const reloadRooms = useCallback(async () => {
    const { data, error } = await supabase.rpc('my_rooms');
    // PGRST202 = function not found: the SQL update has not been applied yet.
    setSchemaOutdated(error?.code === 'PGRST202' || /my_rooms/.test(error?.message ?? ''));
    if (data) setRooms(data as Room[]);
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

  // Shared data once approved, kept fresh via realtime. Room list refreshes are debounced
  // because every message in any room touches it.
  useEffect(() => {
    if (!active) return;
    reloadProfiles();
    reloadRooms();
    reloadConversations();
    let roomTimer: ReturnType<typeof setTimeout> | undefined;
    const roomsSoon = () => {
      clearTimeout(roomTimer);
      roomTimer = setTimeout(reloadRooms, 600);
    };
    const unsub = subscribe('app', (ch) =>
      ch
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
          reloadProfiles();
          reloadMe();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, roomsSoon)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => {
          roomsSoon();
          const m = p.new as Message;
          const my = meRef.current;
          if (my && m.author_id !== my.id && m.body.includes(`@${my.display_name}`)) {
            const who = m.anonymous ? 'אנונימי' : profilesRef.current.get(m.author_id ?? '')?.display_name ?? 'מישהו';
            notify(`${who} הזכיר/ה אותך`, m.body);
          }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'dm_messages' }, (p) => {
          reloadConversations();
          const m = p.new as DmMessage;
          const my = meRef.current;
          if (p.eventType === 'INSERT' && my && m.sender_id !== my.id) {
            // sender_id null is either the anonymous other side or my own hidden self;
            // the notification only fires while the tab is hidden, so a self-echo is harmless.
            const who = m.sender_id ? profilesRef.current.get(m.sender_id)?.display_name ?? 'הודעה חדשה' : 'הודעה אנונימית';
            notify(who, m.body, () => (window.location.hash = `#/dm/${m.conversation_id}`));
          }
        }),
    );
    return () => {
      clearTimeout(roomTimer);
      unsub();
    };
  }, [active, reloadProfiles, reloadRooms, reloadConversations, reloadMe]);

  // While pending, poll so the user is let in as soon as an admin approves.
  useEffect(() => {
    if (!uid || me?.status !== 'pending') return;
    const t = setInterval(reloadMe, 15000);
    return () => clearInterval(t);
  }, [uid, me?.status, reloadMe]);

  // Presence: who is online anywhere on the site.
  useEffect(() => {
    if (!active || !uid) return;
    return joinShared(
      'online',
      { config: { presence: { key: uid } } },
      (ch) => ch.on('presence', { event: 'sync' }, () => setOnline(new Set(Object.keys(ch.presenceState())))),
      (ch) => ch.track({ at: Date.now() }),
    );
  }, [active, uid]);

  const nameOf = useCallback((id: string | null | undefined) => (id ? profiles.get(id)?.display_name ?? 'משתמש' : 'אנונימי'), [profiles]);

  const value = useMemo<AppState>(
    () => ({
      session,
      loading,
      me,
      profiles,
      rooms,
      schemaOutdated,
      mainRoom: rooms.find((r) => r.is_main),
      conversations,
      online,
      isMod: active && (me?.role === 'moderator' || me?.role === 'admin'),
      isAdmin: active && me?.role === 'admin',
      recovering,
      endRecovery: () => setRecovering(false),
      nameOf,
      reloadMe,
      reloadProfiles,
      reloadRooms,
      reloadConversations,
    }),
    [session, loading, me, profiles, rooms, schemaOutdated, conversations, online, active, recovering, nameOf, reloadMe, reloadProfiles, reloadRooms, reloadConversations],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
