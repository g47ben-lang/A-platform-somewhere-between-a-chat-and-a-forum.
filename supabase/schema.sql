-- =====================================================================
-- Community chat schema for Supabase (v4).
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Idempotent: safe to re-run. Upgrades v1/v2 installs in place without losing data
-- (v2 threads are converted into chat messages inside their room).
--
-- Model:
--   rooms (table `channels`): one main room (is_main) + small topic rooms members create
--   messages: flat live chat per room: quote-replies, emoji reactions, photos/videos, pins, stars
--   direct conversations (dm_*), optionally anonymous on the initiator's side
--   profile walls (public messages to a member, optionally anonymous)
--   reputation = reactions received from others * 5 + messages sent (anonymous content never counts)
--
-- Anonymity: anonymous rows store NO author id. The real author is kept in `anon_authors`,
-- readable only by that author. Anonymous DM initiators are hidden via dm_participants.hidden.
-- Admins decide per member who may SEND anonymously (profiles.can_send_anonymous) and who may
-- RECEIVE anonymous messages (profiles.accept_anonymous). Members cannot change these.
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
alter table profiles add column if not exists can_send_anonymous boolean not null default true;
alter table profiles add column if not exists avatar_path text;  -- private bucket "media", a/<uuid>.<ext>
alter table profiles drop constraint if exists profiles_avatar_path;
alter table profiles add constraint profiles_avatar_path
  check (avatar_path is null or avatar_path ~ '^a/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$');
alter table profiles drop constraint if exists profiles_bio_len;
alter table profiles add constraint profiles_bio_len check (char_length(bio) <= 500);

-- ---------- Rooms ----------
create table if not exists channels (
  id               bigint generated always as identity primary key,
  name             text not null check (char_length(name) between 1 and 60),
  description      text check (char_length(description) <= 300),
  position         int  not null default 0,
  admin_only_post  boolean not null default false,  -- announcement rooms: only mods write
  created_at       timestamptz not null default now()
);
alter table channels add column if not exists is_main boolean not null default false;
alter table channels add column if not exists created_by uuid references profiles on delete set null;
alter table channels add column if not exists last_message_at timestamptz not null default now();
create unique index if not exists channels_one_main on channels (is_main) where is_main;

-- ---------- Messages ----------
create table if not exists messages (
  id          bigint generated always as identity primary key,
  channel_id  bigint references channels on delete cascade,
  author_id   uuid   references profiles on delete cascade,  -- null when anonymous
  anonymous   boolean not null default false,
  reply_to    bigint references messages on delete set null,
  body        text   not null,
  deleted     boolean not null default false,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  constraint messages_body_len check (deleted or char_length(body) between 1 and 4000)
);
alter table messages add column if not exists channel_id bigint references channels on delete cascade;
alter table messages add column if not exists anonymous boolean not null default false;
alter table messages alter column author_id drop not null;
do $$ begin
  -- v1/v2 messages belonged to threads
  if exists (select 1 from information_schema.columns where table_name = 'messages' and column_name = 'thread_id') then
    alter table messages alter column thread_id drop not null;
  end if;
end $$;
alter table messages add column if not exists attachment jsonb;           -- {path,type,width,height,size,duration}
alter table messages add column if not exists forwarded boolean not null default false;
alter table messages add column if not exists pinned_at timestamptz;
alter table messages add column if not exists pinned_by uuid references profiles on delete set null;
alter table messages drop constraint if exists messages_body_len;
alter table messages add constraint messages_body_len
  check (deleted or (char_length(body) <= 4000 and (char_length(body) > 0 or attachment is not null)));
create index if not exists messages_channel_created_idx on messages (channel_id, created_at desc);
create index if not exists messages_author_idx on messages (author_id);

create table if not exists channel_reads (
  user_id       uuid   not null references profiles on delete cascade,
  channel_id    bigint not null references channels on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (user_id, channel_id)
);

-- ---------- Emoji reactions ----------
create table if not exists reactions (
  message_id  bigint not null references messages on delete cascade,
  user_id     uuid   not null references profiles on delete cascade,
  emoji       text   not null default '👍',
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);
-- v2/v3 stored a single "like"; it becomes 👍.
alter table reactions drop constraint if exists reactions_emoji_check;
alter table reactions drop constraint if exists reactions_like_only;
alter table reactions drop constraint if exists reactions_emoji_len;
update reactions r set emoji = '👍' where emoji = 'like'
  and not exists (select 1 from reactions x where x.message_id = r.message_id and x.user_id = r.user_id and x.emoji = '👍');
delete from reactions where emoji = 'like';
alter table reactions add constraint reactions_emoji_len check (char_length(emoji) between 1 and 16);
alter table reactions alter column emoji set default '👍';

-- Personal "starred" messages (rooms and private chats).
create table if not exists stars (
  user_id     uuid   not null references profiles on delete cascade,
  kind        text   not null check (kind in ('room', 'dm')),
  item_id     bigint not null,
  created_at  timestamptz not null default now(),
  primary key (user_id, kind, item_id)
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
alter table dm_messages add column if not exists reply_to bigint references dm_messages on delete set null;
alter table dm_messages add column if not exists attachment jsonb;
alter table dm_messages add column if not exists forwarded boolean not null default false;
alter table dm_messages drop constraint if exists dm_messages_body_len;
alter table dm_messages add constraint dm_messages_body_len
  check (deleted or (char_length(body) <= 4000 and (char_length(body) > 0 or attachment is not null)));

-- DM reactions. The anonymous (hidden) side reacts with user_id NULL, so a reaction never unmasks it.
create table if not exists dm_reactions (
  message_id  bigint not null references dm_messages on delete cascade,
  user_id     uuid   references profiles on delete cascade,
  hidden      boolean not null default false,
  emoji       text   not null check (char_length(emoji) between 1 and 16),
  created_at  timestamptz not null default now()
);
create unique index if not exists dm_reactions_unique on dm_reactions (message_id, emoji, coalesce(user_id::text, 'hidden'));

-- ---------- Main room + v2 thread migration ----------
do $$
begin
  if not exists (select 1 from channels where is_main) then
    update channels set is_main = true, name = 'הצ''אט הראשי', admin_only_post = false,
                        description = coalesce(description, 'השיחה של כל הקהילה')
     where id = (select id from channels order by (name = 'כללי') desc, admin_only_post, position, id limit 1);
    if not found then
      insert into channels (name, description, is_main) values ('הצ''אט הראשי', 'השיחה של כל הקהילה', true);
    end if;
  end if;
end $$;

-- Each v2 thread becomes a message in its room; its replies become quote-replies to it.
do $$
declare
  t record;
  new_id bigint;
begin
  if to_regclass('public.threads') is null then return; end if;
  alter table threads add column if not exists migrated_message_id bigint;
  alter table messages disable trigger user;
  for t in select * from threads where migrated_message_id is null order by created_at, id loop
    insert into messages (channel_id, author_id, anonymous, body, created_at)
    values (t.channel_id, t.author_id, coalesce((to_jsonb(t) ->> 'anonymous')::boolean, false),  -- v1 had no column
            left(coalesce(nullif(concat_ws(E'\n', t.title, t.body), ''), '.'), 4000), t.created_at)
    returning id into new_id;
    update anon_authors set kind = 'message', item_id = new_id where kind = 'thread' and item_id = t.id;
    if to_regclass('public.thread_likes') is not null then
      insert into reactions (message_id, user_id, emoji, created_at)
        select new_id, l.user_id, '👍', l.created_at from thread_likes l
         where l.thread_id = t.id and l.user_id is distinct from t.author_id
        on conflict do nothing;
    end if;
    update messages set channel_id = t.channel_id, reply_to = coalesce(reply_to, new_id), thread_id = null
     where thread_id = t.id;
    update threads set migrated_message_id = new_id where id = t.id;
  end loop;
  alter table messages enable trigger user;
end $$;

-- Anything still without a room (should not happen) goes to the main room; then enforce.
update messages set channel_id = (select id from channels where is_main) where channel_id is null;
alter table messages alter column channel_id set not null;
update channels c set last_message_at = coalesce((select max(created_at) from messages m where m.channel_id = c.id), c.created_at);

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

create or replace function can_send_anon() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active' and can_send_anonymous);
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

-- Attachments are files already uploaded to the private "media" bucket under a random name.
create or replace function valid_attachment(a jsonb) returns boolean
language sql immutable as $$
  select a is null or (
    jsonb_typeof(a) = 'object'
    and a ->> 'type' in ('image', 'video')
    and (a ->> 'path') ~ '^m/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$'
  );
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

-- Members edit their own name/bio. Only admins change role, status and anonymity permissions.
-- (auth.uid() is null when run from the SQL editor, which may change anything.)
create or replace function guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin() then
    new.role               := old.role;
    new.status             := old.status;
    new.accept_anonymous   := old.accept_anonymous;
    new.can_send_anonymous := old.can_send_anonymous;
  end if;
  if auth.uid() is not null and auth.uid() <> old.id then
    new.display_name := old.display_name;
    new.bio          := old.bio;
    new.avatar_path  := old.avatar_path;
  end if;
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists profiles_guard on profiles;
create trigger profiles_guard before update on profiles
  for each row execute function guard_profile_update();

-- Rooms: creators edit name/description; mods also set announcement mode; the main room is fixed.
create or replace function guard_channel_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.id         := old.id;
  new.created_at := old.created_at;
  if auth.uid() is not null then
    new.is_main    := old.is_main;
    new.created_by := old.created_by;
    if pg_trigger_depth() = 1 then new.last_message_at := old.last_message_at; end if;
    if not is_mod() then
      new.admin_only_post := old.admin_only_post;
      new.position        := old.position;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists channels_guard on channels;
create trigger channels_guard before update on channels
  for each row execute function guard_channel_update();

create or replace function guard_channel_delete() returns trigger
language plpgsql as $$
begin
  if old.is_main and auth.uid() is not null then
    raise exception 'אי אפשר למחוק את הצ''אט הראשי' using errcode = '42501';
  end if;
  return old;
end $$;

drop trigger if exists channels_guard_delete on channels;
create trigger channels_guard_delete before delete on channels
  for each row execute function guard_channel_delete();

-- Messages: owner edits body; soft delete wipes body; nothing else changes.
create or replace function guard_message_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_id  := old.author_id;
  new.anonymous  := old.anonymous;
  new.channel_id := old.channel_id;
  new.created_at := old.created_at;
  new.reply_to   := old.reply_to;
  new.forwarded  := old.forwarded;
  new.attachment := old.attachment;
  -- pins change only through set_message_pinned()
  if coalesce(current_setting('app.pinning', true), '') <> '1' and auth.uid() is not null then
    new.pinned_at := old.pinned_at;
    new.pinned_by := old.pinned_by;
  end if;
  if old.deleted then
    new.deleted := true;
    new.body := '';
    new.attachment := null;
  elsif new.deleted then
    new.body := '';
    new.attachment := null;
    new.pinned_at := null;
    new.pinned_by := null;
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
  new.reply_to        := old.reply_to;
  new.forwarded       := old.forwarded;
  new.attachment      := old.attachment;
  if old.deleted then
    new.deleted := true;
    new.body := '';
    new.attachment := null;
  elsif new.deleted then
    new.body := '';
    new.attachment := null;
  elsif new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end $$;

drop trigger if exists dm_messages_guard on dm_messages;
create trigger dm_messages_guard before update on dm_messages
  for each row execute function guard_dm_message_update();

-- Room activity timestamp (drives sidebar order and unread counts).
drop trigger if exists messages_bump on messages;
create or replace function bump_channel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update channels set last_message_at = new.created_at where id = new.channel_id;
  return new;
end $$;
create trigger messages_bump after insert on messages
  for each row execute function bump_channel();

-- ---------- Actions (all authored writes go through these) ----------
drop function if exists create_thread(bigint, text, text, boolean);
drop function if exists post_message(bigint, text, bigint, boolean);

create or replace function create_room(p_name text, p_description text default null)
returns channels
language plpgsql security definer set search_path = public as $$
declare
  c channels;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_name, ''))) = 0 then raise exception 'יש לתת שם לחדר'; end if;
  if (select count(*) from channels where created_by = auth.uid()) >= 20 and not is_mod() then
    raise exception 'הגעת למספר החדרים המרבי שאפשר לפתוח';
  end if;
  insert into channels (name, description, created_by, position)
  values (left(trim(p_name), 60), nullif(left(trim(coalesce(p_description, '')), 300), ''), auth.uid(),
          coalesce((select max(position) + 1 from channels), 0))
  returning * into c;
  return c;
end $$;

drop function if exists send_message(bigint, text, bigint, boolean);
create or replace function send_message(p_channel bigint, p_body text, p_reply_to bigint default null,
                                        p_anonymous boolean default false, p_attachment jsonb default null,
                                        p_forwarded boolean default false)
returns messages
language plpgsql security definer set search_path = public as $$
declare
  ch channels;
  m messages;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  select * into ch from channels where id = p_channel;
  if not found then raise exception 'החדר לא נמצא'; end if;
  if ch.admin_only_post and not is_mod() then
    raise exception 'רק מנהלים כותבים בחדר הזה' using errcode = '42501';
  end if;
  if coalesce(p_anonymous, false) and not can_send_anon() then
    raise exception 'אין לך הרשאה לשלוח הודעות אנונימיות' using errcode = '42501';
  end if;
  if not valid_attachment(p_attachment) then raise exception 'קובץ מצורף לא תקין'; end if;
  insert into messages (channel_id, author_id, anonymous, body, reply_to, attachment, forwarded)
  values (p_channel,
          case when p_anonymous then null else auth.uid() end,
          coalesce(p_anonymous, false),
          trim(coalesce(p_body, '')),
          (select id from messages where id = p_reply_to and channel_id = p_channel),
          p_attachment,
          coalesce(p_forwarded, false))
  returning * into m;
  if p_anonymous then
    insert into anon_authors (kind, item_id, author_id) values ('message', m.id, auth.uid());
  end if;
  insert into channel_reads (user_id, channel_id, last_read_at) values (auth.uid(), p_channel, m.created_at)
    on conflict (user_id, channel_id) do update set last_read_at = excluded.last_read_at;
  return m;
end $$;

-- Pin board of a room. Any member may pin; announcement rooms only by mods.
create or replace function set_message_pinned(p_message bigint, p_pinned boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  ch channels;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  select c.* into ch from channels c join messages m on m.channel_id = c.id where m.id = p_message and not m.deleted;
  if not found then raise exception 'ההודעה לא נמצאה'; end if;
  if ch.admin_only_post and not is_mod() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  perform set_config('app.pinning', '1', true);
  update messages
     set pinned_at = case when p_pinned then now() end,
         pinned_by = case when p_pinned then auth.uid() end
   where id = p_message;
  perform set_config('app.pinning', '', true);
end $$;

-- "Mark as unread from here": moves my read marker to just before the message.
create or replace function mark_room_unread(p_message bigint) returns void
language sql security definer set search_path = public as $$
  insert into channel_reads (user_id, channel_id, last_read_at)
  select auth.uid(), m.channel_id, m.created_at - interval '1 millisecond' from messages m where m.id = p_message and is_active()
  on conflict (user_id, channel_id) do update set last_read_at = excluded.last_read_at;
$$;

create or replace function mark_room_read(p_channel bigint) returns void
language sql security definer set search_path = public as $$
  insert into channel_reads (user_id, channel_id, last_read_at)
  select auth.uid(), p_channel, now() where is_active()
  on conflict (user_id, channel_id) do update set last_read_at = excluded.last_read_at;
$$;

-- Sidebar: every room with my unread count and a preview of the last message.
create or replace function my_rooms()
returns table (id bigint, name text, description text, is_main boolean, admin_only_post boolean,
               created_by uuid, last_message_at timestamptz, unread int,
               last_body text, last_author uuid, last_anonymous boolean)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.description, c.is_main, c.admin_only_post, c.created_by, c.last_message_at,
         (select count(*)::int from messages m
           where m.channel_id = c.id and not m.deleted
             and m.created_at > coalesce(r.last_read_at, me.created_at)
             and m.author_id is distinct from auth.uid()
             and not (m.anonymous and owns_anon('message', m.id))),
         lm.body, lm.author_id, lm.anonymous
    from channels c
    cross join (select created_at from profiles where id = auth.uid()) me
    left join channel_reads r on r.channel_id = c.id and r.user_id = auth.uid()
    left join lateral (select case when m.deleted then '' else m.body end as body, m.author_id, m.anonymous
                         from messages m where m.channel_id = c.id order by m.created_at desc, m.id desc limit 1) lm on true
   where is_active()
   order by c.is_main desc, c.last_message_at desc;
$$;

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
  if coalesce(p_anonymous, false) then
    if not can_send_anon() then raise exception 'אין לך הרשאה לשלוח הודעות אנונימיות' using errcode = '42501'; end if;
    if not target.accept_anonymous then raise exception 'המשתמש לא מקבל הודעות אנונימיות' using errcode = '42501'; end if;
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
    if not can_send_anon() then raise exception 'אין לך הרשאה לשלוח הודעות אנונימיות' using errcode = '42501'; end if;
    if not target.accept_anonymous then raise exception 'המשתמש לא מקבל הודעות אנונימיות' using errcode = '42501'; end if;
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

drop function if exists send_dm(bigint, text);
create or replace function send_dm(p_conv bigint, p_body text, p_reply_to bigint default null,
                                   p_attachment jsonb default null, p_forwarded boolean default false)
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
  if me.hidden then
    -- permissions are re-checked on every message, so an admin change applies to open chats too
    if not can_send_anon() then raise exception 'אין לך הרשאה לשלוח הודעות אנונימיות' using errcode = '42501'; end if;
    if not exists (select 1 from dm_participants p join profiles pr on pr.id = p.user_id
                   where p.conversation_id = p_conv and p.user_id <> auth.uid() and pr.accept_anonymous) then
      raise exception 'המשתמש לא מקבל הודעות אנונימיות' using errcode = '42501';
    end if;
  end if;
  if not valid_attachment(p_attachment) then raise exception 'קובץ מצורף לא תקין'; end if;
  insert into dm_messages (conversation_id, sender_id, body, reply_to, attachment, forwarded)
  values (p_conv, case when me.hidden then null else auth.uid() end, trim(coalesce(p_body, '')),
          (select id from dm_messages where id = p_reply_to and conversation_id = p_conv),
          p_attachment, coalesce(p_forwarded, false))
  returning * into m;
  update dm_conversations set last_message_at = m.created_at where id = p_conv;
  update dm_participants set last_read_at = m.created_at where conversation_id = p_conv and user_id = auth.uid();
  return m;
end $$;

-- Adds or removes my reaction on a private message (the hidden side stays anonymous).
create or replace function toggle_dm_reaction(p_message bigint, p_emoji text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  me dm_participants;
  removed int;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  select p.* into me from dm_participants p join dm_messages m on m.conversation_id = p.conversation_id
   where m.id = p_message and p.user_id = auth.uid();
  if not found then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  delete from dm_reactions
   where message_id = p_message and emoji = p_emoji
     and ((me.hidden and user_id is null and hidden) or (not me.hidden and user_id = auth.uid()));
  get diagnostics removed = row_count;
  if removed > 0 then return false; end if;
  insert into dm_reactions (message_id, user_id, hidden, emoji)
  values (p_message, case when me.hidden then null else auth.uid() end, me.hidden, p_emoji);
  return true;
end $$;

create or replace function mark_dm_unread(p_message bigint) returns void
language sql security definer set search_path = public as $$
  update dm_participants p set last_read_at = m.created_at - interval '1 millisecond'
    from dm_messages m where m.id = p_message and p.conversation_id = m.conversation_id and p.user_id = auth.uid();
$$;

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

-- Reputation: 5 per member who reacted to your message (not yourself) + 1 per message. Anonymous content never counts.
drop function if exists member_stats();
create function member_stats()
returns table (id uuid, messages int, likes int, reputation int)
language sql stable security definer set search_path = public as $$
  select s.id, s.messages, s.likes, s.likes * 5 + s.messages
  from (
    select p.id,
      (select count(*)::int from messages m where m.author_id = p.id and not m.deleted) as messages,
      (select count(distinct (r.message_id, r.user_id))::int from reactions r join messages m on m.id = r.message_id
        where m.author_id = p.id and not m.deleted and r.user_id <> p.id) as likes
    from profiles p
    where p.status = 'active' and is_active()
  ) s;
$$;

revoke execute on function create_room, send_message, mark_room_read, mark_room_unread, set_message_pinned, my_rooms,
  post_wall, start_dm, send_dm, toggle_dm_reaction, mark_dm_read, mark_dm_unread, set_dm_closed, my_conversations,
  member_stats from anon, public;
grant execute on function create_room, send_message, mark_room_read, mark_room_unread, set_message_pinned, my_rooms,
  post_wall, start_dm, send_dm, toggle_dm_reaction, mark_dm_read, mark_dm_unread, set_dm_closed, my_conversations,
  member_stats to authenticated;

-- ---------- Row Level Security ----------
alter table profiles         enable row level security;
alter table channels         enable row level security;
alter table messages         enable row level security;
alter table channel_reads    enable row level security;
alter table reactions        enable row level security;
alter table stars            enable row level security;
alter table dm_reactions     enable row level security;
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

-- rooms (created via create_room)
drop policy if exists channels_select on channels;
create policy channels_select on channels for select using (is_active());
drop policy if exists channels_admin on channels;
create policy channels_admin on channels for all using (is_admin()) with check (is_admin());
drop policy if exists channels_update_owner on channels;
create policy channels_update_owner on channels for update
  using (is_active() and (created_by = auth.uid() or is_mod()));
drop policy if exists channels_delete_owner on channels;
create policy channels_delete_owner on channels for delete
  using (is_active() and not is_main and (created_by = auth.uid() or is_mod()));

-- messages (created via send_message only)
drop policy if exists messages_select on messages;
create policy messages_select on messages for select using (is_active());
drop policy if exists messages_insert on messages;
drop policy if exists messages_update on messages;
create policy messages_update on messages for update
  using (is_active() and (author_id = auth.uid() or owns_anon('message', id) or is_mod()));

drop policy if exists channel_reads_own on channel_reads;
create policy channel_reads_own on channel_reads for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- likes (not on your own messages)
drop policy if exists reactions_select on reactions;
create policy reactions_select on reactions for select using (is_active());
drop policy if exists reactions_insert on reactions;
create policy reactions_insert on reactions for insert with check (is_active() and user_id = auth.uid());
drop policy if exists reactions_delete on reactions;
create policy reactions_delete on reactions for delete using (user_id = auth.uid());

drop policy if exists stars_own on stars;
create policy stars_own on stars for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- DM reactions: visible to the conversation; written only through toggle_dm_reaction()
drop policy if exists dm_reactions_select on dm_reactions;
create policy dm_reactions_select on dm_reactions for select using (
  is_active() and exists (select 1 from dm_messages m where m.id = message_id and is_dm_participant(m.conversation_id))
);

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

-- Legacy v2 tables stay as a read-only backup of pre-migration data.
do $$
declare t text;
begin
  foreach t in array array['threads', 'thread_likes', 'thread_reads'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table %I enable row level security', t);
      execute format('drop policy if exists threads_insert on %I', t);
      execute format('drop policy if exists threads_update on %I', t);
      execute format('drop policy if exists threads_delete on %I', t);
      execute format('drop policy if exists thread_likes_insert on %I', t);
      execute format('drop policy if exists thread_likes_delete on %I', t);
      execute format('drop policy if exists thread_reads_own on %I', t);
    end if;
  end loop;
end $$;

-- ---------- Realtime ----------
alter table reactions  replica identity full;
alter table wall_posts replica identity full;
alter table dm_reactions replica identity full;
do $$
declare t text;
begin
  foreach t in array array['messages', 'reactions', 'profiles', 'channels', 'wall_posts', 'dm_messages', 'dm_reactions'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- Media storage (photos, short videos) ----------
-- Private bucket: files are served only to approved members, through short-lived signed links.
-- File names are random and never include the uploader, so anonymous posts stay anonymous.
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;  -- plain Postgres (tests)
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('media', 'media', false, 20971520,
          array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime'])
  on conflict (id) do update
    set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  execute 'drop policy if exists media_read on storage.objects';
  execute $p$create policy media_read on storage.objects for select to authenticated
             using (bucket_id = 'media' and public.is_active())$p$;
  -- Admins and moderators may physically delete any stored photo or video.
  execute 'drop policy if exists media_delete on storage.objects';
  execute $p$create policy media_delete on storage.objects for delete to authenticated
             using (bucket_id = 'media' and public.is_mod())$p$;
  execute 'drop policy if exists media_upload on storage.objects';
  execute $p$create policy media_upload on storage.objects for insert to authenticated
             with check (bucket_id = 'media' and public.is_active()
                         and (name ~ '^m/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$'
                              or name ~ '^a/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'))$p$;
end $$;

-- ---------- Refresh the API ----------
-- Tell the Supabase REST API (PostgREST) to reload its schema cache now, so new functions are
-- available immediately instead of returning "function not found" for a while.
notify pgrst, 'reload schema';
