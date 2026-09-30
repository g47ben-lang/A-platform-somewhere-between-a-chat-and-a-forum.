-- =====================================================================
-- Community chat schema for Supabase.
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Idempotent: safe to re-run, and upgrades an existing install in place without losing data.
--
-- Model:
--   spaces (table `channels`) -> threads (a post in a space) -> messages (replies, live)
--   direct conversations (dm_*), optionally anonymous on the initiator's side
--   profile walls (public messages to a member, optionally anonymous)
--   likes on threads/messages feed each member's reputation
--
-- Anonymity: anonymous rows store NO author id. The real author is kept in `anon_authors`,
-- readable only by that author (so they can edit/delete their own posts). Anonymous DM
-- initiators are hidden via dm_participants.hidden. Nothing exposes them to other members.
--
-- Access: sign-up creates a *pending* profile; an admin approves it.
--         The very first user to sign up becomes an active admin automatically.
-- =====================================================================

-- ---------- Types ----------
do $$ begin
  create type member_status as enum ('pending', 'active', 'banned');
exception when duplicate_object then null; end $$;

do $$ begin
  create type member_role as enum ('member', 'moderator', 'admin');
exception when duplicate_object then null; end $$;

-- ---------- Profiles ----------
create table if not exists profiles (
  id            uuid primary key references auth.users on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  status        member_status not null default 'pending',
  role          member_role   not null default 'member',
  created_at    timestamptz   not null default now()
);
alter table profiles add column if not exists bio text;
alter table profiles add column if not exists accept_anonymous boolean not null default true;
alter table profiles drop constraint if exists profiles_bio_len;
alter table profiles add constraint profiles_bio_len check (char_length(bio) <= 500);

-- ---------- Spaces ----------
create table if not exists channels (
  id               bigint generated always as identity primary key,
  name             text not null check (char_length(name) between 1 and 60),
  description      text check (char_length(description) <= 300),
  position         int  not null default 0,
  admin_only_post  boolean not null default false,  -- announcement spaces: only mods start threads
  created_at       timestamptz not null default now()
);

-- ---------- Threads ----------
create table if not exists threads (
  id                bigint generated always as identity primary key,
  channel_id        bigint not null references channels on delete cascade,
  author_id         uuid   references profiles on delete cascade,  -- null when anonymous
  title             text,
  body              text,
  pinned            boolean not null default false,
  locked            boolean not null default false,
  message_count     int     not null default 0,
  created_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now()
);
alter table threads add column if not exists anonymous boolean not null default false;
alter table threads alter column author_id drop not null;
alter table threads alter column title drop not null;
alter table threads drop constraint if exists threads_title_check;
alter table threads drop constraint if exists threads_body_check;
alter table threads drop constraint if exists threads_title_len;
alter table threads drop constraint if exists threads_body_len;
alter table threads drop constraint if exists threads_has_content;
alter table threads add constraint threads_title_len check (title is null or char_length(title) between 1 and 150);
alter table threads add constraint threads_body_len check (body is null or char_length(body) <= 8000);
alter table threads add constraint threads_has_content check (title is not null or body is not null);
create index if not exists threads_channel_activity_idx on threads (channel_id, pinned desc, last_activity_at desc);
create index if not exists threads_author_idx on threads (author_id);

-- ---------- Replies ----------
create table if not exists messages (
  id          bigint generated always as identity primary key,
  thread_id   bigint not null references threads on delete cascade,
  author_id   uuid   references profiles on delete cascade,  -- null when anonymous
  reply_to    bigint references messages on delete set null,
  body        text   not null,
  deleted     boolean not null default false,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  constraint messages_body_len check (deleted or char_length(body) between 1 and 4000)
);
alter table messages add column if not exists anonymous boolean not null default false;
alter table messages alter column author_id drop not null;
create index if not exists messages_thread_created_idx on messages (thread_id, id desc);
create index if not exists messages_author_idx on messages (author_id);

-- ---------- Likes ----------
create table if not exists reactions (
  message_id  bigint not null references messages on delete cascade,
  user_id     uuid   not null references profiles on delete cascade,
  emoji       text   not null,
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
-- v1 allowed arbitrary emoji; v2 keeps a single "like".
insert into reactions (message_id, user_id, emoji, created_at)
  select message_id, user_id, 'like', min(created_at) from reactions where emoji <> 'like' group by 1, 2
  on conflict do nothing;
delete from reactions where emoji <> 'like';
alter table reactions drop constraint if exists reactions_emoji_check;
alter table reactions drop constraint if exists reactions_like_only;
alter table reactions add constraint reactions_like_only check (emoji = 'like');
alter table reactions alter column emoji set default 'like';

create table if not exists thread_likes (
  thread_id   bigint not null references threads on delete cascade,
  user_id     uuid   not null references profiles on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create table if not exists thread_reads (
  user_id       uuid   not null references profiles on delete cascade,
  thread_id     bigint not null references threads on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (user_id, thread_id)
);

-- ---------- Anonymous authorship (private) ----------
create table if not exists anon_authors (
  kind       text   not null check (kind in ('thread', 'message', 'wall')),
  item_id    bigint not null,
  author_id  uuid   not null references profiles on delete cascade,
  primary key (kind, item_id)
);

-- ---------- Profile walls ----------
create table if not exists wall_posts (
  id          bigint generated always as identity primary key,
  profile_id  uuid not null references profiles on delete cascade,
  author_id   uuid references profiles on delete cascade,  -- null when anonymous
  anonymous   boolean not null default false,
  body        text not null check (char_length(body) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists wall_posts_profile_idx on wall_posts (profile_id, id desc);

-- ---------- Direct conversations ----------
create table if not exists dm_conversations (
  id               bigint generated always as identity primary key,
  anonymous        boolean not null default false,
  pair_key         text unique,  -- "<uuid>:<uuid>" sorted; only for non-anonymous 1:1 chats
  closed           boolean not null default false,  -- recipient blocked an anonymous chat
  created_at       timestamptz not null default now(),
  last_message_at  timestamptz not null default now()
);

create table if not exists dm_participants (
  conversation_id  bigint not null references dm_conversations on delete cascade,
  user_id          uuid   not null references profiles on delete cascade,
  hidden           boolean not null default false,  -- anonymous initiator; never shown to the other side
  last_read_at     timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists dm_participants_user_idx on dm_participants (user_id);

create table if not exists dm_messages (
  id               bigint generated always as identity primary key,
  conversation_id  bigint not null references dm_conversations on delete cascade,
  sender_id        uuid references profiles on delete cascade,  -- null when sent by the hidden participant
  body             text not null,
  deleted          boolean not null default false,
  created_at       timestamptz not null default now(),
  edited_at        timestamptz,
  constraint dm_messages_body_len check (deleted or char_length(body) between 1 and 4000)
);
create index if not exists dm_messages_conv_idx on dm_messages (conversation_id, id desc);

-- ---------- Permission helpers ----------
create or replace function is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active');
$$;

create or replace function is_mod() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles
                 where id = auth.uid() and status = 'active' and role in ('moderator', 'admin'));
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles
                 where id = auth.uid() and status = 'active' and role = 'admin');
$$;

create or replace function owns_anon(p_kind text, p_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from anon_authors where kind = p_kind and item_id = p_id and author_id = auth.uid());
$$;

create or replace function is_dm_participant(p_conv bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from dm_participants where conversation_id = p_conv and user_id = auth.uid());
$$;

create or replace function is_hidden_in_dm(p_conv bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from dm_participants where conversation_id = p_conv and user_id = auth.uid() and hidden);
$$;

-- ---------- Triggers ----------

-- New auth user -> profile. First user ever becomes active admin.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
begin
  select not exists (select 1 from profiles) into first_user;
  insert into profiles (id, display_name, status, role)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)), 40),
    case when first_user then 'active'::member_status else 'pending'::member_status end,
    case when first_user then 'admin'::member_role  else 'member'::member_role  end
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Only admins may change role/status. (auth.uid() is null when run from the SQL editor.)
create or replace function guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin() then
    new.role   := old.role;
    new.status := old.status;
  end if;
  if auth.uid() is not null and auth.uid() <> old.id then
    -- admins manage role/status only; personal fields belong to the member
    new.display_name     := old.display_name;
    new.bio              := old.bio;
    new.accept_anonymous := old.accept_anonymous;
  end if;
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists profiles_guard on profiles;
create trigger profiles_guard before update on profiles
  for each row execute function guard_profile_update();

-- Threads: only the owner edits text; only mods pin/lock/move; nobody fakes counters or authorship.
create or replace function guard_thread_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_owner boolean;
begin
  new.author_id  := old.author_id;
  new.anonymous  := old.anonymous;
  new.created_at := old.created_at;
  -- Depth 1 = a direct user update (not the reply-counter trigger below).
  if pg_trigger_depth() = 1 and auth.uid() is not null then
    is_owner := coalesce(old.author_id = auth.uid(), false) or owns_anon('thread', old.id);
    new.message_count    := old.message_count;
    new.last_activity_at := old.last_activity_at;
    if not is_owner then
      new.title := old.title;
      new.body  := old.body;
    end if;
    if not is_mod() then
      new.pinned     := old.pinned;
      new.locked     := old.locked;
      new.channel_id := old.channel_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists threads_guard on threads;
create trigger threads_guard before update on threads
  for each row execute function guard_thread_update();

-- Replies: owner edits body; soft delete wipes body; nothing else changes.
create or replace function guard_message_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_id  := old.author_id;
  new.anonymous  := old.anonymous;
  new.thread_id  := old.thread_id;
  new.created_at := old.created_at;
  new.reply_to   := old.reply_to;
  if old.deleted then
    new.deleted := true;
    new.body := '';
  elsif new.deleted then
    new.body := '';
  elsif new.body is distinct from old.body then
    if auth.uid() is not null
       and not (coalesce(old.author_id = auth.uid(), false) or owns_anon('message', old.id)) then
      new.body := old.body;  -- moderators may delete, not rewrite
    else
      new.edited_at := now();
    end if;
  end if;
  return new;
end $$;

drop trigger if exists messages_guard on messages;
create trigger messages_guard before update on messages
  for each row execute function guard_message_update();

create or replace function guard_dm_message_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.sender_id       := old.sender_id;
  new.conversation_id := old.conversation_id;
  new.created_at      := old.created_at;
  if old.deleted then
    new.deleted := true;
    new.body := '';
  elsif new.deleted then
    new.body := '';
  elsif new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end $$;

drop trigger if exists dm_messages_guard on dm_messages;
create trigger dm_messages_guard before update on dm_messages
  for each row execute function guard_dm_message_update();

-- Keep thread counters fresh.
create or replace function bump_thread() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update threads
     set message_count = message_count + 1,
         last_activity_at = new.created_at
   where id = new.thread_id;
  return new;
end $$;

drop trigger if exists messages_bump on messages;
create trigger messages_bump after insert on messages
  for each row execute function bump_thread();

-- ---------- Actions (all writes that involve authorship go through these) ----------

create or replace function create_thread(p_channel bigint, p_title text, p_body text, p_anonymous boolean default false)
returns threads
language plpgsql security definer set search_path = public as $$
declare
  ch channels;
  t threads;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  select * into ch from channels where id = p_channel;
  if not found then raise exception 'המרחב לא נמצא'; end if;
  if ch.admin_only_post and not is_mod() then
    raise exception 'רק מנהלים יכולים לפרסם במרחב הזה' using errcode = '42501';
  end if;
  insert into threads (channel_id, author_id, anonymous, title, body)
  values (p_channel,
          case when p_anonymous then null else auth.uid() end,
          coalesce(p_anonymous, false),
          nullif(trim(p_title), ''),
          nullif(trim(p_body), ''))
  returning * into t;
  if p_anonymous then
    insert into anon_authors (kind, item_id, author_id) values ('thread', t.id, auth.uid());
  end if;
  return t;
end $$;

create or replace function post_message(p_thread bigint, p_body text, p_reply_to bigint default null, p_anonymous boolean default false)
returns messages
language plpgsql security definer set search_path = public as $$
declare
  th threads;
  m messages;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  select * into th from threads where id = p_thread;
  if not found then raise exception 'השרשור לא נמצא'; end if;
  if th.locked and not is_mod() then raise exception 'השרשור נעול' using errcode = '42501'; end if;
  insert into messages (thread_id, author_id, anonymous, body, reply_to)
  values (p_thread,
          case when p_anonymous then null else auth.uid() end,
          coalesce(p_anonymous, false),
          trim(p_body),
          (select id from messages where id = p_reply_to and thread_id = p_thread))
  returning * into m;
  if p_anonymous then
    insert into anon_authors (kind, item_id, author_id) values ('message', m.id, auth.uid());
  end if;
  return m;
end $$;

create or replace function post_wall(p_profile uuid, p_body text, p_anonymous boolean default false)
returns wall_posts
language plpgsql security definer set search_path = public as $$
declare
  target profiles;
  w wall_posts;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  select * into target from profiles where id = p_profile and status = 'active';
  if not found then raise exception 'המשתמש לא נמצא'; end if;
  if p_anonymous and not target.accept_anonymous then
    raise exception 'המשתמש לא מקבל הודעות אנונימיות' using errcode = '42501';
  end if;
  insert into wall_posts (profile_id, author_id, anonymous, body)
  values (p_profile, case when p_anonymous then null else auth.uid() end, coalesce(p_anonymous, false), trim(p_body))
  returning * into w;
  if p_anonymous then
    insert into anon_authors (kind, item_id, author_id) values ('wall', w.id, auth.uid());
  end if;
  return w;
end $$;

-- Opens (or reuses) a 1:1 conversation. Anonymous: the caller is hidden from the other side.
create or replace function start_dm(p_user uuid, p_anonymous boolean default false)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  target profiles;
  conv_id bigint;
  key text;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  if p_user = auth.uid() then raise exception 'אי אפשר לפתוח שיחה עם עצמך'; end if;
  select * into target from profiles where id = p_user and status = 'active';
  if not found then raise exception 'המשתמש לא נמצא'; end if;

  if coalesce(p_anonymous, false) then
    if not target.accept_anonymous then
      raise exception 'המשתמש לא מקבל הודעות אנונימיות' using errcode = '42501';
    end if;
    select c.id into conv_id
      from dm_conversations c
      join dm_participants me on me.conversation_id = c.id and me.user_id = auth.uid() and me.hidden
      join dm_participants other on other.conversation_id = c.id and other.user_id = p_user
     where c.anonymous
     limit 1;
    if conv_id is null then
      insert into dm_conversations (anonymous) values (true) returning id into conv_id;
      insert into dm_participants (conversation_id, user_id, hidden)
        values (conv_id, auth.uid(), true), (conv_id, p_user, false);
    end if;
  else
    key := least(auth.uid()::text, p_user::text) || ':' || greatest(auth.uid()::text, p_user::text);
    select id into conv_id from dm_conversations where pair_key = key;
    if conv_id is null then
      insert into dm_conversations (anonymous, pair_key) values (false, key)
        on conflict (pair_key) do nothing
        returning id into conv_id;
      if conv_id is null then
        select id into conv_id from dm_conversations where pair_key = key;
      else
        insert into dm_participants (conversation_id, user_id) values (conv_id, auth.uid()), (conv_id, p_user);
      end if;
    end if;
  end if;
  return conv_id;
end $$;

create or replace function send_dm(p_conv bigint, p_body text)
returns dm_messages
language plpgsql security definer set search_path = public as $$
declare
  me dm_participants;
  c dm_conversations;
  m dm_messages;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  select * into me from dm_participants where conversation_id = p_conv and user_id = auth.uid();
  if not found then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  select * into c from dm_conversations where id = p_conv;
  if c.closed then raise exception 'השיחה נחסמה על ידי הנמען' using errcode = '42501'; end if;
  insert into dm_messages (conversation_id, sender_id, body)
  values (p_conv, case when me.hidden then null else auth.uid() end, trim(p_body))
  returning * into m;
  update dm_conversations set last_message_at = m.created_at where id = p_conv;
  update dm_participants set last_read_at = m.created_at where conversation_id = p_conv and user_id = auth.uid();
  return m;
end $$;

create or replace function mark_dm_read(p_conv bigint) returns void
language sql security definer set search_path = public as $$
  update dm_participants set last_read_at = now() where conversation_id = p_conv and user_id = auth.uid();
$$;

-- The visible recipient of an anonymous conversation may block / unblock it.
create or replace function set_dm_closed(p_conv bigint, p_closed boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from dm_participants p join dm_conversations c on c.id = p.conversation_id
                 where p.conversation_id = p_conv and p.user_id = auth.uid() and not p.hidden and c.anonymous) then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  update dm_conversations set closed = p_closed where id = p_conv;
end $$;

-- Sidebar list. other_id is null when the other side is anonymous.
create or replace function my_conversations()
returns table (id bigint, anonymous boolean, i_am_hidden boolean, other_id uuid, closed boolean,
               last_message_at timestamptz, last_body text, last_from_me boolean, unread int)
language sql stable security definer set search_path = public as $$
  select c.id, c.anonymous, me.hidden,
         case when other.hidden then null else other.user_id end,
         c.closed, c.last_message_at,
         lm.body,
         case when lm.id is null then null
              else coalesce(lm.sender_id = auth.uid(), false) or (lm.sender_id is null and me.hidden) end,
         (select count(*)::int from dm_messages m
           where m.conversation_id = c.id and m.created_at > me.last_read_at and not m.deleted
             and not (coalesce(m.sender_id = auth.uid(), false) or (m.sender_id is null and me.hidden)))
    from dm_participants me
    join dm_conversations c on c.id = me.conversation_id
    join dm_participants other on other.conversation_id = c.id and other.user_id <> me.user_id
    left join lateral (select m.id, m.sender_id, case when m.deleted then '' else m.body end as body
                         from dm_messages m where m.conversation_id = c.id order by m.id desc limit 1) lm on true
   where me.user_id = auth.uid() and is_active()
   order by c.last_message_at desc;
$$;

-- Reputation: 5 per like received + 2 per thread + 1 per reply. Anonymous content never counts.
create or replace function member_stats()
returns table (id uuid, threads int, replies int, likes int, reputation int)
language sql stable security definer set search_path = public as $$
  select s.id, s.threads, s.replies, s.likes, s.likes * 5 + s.threads * 2 + s.replies
  from (
    select p.id,
      (select count(*)::int from threads t where t.author_id = p.id) as threads,
      (select count(*)::int from messages m where m.author_id = p.id and not m.deleted) as replies,
      ((select count(*) from reactions r join messages m on m.id = r.message_id
         where m.author_id = p.id and not m.deleted)
       + (select count(*) from thread_likes l join threads t on t.id = l.thread_id
         where t.author_id = p.id))::int as likes
    from profiles p
    where p.status = 'active' and is_active()
  ) s;
$$;

revoke execute on function create_thread, post_message, post_wall, start_dm, send_dm, mark_dm_read,
  set_dm_closed, my_conversations, member_stats from anon, public;
grant execute on function create_thread, post_message, post_wall, start_dm, send_dm, mark_dm_read,
  set_dm_closed, my_conversations, member_stats to authenticated;

-- ---------- Row Level Security ----------
alter table profiles         enable row level security;
alter table channels         enable row level security;
alter table threads          enable row level security;
alter table messages         enable row level security;
alter table reactions        enable row level security;
alter table thread_likes     enable row level security;
alter table thread_reads     enable row level security;
alter table anon_authors     enable row level security;
alter table wall_posts       enable row level security;
alter table dm_conversations enable row level security;
alter table dm_participants  enable row level security;
alter table dm_messages      enable row level security;

-- profiles
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select
  using (id = auth.uid() or is_active());
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update
  using (id = auth.uid() or is_admin());

-- spaces
drop policy if exists channels_select on channels;
create policy channels_select on channels for select using (is_active());
drop policy if exists channels_admin on channels;
create policy channels_admin on channels for all using (is_admin()) with check (is_admin());

-- threads (created via create_thread only)
drop policy if exists threads_select on threads;
create policy threads_select on threads for select using (is_active());
drop policy if exists threads_insert on threads;
drop policy if exists threads_update on threads;
create policy threads_update on threads for update
  using (is_active() and (author_id = auth.uid() or owns_anon('thread', id) or is_mod()));
drop policy if exists threads_delete on threads;
-- Owners may delete only while nobody has replied; mods always.
create policy threads_delete on threads for delete
  using (is_active() and (((author_id = auth.uid() or owns_anon('thread', id)) and message_count = 0) or is_mod()));

-- replies (created via post_message only)
drop policy if exists messages_select on messages;
create policy messages_select on messages for select using (is_active());
drop policy if exists messages_insert on messages;
drop policy if exists messages_update on messages;
create policy messages_update on messages for update
  using (is_active() and (author_id = auth.uid() or owns_anon('message', id) or is_mod()));

-- likes (not on your own content)
drop policy if exists reactions_select on reactions;
create policy reactions_select on reactions for select using (is_active());
drop policy if exists reactions_insert on reactions;
create policy reactions_insert on reactions for insert with check (
  is_active() and user_id = auth.uid()
  and not exists (select 1 from messages m where m.id = message_id and m.author_id = auth.uid())
  and not owns_anon('message', message_id)
);
drop policy if exists reactions_delete on reactions;
create policy reactions_delete on reactions for delete using (user_id = auth.uid());

drop policy if exists thread_likes_select on thread_likes;
create policy thread_likes_select on thread_likes for select using (is_active());
drop policy if exists thread_likes_insert on thread_likes;
create policy thread_likes_insert on thread_likes for insert with check (
  is_active() and user_id = auth.uid()
  and not exists (select 1 from threads t where t.id = thread_id and t.author_id = auth.uid())
  and not owns_anon('thread', thread_id)
);
drop policy if exists thread_likes_delete on thread_likes;
create policy thread_likes_delete on thread_likes for delete using (user_id = auth.uid());

-- thread_reads (private per user)
drop policy if exists thread_reads_own on thread_reads;
create policy thread_reads_own on thread_reads for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- anonymous authorship: each author sees only their own rows; written only by the functions above
drop policy if exists anon_authors_own on anon_authors;
create policy anon_authors_own on anon_authors for select using (author_id = auth.uid());

-- walls (created via post_wall only)
drop policy if exists wall_select on wall_posts;
create policy wall_select on wall_posts for select using (is_active());
drop policy if exists wall_delete on wall_posts;
create policy wall_delete on wall_posts for delete using (
  is_active() and (profile_id = auth.uid() or author_id = auth.uid() or owns_anon('wall', id) or is_mod())
);

-- direct conversations (private to participants; moderators cannot read them)
drop policy if exists dm_conv_select on dm_conversations;
create policy dm_conv_select on dm_conversations for select using (is_active() and is_dm_participant(id));
drop policy if exists dm_part_select on dm_participants;
create policy dm_part_select on dm_participants for select using (
  is_active() and (user_id = auth.uid() or (not hidden and is_dm_participant(conversation_id)))
);
drop policy if exists dm_msg_select on dm_messages;
create policy dm_msg_select on dm_messages for select using (is_active() and is_dm_participant(conversation_id));
drop policy if exists dm_msg_update on dm_messages;
create policy dm_msg_update on dm_messages for update using (
  is_active() and (sender_id = auth.uid() or (sender_id is null and is_hidden_in_dm(conversation_id)))
);

-- ---------- Realtime ----------
alter table reactions    replica identity full;
alter table thread_likes replica identity full;
alter table wall_posts   replica identity full;
do $$
declare t text;
begin
  foreach t in array array['messages', 'threads', 'reactions', 'thread_likes', 'profiles', 'wall_posts', 'dm_messages'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- Starter spaces (only if none exist) ----------
insert into channels (name, description, position, admin_only_post)
select * from (values
  ('הודעות', 'הודעות רשמיות מהנהלת הקהילה', 0, true),
  ('כללי', 'שיחה חופשית', 1, false),
  ('שאלות ועזרה', 'שאלות, בקשות ועזרה הדדית', 2, false)
) v(name, description, position, admin_only_post)
where not exists (select 1 from channels);
