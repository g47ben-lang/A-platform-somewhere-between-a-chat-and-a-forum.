import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../AppContext';
import { supabase } from '../supabase';
import { subscribe } from '../lib/realtime';
import { errorText, fullDate, levelFor, ROLE_LABEL, timeAgo } from '../lib/format';
import type { MemberStats, WallPost } from '../types';
import Avatar from '../components/Avatar';
import Composer from '../components/Composer';
import { useFeedback } from '../components/Feedback';
import Icon from '../components/Icon';
import MessageRow from '../components/MessageRow';
import { startConversation } from '../components/NewChatDialog';

export default function ProfilePage() {
  const userId = useParams().userId!;
  const { me, profiles, online, isMod, reloadConversations } = useApp();
  const { confirm, toast } = useFeedback();
  const navigate = useNavigate();
  const profile = profiles.get(userId);
  const isMe = me?.id === userId;

  const [stats, setStats] = useState<MemberStats | null>(null);
  const [rank, setRank] = useState<number | null>(null);
  const [wall, setWall] = useState<WallPost[] | null>(null);
  const [mineAnon, setMineAnon] = useState<Set<number>>(new Set());

  const loadWall = useCallback(async () => {
    const { data } = await supabase.from('wall_posts').select('*').eq('profile_id', userId).order('id', { ascending: false }).limit(100);
    const list = (data as WallPost[]) ?? [];
    setWall(list);
    const ids = list.filter((w) => w.anonymous).map((w) => w.id);
    if (ids.length) {
      const { data: a } = await supabase.from('anon_authors').select('item_id').eq('kind', 'wall').in('item_id', ids);
      setMineAnon(new Set((a ?? []).map((x) => x.item_id as number)));
    }
  }, [userId]);

  useEffect(() => {
    setStats(null);
    setWall(null);
    supabase.rpc('member_stats').then(({ data }) => {
      const all = (data as MemberStats[]) ?? [];
      const s = all.find((x) => x.id === userId) ?? null;
      setStats(s);
      if (s) setRank(all.filter((x) => x.reputation > s.reputation).length + 1);
    });
    loadWall();
    return subscribe(`wall-${userId}`, (ch) =>
      ch.on('postgres_changes', { event: '*', schema: 'public', table: 'wall_posts', filter: `profile_id=eq.${userId}` }, loadWall),
    );
  }, [userId, loadWall]);

  async function message(anonymous: boolean) {
    const res = await startConversation(userId, anonymous);
    if ('error' in res) return toast(res.error, 'error');
    await reloadConversations();
    navigate(`/dm/${res.id}`);
  }

  async function postWall(text: string, opts: { anonymous: boolean }) {
    if (!text) return false;
    const { data, error } = await supabase.rpc('post_wall', { p_profile: userId, p_body: text, p_anonymous: opts.anonymous });
    if (error) {
      toast(errorText(error), 'error');
      return false;
    }
    const w = data as WallPost;
    setWall((prev) => (prev && !prev.some((x) => x.id === w.id) ? [w, ...prev] : prev));
    if (opts.anonymous) setMineAnon((prev) => new Set(prev).add(w.id));
    return true;
  }

  async function removeWall(w: WallPost) {
    const ok = await confirm({ title: 'מחיקת הודעה', body: 'ההודעה תוסר מהפרופיל.', confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    const { error } = await supabase.from('wall_posts').delete().eq('id', w.id);
    if (error) toast(errorText(error), 'error');
    else setWall((prev) => prev?.filter((x) => x.id !== w.id) ?? prev);
  }

  if (!profile) {
    return (
      <div className="pane"><div className="empty-state">{profiles.size === 0 ? <div className="spinner" /> : <p>המשתמש לא נמצא.</p>}</div></div>
    );
  }

  const level = levelFor(stats?.reputation ?? 0);
  const progress = level.next ? Math.min(100, (((stats?.reputation ?? 0) - level.min) / (level.next - level.min)) * 100) : 100;

  return (
    <div className="pane scroll-pane">
      <div className="page">
        <section className="profile-card">
          <Avatar id={profile.id} name={profile.display_name} size={96} online={online.has(profile.id)} />
          <div className="profile-main">
            <h1>{profile.display_name}</h1>
            <div className="profile-meta">
              {profile.role !== 'member' && <span className="role-tag">{ROLE_LABEL[profile.role]}</span>}
              <span>{online.has(profile.id) ? 'מחובר/ת עכשיו' : 'לא מחובר/ת'}</span>
              <span>·</span>
              <span>חבר/ה מאז {fullDate(profile.created_at)}</span>
            </div>
            {profile.bio && <p className="profile-bio">{profile.bio}</p>}
            <div className="profile-actions">
              {isMe ? (
                <Link to="/settings" className="btn outlined"><Icon name="edit" size={18} /> עריכת הפרופיל</Link>
              ) : (
                <>
                  <button className="btn filled" onClick={() => message(false)}><Icon name="chat" size={18} /> שליחת הודעה</button>
                  {profile.accept_anonymous && (
                    <button className="btn tonal" onClick={() => message(true)}><Icon name="visibility_off" size={18} /> הודעה אנונימית</button>
                  )}
                </>
              )}
            </div>
          </div>
        </section>

        <section className="rep-card">
          <div className="rep-head">
            <div className="rep-score">
              <Icon name="workspace_premium" filled size={28} />
              <div>
                <div className="rep-number">{stats?.reputation ?? '–'}</div>
                <div className="muted small">מוניטין</div>
              </div>
            </div>
            <div className="rep-level">
              <div className="rep-level-name">{level.name}</div>
              {rank && <div className="muted small">מקום {rank} בקהילה</div>}
            </div>
          </div>
          <div className="progress" aria-label="התקדמות לדרגה הבאה">
            <div style={{ width: `${progress}%` }} />
          </div>
          <div className="muted small">
            {level.next ? `עוד ${level.next - (stats?.reputation ?? 0)} נקודות לדרגה הבאה` : 'הדרגה הגבוהה ביותר'}
          </div>
          <div className="stat-row">
            <Stat label="שרשורים" value={stats?.threads} />
            <Stat label="תשובות" value={stats?.replies} />
            <Stat label="לייקים שהתקבלו" value={stats?.likes} />
          </div>
          <p className="muted small rep-explain">כל לייק שמתקבל = 5 נקודות, כל שרשור = 2, כל תשובה = 1. תוכן אנונימי לא נספר.</p>
        </section>

        <section className="wall">
          <h2 className="section-title">הודעות ציבוריות</h2>
          <p className="muted small">הודעות שחברי הקהילה השאירו ל{isMe ? 'ך' : profile.display_name}. גלויות לכל החברים.</p>
          {!isMe && (
            <Composer
              placeholder={`כתיבת הודעה ציבורית ל${profile.display_name}`}
              allowAnonymous={profile.accept_anonymous}
              onSend={postWall}
              maxLength={2000}
            />
          )}
          {wall === null ? (
            <div className="spinner" />
          ) : wall.length === 0 ? (
            <div className="empty-state small"><p>אין עדיין הודעות.</p></div>
          ) : (
            <div className="wall-list">
              {wall.map((w) => {
                const mine = w.author_id === me?.id || mineAnon.has(w.id);
                const canDelete = mine || isMe || isMod;
                return (
                  <div className="wall-item" key={w.id} title={timeAgo(w.created_at)}>
                    <MessageRow
                      authorId={w.author_id}
                      anonymous={w.anonymous}
                      mine={mine}
                      createdAt={w.created_at}
                      body={w.body}
                      actions={canDelete ? [{ icon: 'delete', label: 'מחיקה', onClick: () => removeWall(w), danger: true }] : []}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="stat">
      <div className="stat-value">{value ?? '–'}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
