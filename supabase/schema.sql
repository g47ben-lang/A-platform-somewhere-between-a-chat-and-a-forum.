-- =====================================================================
-- Community chat/forum schema for Supabase.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Safe to re-run: every object is dropped/replaced idempotently where possible.
--
-- Model:  channels  ->  threads (topic with title + opening post)  ->  messages (live chat)
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

-- ---------- Tables ----------
create table if not exists profiles (
  id            uuid primary key references auth.users on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 40),
  status        member_status not null default 'pending',
  role          member_role   not null default 'member',
  created_at    timestamptz   not null default now()
);

create table if not exists channels (
  id               bigint generated always as identity primary key,
  name             text not null check (char_length(name) between 1 and 60),
  description      text check (char_length(description) <= 300),
  position         int  not null default 0,
  admin_only_post  boolean not null default false,  -- announcement channels: only mods open threads
  created_at       timestamptz not null default now()
);

create table if not exists threads (
  id                bigint generated always as identity primary key,
  channel_id        bigint not null references channels on delete cascade,
  author_id         uuid   not null references profiles on delete cascade,
  title             text   not null check (char_length(title) between 1 and 150),
  body              text   check (char_length(body) <= 8000),
  pinned            boolean not null default false,
  locked            boolean not null default false,
  message_count     int     not null default 0,
  created_at        timestamptz not null default now(),
  last_activity_at  timestamptz not null default now()
);
create index if not exists threads_channel_activity_idx on threads (channel_id, pinned desc, last_activity_at desc);

create table if not exists messages (
  id          bigint generated always as identity primary key,
  thread_id   bigint not null references threads on delete cascade,
  author_id   uuid   not null references profiles on delete cascade,
  reply_to    bigint references messages on delete set null,
  body        text   not null,
  deleted     boolean not null default false,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  constraint messages_body_len check (deleted or char_length(body) between 1 and 4000)
);
create index if not exists messages_thread_created_idx on messages (thread_id, id desc);

create table if not exists reactions (
  message_id  bigint not null references messages on delete cascade,
  user_id     uuid   not null references profiles on delete cascade,
  emoji       text   not null check (char_length(emoji) between 1 and 16),
  created_at  timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists thread_reads (
  user_id       uuid   not null references profiles on delete cascade,
  thread_id     bigint not null references threads on delete cascade,
  last_read_at  timestamptz not null default now(),
  primary key (user_id, thread_id)
);

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
  new.id := old.id;
  new.created_at := old.created_at;
  return new;
end $$;

drop trigger if exists profiles_guard on profiles;
create trigger profiles_guard before update on profiles
  for each row execute function guard_profile_update();

-- Non-mods may only edit title/body of their own thread.
create or replace function guard_thread_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_id  := old.author_id;
  new.created_at := old.created_at;
  -- Depth 1 = a direct user update (not the message-count trigger below).
  if pg_trigger_depth() = 1 and auth.uid() is not null then
    new.message_count    := old.message_count;
    new.last_activity_at := old.last_activity_at;
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

-- Messages: authors edit body; soft delete wipes body; nothing else changes.
create or replace function guard_message_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author_id  := old.author_id;
  new.thread_id  := old.thread_id;
  new.created_at := old.created_at;
  new.reply_to   := old.reply_to;
  if old.deleted then
    new.deleted := true;
    new.body := '';
  elsif new.deleted then
    new.body := '';
  elsif new.body is distinct from old.body then
    if auth.uid() is not null and auth.uid() <> old.author_id then
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

-- ---------- Row Level Security ----------
alter table profiles     enable row level security;
alter table channels     enable row level security;
alter table threads      enable row level security;
alter table messages     enable row level security;
alter table reactions    enable row level security;
alter table thread_reads enable row level security;

-- profiles
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select
  using (id = auth.uid() or is_active());
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update
  using (id = auth.uid() or is_admin());

-- channels
drop policy if exists channels_select on channels;
create policy channels_select on channels for select using (is_active());
drop policy if exists channels_admin on channels;
create policy channels_admin on channels for all using (is_admin()) with check (is_admin());

-- threads
drop policy if exists threads_select on threads;
create policy threads_select on threads for select using (is_active());
drop policy if exists threads_insert on threads;
create policy threads_insert on threads for insert with check (
  is_active() and author_id = auth.uid()
  and (is_mod() or not exists (select 1 from channels c where c.id = channel_id and c.admin_only_post))
);
drop policy if exists threads_update on threads;
create policy threads_update on threads for update
  using (is_active() and (author_id = auth.uid() or is_mod()));
drop policy if exists threads_delete on threads;
-- Authors may delete only while nobody has replied; mods always.
create policy threads_delete on threads for delete
  using (is_active() and ((author_id = auth.uid() and message_count = 0) or is_mod()));

-- messages
drop policy if exists messages_select on messages;
create policy messages_select on messages for select using (is_active());
drop policy if exists messages_insert on messages;
create policy messages_insert on messages for insert with check (
  is_active() and author_id = auth.uid()
  and (is_mod() or not exists (select 1 from threads t where t.id = thread_id and t.locked))
);
drop policy if exists messages_update on messages;
create policy messages_update on messages for update
  using (is_active() and (author_id = auth.uid() or is_mod()));

-- reactions
drop policy if exists reactions_select on reactions;
create policy reactions_select on reactions for select using (is_active());
drop policy if exists reactions_insert on reactions;
create policy reactions_insert on reactions for insert with check (is_active() and user_id = auth.uid());
drop policy if exists reactions_delete on reactions;
create policy reactions_delete on reactions for delete using (user_id = auth.uid());

-- thread_reads (private per user)
drop policy if exists thread_reads_own on thread_reads;
create policy thread_reads_own on thread_reads for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Realtime ----------
alter table reactions replica identity full;
do $$
declare t text;
begin
  foreach t in array array['messages', 'threads', 'reactions', 'profiles'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- Starter channels (only if none exist) ----------
insert into channels (name, description, position, admin_only_post)
select * from (values
  ('הודעות', 'הודעות רשמיות מהנהלת הקהילה', 0, true),
  ('כללי', 'שיחה חופשית על הכל', 1, false),
  ('שאלות ועזרה', 'יש לך שאלה? כאן שואלים', 2, false)
) v(name, description, position, admin_only_post)
where not exists (select 1 from channels);
