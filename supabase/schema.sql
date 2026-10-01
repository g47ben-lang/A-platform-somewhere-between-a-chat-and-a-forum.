-- =====================================================================
-- קובץ 1 מתוך 2: schema.sql — מבנה מסד הנתונים והרשאות. מריצים אחרי כל עדכון של האתר.
-- בטוח להריץ שוב ושוב: לא מוחק שום מידע.
-- Community chat schema for Supabase (latest version).
-- Run in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
-- Idempotent: safe to re-run. Upgrades v1/v2 installs in place without losing data
-- (v2 threads are converted into chat messages inside their room).
--
-- Model:
--   rooms (table `channels`): one main room (is_main) + small topic rooms members create
--   messages: flat live chat per room: quote-replies, emoji reactions, photos/videos, pins, stars
--   direct conversations (dm_*), optionally anonymous on the initiator's side
--   profile walls (public messages to a member, optionally anonymous)
--   reputation = likes received from others * 5 + messages sent (anonymous content never counts);
--   emoji reactions are expression only and do not count
--
-- Anonymity: anonymous rows store NO author id. The real author is kept in `anon_authors`,
-- readable by that author and by the site owner only. Anonymous DM initiators are hidden via
-- dm_participants.hidden.
-- Owner: one account (owner_email() below) is always an active admin that no one can demote or ban.
-- Only the owner can see who wrote anonymous content and read private conversations, for emergencies;
-- members are told so when they sign up and in the content rules. Other admins cannot.
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
-- Inspector: may delete any room message, wall post, photo or video; nothing else.
-- (Compared as text everywhere below: a value added in this same transaction cannot be used as a literal.)
alter type member_role add value if not exists 'inspector';

-- pgcrypto: reset_everything() checks the caller's own login password (already installed on Supabase).
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;


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
alter table profiles add column if not exists terms_accepted_at timestamptz;  -- NetFree content rules
alter table profiles add column if not exists cover_path text;  -- profile background image, c/<uuid>.jpg
alter table profiles drop constraint if exists profiles_cover_path;
alter table profiles add constraint profiles_cover_path check (cover_path is null or cover_path ~ '^c/[0-9a-f-]{36}\.jpg$');
-- How the account got in without waiting: 'email' (pre-approved email) or 'roster' (name on the yeshiva list).
-- Roster joins start with join_seen = false so the admin gets a heads-up.
alter table profiles add column if not exists joined_via text check (joined_via in ('email', 'roster'));
alter table profiles add column if not exists join_seen boolean not null default true;
-- Removed from the group (not banned): an admin set him back to pending. He keeps his account and content, sees
-- that he was removed, and an admin can let him in again from the waiting list. Set only by guard_profile_update().
alter table profiles add column if not exists removed_at timestamptz;
alter table profiles drop constraint if exists profiles_bio_len;
alter table profiles add constraint profiles_bio_len check (char_length(bio) <= 500);

-- Emails the admin approved in advance: signing up with one skips the waiting list. Nobody is notified.
create table if not exists preapproved_emails (
  email         text primary key check (email = lower(email)),
  display_name  text check (char_length(display_name) <= 40),
  added_by      uuid references profiles on delete set null,
  added_at      timestamptz not null default now(),
  used_at       timestamptz
);

-- The yeshiva's list of students, written surname first ("כהן יוסף", "בן-דוד נחום"). Signing up with a name
-- on it (any word order, hyphen or space, with or without ו/י) lets the account in at once, once per name on
-- the list, and the admin is told.
create table if not exists roster (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(name) between 2 and 60),
  tokens      text[] not null,
  claimed_by  uuid references profiles on delete set null,
  claimed_at  timestamptz,
  added_by    uuid references profiles on delete set null,
  added_at    timestamptz not null default now()
);
alter table roster add column if not exists surname text[] not null default '{}';  -- tokens of the first word
create index if not exists roster_tokens_idx on roster using gin (tokens);

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

-- ---------- Polls ----------
-- A member opens a poll; it is announced by a message in a room (messages.poll_id) and answered on its page.
-- Votes are private: members see only totals, never who voted for what.
create table if not exists polls (
  id          bigint generated always as identity primary key,
  author_id   uuid references profiles on delete cascade,
  question    text not null check (char_length(question) between 1 and 300),
  multi       boolean not null default false,  -- more than one answer allowed
  closed      boolean not null default false,
  created_at  timestamptz not null default now()
);
create table if not exists poll_options (
  id        bigint generated always as identity primary key,
  poll_id   bigint not null references polls on delete cascade,
  position  int not null,
  label     text not null check (char_length(label) between 1 and 100)
);
create index if not exists poll_options_poll_idx on poll_options (poll_id, position);
create table if not exists poll_votes (
  poll_id    bigint not null references polls on delete cascade,
  option_id  bigint not null references poll_options on delete cascade,
  user_id    uuid   not null references profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, option_id, user_id)
);
alter table messages add column if not exists poll_id bigint references polls on delete set null;
alter table messages add column if not exists system boolean not null default false;  -- automatic (birthdays); no author
alter table messages add column if not exists gag boolean not null default false;     -- made with the news-flash maker
-- A news flash posted as text (not an image, so filters like NetFree don't hold it for review):
-- {"t": "flash"|"quote"|"notice"|"qa", "title": ..., "text": ..., "sign": ...}. Set only by send_flash().
alter table messages add column if not exists flash jsonb;

-- Special-purpose rooms created by this file (e.g. 'blessings': מזל טוב וברכות).
alter table channels add column if not exists purpose text;
create unique index if not exists channels_purpose on channels (purpose) where purpose is not null;
insert into channels (name, description, purpose, position)
select 'מזל טוב וברכות', 'ברכות לשמחות: אירוסין, חתונות, בר מצווה ועוד. אפשר לשבץ את השמחה בלוח האירועים.', 'blessings',
       coalesce((select max(position) + 1 from channels), 0)
 where not exists (select 1 from channels where purpose = 'blessings');

-- ---------- פינת החבר'ה: anonymous confessions & "who said it?" ----------
-- Confessions ("אף פעם לא…") are always anonymous: the author sits in anon_authors (kind 'confession').
create table if not exists confessions (
  id          bigint generated always as identity primary key,
  body        text not null check (char_length(body) between 3 and 500),
  created_at  timestamptz not null default now()
);
create table if not exists confession_reactions (
  confession_id  bigint not null references confessions on delete cascade,
  user_id        uuid   not null references profiles on delete cascade,
  emoji          text   not null check (emoji in ('😂', '😱', '🙈', '👏', '🤯', '🫡')),
  primary key (confession_id, user_id, emoji)
);
create table if not exists confession_comments (
  id             bigint generated always as identity primary key,
  confession_id  bigint not null references confessions on delete cascade,
  author_id      uuid   not null references profiles on delete cascade,
  body           text   not null check (char_length(body) between 1 and 300),
  created_at     timestamptz not null default now()
);

-- "Who said it?": a member grabs a chat line; others guess its author among 4 names for points.
-- The answer is readable only through the functions below (after guessing, or when the quiz closes).
create table if not exists quote_quizzes (
  id          bigint generated always as identity primary key,
  message_id  bigint unique references messages on delete set null,
  quote       text not null,
  author_id   uuid not null references profiles on delete cascade,
  grabbed_by  uuid references profiles on delete set null,
  options     uuid[] not null,
  created_at  timestamptz not null default now(),
  closes_at   timestamptz not null default now() + interval '3 days'
);
create table if not exists quiz_guesses (
  quiz_id     bigint not null references quote_quizzes on delete cascade,
  user_id     uuid   not null references profiles on delete cascade,
  guess       uuid   not null,
  correct     boolean not null,
  created_at  timestamptz not null default now(),
  primary key (quiz_id, user_id)
);

-- ---------- Moderation: reports and temporary muting ----------
create table if not exists message_reports (
  id           bigint generated always as identity primary key,
  message_id   bigint not null references messages on delete cascade,
  reporter_id  uuid not null references profiles on delete cascade,
  reason       text check (char_length(reason) <= 300),
  status       text not null default 'open' check (status in ('open', 'handled')),
  handled_by   uuid references profiles on delete set null,
  handled_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (message_id, reporter_id)
);
-- A muted member reads but cannot write. muted_until is public (the profile shows "מורחק");
-- who muted him and why sit in mute_log, which only moderators read.
alter table profiles add column if not exists muted_until timestamptz;
create table if not exists mute_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles on delete cascade,
  muted_by    uuid references profiles on delete set null,
  reason      text check (char_length(reason) <= 300),
  until       timestamptz not null,
  created_at  timestamptz not null default now()
);

-- ---------- Scheduled messages & muted rooms ----------
create table if not exists scheduled_messages (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles on delete cascade,
  channel_id  bigint not null references channels on delete cascade,
  body        text not null check (char_length(body) between 1 and 4000),
  send_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  error       text
);
create index if not exists scheduled_due_idx on scheduled_messages (send_at) where sent_at is null;
create table if not exists room_mutes (
  user_id     uuid not null references profiles on delete cascade,
  channel_id  bigint not null references channels on delete cascade,
  primary key (user_id, channel_id)
);

-- ---------- Push notifications (installed app / browser, even when the site is closed) ----------
create table if not exists push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references profiles on delete cascade,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
create table if not exists push_prefs (
  user_id     uuid primary key references profiles on delete cascade,
  on_dm       boolean not null default true,
  on_mention  boolean not null default true,
  on_reply    boolean not null default true,
  on_poll     boolean not null default false,
  no_shabbat  boolean not null default true
);
create table if not exists push_queue (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles on delete cascade,
  ref         text not null,
  title       text not null,
  body        text not null default '',
  link        text not null default '',
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create unique index if not exists push_queue_unique on push_queue (user_id, ref);
-- VAPID keys, created by the "send-push" Edge Function on its first run. Never readable by members.
create table if not exists push_config (
  id           int primary key default 1 check (id = 1),
  public_key   text not null,
  private_key  text not null
);

-- ---------- Events calendar ----------
-- Anyone adds yeshiva events. A new event that duplicates or contradicts an existing one (same name on another
-- date, or a similar name on the same date) is saved as 'conflict': the original's author may accept the new
-- date, let the other member edit, or pass it to the admins, who decide.
create table if not exists events (
  id             bigint generated always as identity primary key,
  title          text not null check (char_length(title) between 2 and 100),
  description    text check (char_length(description) <= 500),
  starts_on      date not null,
  ends_on        date check (ends_on is null or ends_on >= starts_on),
  kind           text not null default 'yeshiva' check (kind in ('yeshiva', 'vaad', 'simcha', 'other')),
  created_by     uuid references profiles on delete set null,
  editors        uuid[] not null default '{}',
  message_id     bigint references messages on delete set null,
  status         text not null default 'approved' check (status in ('approved', 'conflict')),
  conflict_with  bigint references events on delete set null,
  escalated      boolean not null default false,   -- passed to the admins
  created_at     timestamptz not null default now()
);
create index if not exists events_starts_idx on events (starts_on);

-- ---------- Hebrew birthdays ----------
-- Private: only the member reads his own row. A greeting is posted in the main room on his Hebrew birthday.
create table if not exists birthdays (
  user_id       uuid primary key references profiles on delete cascade,
  birth_date    date not null check (birth_date >= date '1900-01-01'),
  after_sunset  boolean not null default false,  -- born after sunset: the Hebrew date is the next day
  show_profile  boolean not null default true,   -- show the Hebrew day and month (never the year) on the profile
  announce      boolean not null default true    -- post a greeting in the main room
);
create table if not exists birthday_posts (
  user_id  uuid not null references profiles on delete cascade,
  hyear    int  not null,
  primary key (user_id, hyear)
);

-- ---------- Nicknames ----------
-- Members propose nicknames for each other and vote; the top one shows on the profile. Proposers stay hidden.
create table if not exists nicknames (
  id           bigint generated always as identity primary key,
  target_id    uuid not null references profiles on delete cascade,
  nickname     text not null check (char_length(nickname) between 2 and 30),
  proposed_by  uuid references profiles on delete set null,
  created_at   timestamptz not null default now()
);
create unique index if not exists nicknames_unique on nicknames (target_id, lower(nickname));
create table if not exists nickname_votes (
  nickname_id  bigint not null references nicknames on delete cascade,
  user_id      uuid   not null references profiles on delete cascade,
  primary key (nickname_id, user_id)
);

-- ---------- Email notifications ----------
-- Each member chooses what to get by email and how often. Events are queued by triggers; the Edge Function
-- "send-emails" (supabase/functions/send-emails) takes due emails through email_batch() and sends them via Gmail.
create table if not exists email_prefs (
  user_id        uuid primary key references profiles on delete cascade,
  enabled        boolean not null default false,
  on_dm          boolean not null default true,
  dm_preview     boolean not null default true,   -- include the text of private messages
  on_mention     boolean not null default true,
  on_reply       boolean not null default true,   -- quote-replies to my messages
  on_poll        boolean not null default false,
  on_birthday    boolean not null default false,
  on_feedback    boolean not null default true,   -- the management answered my request
  on_nickname    boolean not null default true,   -- someone proposed a nickname for me
  rooms          bigint[] not null default '{}',  -- every message in these rooms
  frequency      text not null default 'instant' check (frequency in ('instant', 'hourly', 'daily')),
  delay_minutes  int  not null default 10 check (delay_minutes between 0 and 240),
  daily_hour     int  not null default 20 check (daily_hour between 0 and 23),
  only_unread    boolean not null default true,   -- skip what I already read on the site
  no_shabbat     boolean not null default true,
  quiet_from     int check (quiet_from between 0 and 23),
  quiet_to       int check (quiet_to between 0 and 23),
  max_per_day    int  not null default 20 check (max_per_day between 1 and 100),
  last_digest_at timestamptz
);
create table if not exists email_queue (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles on delete cascade,
  kind        text not null,
  ref         text not null,         -- one email per user per event, e.g. "msg:123"
  title       text not null,
  body        text not null default '',
  link        text not null default '',  -- relative to the site, e.g. "#/dm/5"
  channel_id  bigint,
  conv_id     bigint,
  ref_at      timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  claimed_at  timestamptz,
  attempts    int not null default 0,
  sent_at     timestamptz,
  delivered   boolean not null default false
);
create unique index if not exists email_queue_unique on email_queue (user_id, ref);
create index if not exists email_queue_pending on email_queue (user_id) where sent_at is null;

-- ---------- Contact the management ----------
-- Bug reports, suggestions and other requests. The sender sees his own requests and the reply; admins see all.
create table if not exists feedback (
  id          bigint generated always as identity primary key,
  author_id   uuid not null references profiles on delete cascade,
  kind        text not null check (kind in ('bug', 'idea', 'other')),
  body        text not null check (char_length(body) between 1 and 2000),
  status      text not null default 'open' check (status in ('open', 'done')),
  reply       text check (char_length(reply) <= 2000),
  replied_by  uuid references profiles on delete set null,
  replied_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists feedback_author_idx on feedback (author_id, id desc);
-- A request is a small conversation between the member and the management.
create table if not exists feedback_messages (
  id           bigint generated always as identity primary key,
  feedback_id  bigint not null references feedback on delete cascade,
  author_id    uuid references profiles on delete set null,
  from_admin   boolean not null default false,
  body         text not null check (char_length(body) between 1 and 2000),
  created_at   timestamptz not null default now()
);
create index if not exists feedback_messages_idx on feedback_messages (feedback_id, id);

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
  kind       text   not null,
  item_id    bigint not null,
  author_id  uuid   not null references profiles on delete cascade,
  primary key (kind, item_id)
);

alter table anon_authors drop constraint if exists anon_authors_kind_check;
alter table anon_authors add constraint anon_authors_kind_check check (kind in ('thread', 'message', 'wall', 'confession'));

-- Likes: a plain "like" on a room message, separate from emoji reactions, that builds the author's reputation.
-- First install of this table (upgrade from v4): earlier 👍 reactions from other members become likes.
do $$
begin
  if to_regclass('public.message_likes') is null then
    create table message_likes (
      message_id  bigint not null references messages on delete cascade,
      user_id     uuid   not null references profiles on delete cascade,
      created_at  timestamptz not null default now(),
      primary key (message_id, user_id)
    );
    insert into message_likes (message_id, user_id, created_at)
      select r.message_id, r.user_id, r.created_at
        from reactions r join messages m on m.id = r.message_id
       where r.emoji = '👍' and r.user_id is distinct from m.author_id
         and not exists (select 1 from anon_authors a where a.kind = 'message' and a.item_id = m.id and a.author_id = r.user_id)
      on conflict do nothing;
  end if;
end $$;

-- One-time cleanups, recorded so re-running this file never repeats them.
create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now());
alter table schema_migrations enable row level security;  -- no policies: invisible to the API
do $$
begin
  if not exists (select 1 from schema_migrations where name = 'v5_thumbs_to_likes') then
    -- 👍 reactions that became likes in v5 would otherwise show twice (emoji + like).
    delete from reactions r using message_likes l
     where r.emoji = '👍' and l.message_id = r.message_id and l.user_id = r.user_id;
    insert into schema_migrations (name) values ('v5_thumbs_to_likes');
  end if;
end $$;

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

-- Guest view (see site_settings below); defined here because functions above and below use it.
create table if not exists site_settings (
  id                int primary key default 1 check (id = 1),
  guest_view_until  timestamptz,
  guest_view_by     uuid references profiles on delete set null
);
create or replace function guest_view_open() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from site_settings where id = 1 and guest_view_until > now());
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

-- The site owner's login email. Signing up with it always makes an active admin.
create or replace function owner_email() returns text
language sql immutable as $$ select 'shmuelshmuel@gmail.com'::text $$;

create or replace function is_owner_id(p uuid) returns boolean
language sql stable security definer set search_path = public, auth as $$
  select exists (select 1 from auth.users where id = p and lower(email) = owner_email());
$$;

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select is_active() and is_owner_id(auth.uid());
$$;

-- Which member is the owner (shown as "מנהל-על"); null until he signs up.
create or replace function owner_profile_id() returns uuid
language sql stable security definer set search_path = public, auth as $$
  select u.id from auth.users u join profiles p on p.id = u.id
   where lower(u.email) = owner_email() and is_active() limit 1;
$$;

-- Admins, moderators and inspectors may delete any content in rooms and on walls.
create or replace function can_remove_content() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles
                 where id = auth.uid() and status = 'active' and role::text in ('inspector', 'moderator', 'admin'));
$$;

create or replace function is_muted() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and muted_until > now());
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

-- ---------- Hebrew calendar (Calendrical Calculations; months: Nisan = 1 … Adar = 12, Adar II = 13) ----------
create or replace function heb_leap(y int) returns boolean
language sql immutable as $$ select mod(7 * y + 1, 19) < 7 $$;

create or replace function heb_elapsed(y int) returns bigint
language sql immutable as $$
  select case when mod(3 * (d + 1), 7) < 3 then d + 1 else d end
    from (select m * 29 + (12084 + 13753 * m) / 25920 as d
            from (select (235 * y::bigint - 234) / 19 as m) a) b
$$;

-- RD (0001-01-01 = 1) of 1 Tishrei of year y.
create or replace function heb_new_year(y int) returns bigint
language plpgsql immutable as $$
declare
  e0 bigint := heb_elapsed(y - 1);
  e1 bigint := heb_elapsed(y);
  e2 bigint := heb_elapsed(y + 1);
begin
  return -1373427 + e1 + case when e2 - e1 = 356 then 2 when e1 - e0 = 382 then 1 else 0 end;
end $$;

-- Length of month m in a year of ylen days.
create or replace function heb_month_len(m int, y int, ylen int) returns int
language sql immutable as $$
  select case
    when m in (2, 4, 6, 10, 13) then 29
    when m = 12 and not heb_leap(y) then 29
    when m = 8 and mod(ylen, 10) <> 5 then 29
    when m = 9 and mod(ylen, 10) = 3 then 29
    else 30 end
$$;

create or replace function heb_month_days(m int, y int) returns int
language sql immutable as $$ select heb_month_len(m, y, (heb_new_year(y + 1) - heb_new_year(y))::int) $$;

-- Months of year y in calendar order (Tishrei first).
create or replace function heb_months(y int) returns int[]
language sql immutable as $$
  select case when heb_leap(y) then array[7,8,9,10,11,12,13,1,2,3,4,5,6] else array[7,8,9,10,11,12,1,2,3,4,5,6] end
$$;

create or replace function hebrew_date(p date, out hy int, out hm int, out hd int)
language plpgsql immutable as $$
declare
  rd bigint := p - date '0001-01-01' + 1;
  ny bigint;
  ylen int;
  m int;
  len int;
begin
  hy := floor((rd + 1373427) / (35975351 / 98496.0))::int + 1;
  ny := heb_new_year(hy);
  while ny > rd loop
    hy := hy - 1;
    ny := heb_new_year(hy);
  end loop;
  ylen := (heb_new_year(hy + 1) - ny)::int;
  while ny + ylen <= rd loop
    hy := hy + 1;
    ny := ny + ylen;
    ylen := (heb_new_year(hy + 1) - ny)::int;
  end loop;
  rd := rd - ny;  -- days since 1 Tishrei
  foreach m in array heb_months(hy) loop
    len := heb_month_len(m, hy, ylen);
    if rd < len then
      hm := m;
      hd := rd::int + 1;
      return;
    end if;
    rd := rd - len;
  end loop;
end $$;

-- "י"ב בחשון": Hebrew day (gematria) and month; adar_leap names Adar as Adar I.
create or replace function hebrew_label(m int, d int, adar_leap boolean default false) returns text
language sql immutable as $$
  select (array['א''','ב''','ג''','ד''','ה''','ו''','ז''','ח''','ט''','י''','י"א','י"ב','י"ג','י"ד','ט"ו','ט"ז','י"ז','י"ח','י"ט','כ''',
                'כ"א','כ"ב','כ"ג','כ"ד','כ"ה','כ"ו','כ"ז','כ"ח','כ"ט','ל''']::text[])[d]
         || ' ב' || case when m = 12 and adar_leap then 'אדר א''' else
            (array['ניסן','אייר','סיון','תמוז','אב','אלול','תשרי','חשון','כסלו','טבת','שבט','אדר','אדר ב''']::text[])[m] end
$$;

-- ---------- Triggers ----------

-- New auth user -> profile. First user ever becomes active admin.
-- Normalized words of a Hebrew name, for matching against the roster: order-free, hyphen = space,
-- punctuation/niqqud dropped, final letters folded, and ו/י dropped after a word's first letter
-- (so אהרון = אהרן, וייס = ויס).
create or replace function name_tokens(p text) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct t order by t), '{}')
  from (
    select case when length(w) > 1 then left(w, 1) || regexp_replace(substr(w, 2), '[וי]', '', 'g') else w end as t
    from regexp_split_to_table(
      translate(
        regexp_replace(regexp_replace(lower(coalesce(p, '')), '[-_־–—]', ' ', 'g'), '[^a-z0-9א-ת ]', '', 'g'),
        'ךםןףץ', 'כמנפצ'),
      '\s+') as w
    where w <> ''
  ) x
$$;

-- An unclaimed roster row for this name: every word typed must be in the roster name (so a missing second
-- first name is fine) and the surname must be among them, at least two words, the closest match first.
-- Locks the row.
create or replace function roster_match(p_name text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  tk text[] := name_tokens(p_name);
  rid bigint;
begin
  if cardinality(tk) < 2 then return null; end if;
  select id into rid from roster
   where claimed_by is null and tokens @> tk and tk @> surname and surname <> '{}'
   order by cardinality(tokens), id
   limit 1
   for update skip locked;
  return rid;
end $$;

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
  pre preapproved_emails;
  nm text;
  rid bigint;
  own boolean := lower(new.email) = owner_email();
begin
  select not exists (select 1 from profiles) into first_user;
  first_user := first_user or own;
  select * into pre from preapproved_emails where email = lower(new.email);
  nm := left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), pre.display_name, split_part(new.email, '@', 1)), 40);
  if own then
    nm := 'ss';
  elsif not first_user and pre.email is null then
    rid := roster_match(nm);
  end if;
  insert into profiles (id, display_name, status, role, terms_accepted_at, joined_via, join_seen)
  values (
    new.id,
    nm,
    case when first_user or pre.email is not null or rid is not null then 'active'::member_status else 'pending'::member_status end,
    case when first_user then 'admin'::member_role  else 'member'::member_role  end,
    case when new.raw_user_meta_data ? 'terms_accepted_at' then now() end,
    case when pre.email is not null then 'email' when rid is not null then 'roster' end,
    rid is null
  );
  if pre.email is not null then
    update preapproved_emails set used_at = now() where email = pre.email;
  end if;
  if rid is not null then
    update roster set claimed_by = new.id, claimed_at = now() where id = rid;
  end if;
  return new;
end $$;

-- The owner's address is not a real inbox, so it never needs email confirmation.
create or replace function confirm_owner_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if lower(new.email) = owner_email() then
    new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_confirm_owner on auth.users;
create trigger on_auth_user_confirm_owner before insert on auth.users
  for each row execute function confirm_owner_email();
update auth.users set email_confirmed_at = now() where lower(email) = owner_email() and email_confirmed_at is null;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Members edit their own name/bio. Only admins change role, status and anonymity permissions.
-- (auth.uid() is null when run from the SQL editor, which may change anything.)
create or replace function guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.muting', true), '') <> '1' and auth.uid() is not null then
    new.muted_until := old.muted_until;
  end if;
  -- The owner always stays an active admin.
  if auth.uid() is not null and is_owner_id(old.id) then
    new.role   := old.role;
    new.status := old.status;
  end if;
  if auth.uid() is not null and not is_admin() then
    new.role               := old.role;
    new.status             := old.status;
    new.accept_anonymous   := old.accept_anonymous;
    new.can_send_anonymous := old.can_send_anonymous;
    new.join_seen          := old.join_seen;
    new.joined_via         := old.joined_via;
  end if;
  if auth.uid() is not null and auth.uid() <> old.id then
    new.display_name := old.display_name;
    new.bio          := old.bio;
    new.avatar_path  := old.avatar_path;
    new.cover_path   := old.cover_path;
  end if;
  -- The content-rules acceptance can only be recorded (once, by the member, stamped now), never removed.
  if auth.uid() is not null then
    if old.terms_accepted_at is not null or auth.uid() <> old.id then
      new.terms_accepted_at := old.terms_accepted_at;
    elsif new.terms_accepted_at is not null then
      new.terms_accepted_at := now();
    end if;
  end if;
  -- Removal (active/banned -> pending by an admin) is stamped here; approving again clears it.
  if auth.uid() is not null then
    if new.status = 'pending' and old.status <> 'pending' then
      new.removed_at := now();
    elsif new.status = 'active' then
      new.removed_at := null;
    else
      new.removed_at := old.removed_at;
    end if;
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
    new.purpose    := old.purpose;
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
  new.poll_id    := old.poll_id;
  new.system     := old.system;
  new.gag        := old.gag;
  new.flash      := old.flash;
  -- pins change only through set_message_pinned()
  if coalesce(current_setting('app.pinning', true), '') <> '1' and auth.uid() is not null then
    new.pinned_at := old.pinned_at;
    new.pinned_by := old.pinned_by;
  end if;
  if old.deleted then
    new.deleted := true;
    new.body := '';
    new.attachment := null;
    new.flash := null;
  elsif new.deleted then
    new.body := '';
    new.attachment := null;
    new.flash := null;
    new.pinned_at := null;
    new.pinned_by := null;
  elsif old.flash is not null then
    new.body := old.body;  -- a news flash is not edited (its card is the flash column)
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
  if is_muted() then raise exception 'הושתקת זמנית ואינך יכול לכתוב כרגע' using errcode = '42501'; end if;
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
  if is_muted() then raise exception 'הושתקת זמנית ואינך יכול לכתוב כרגע' using errcode = '42501'; end if;
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

-- Opens a poll and announces it in a room (the main room by default) as a message from its author.
create or replace function create_poll(p_question text, p_options text[], p_multi boolean default false,
                                       p_channel bigint default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  ch channels;
  pid bigint;
  opts text[];
  i int;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  if is_muted() then raise exception 'הושתקת זמנית ואינך יכול לכתוב כרגע' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_question, ''))) = 0 then raise exception 'יש לכתוב שאלה'; end if;
  select array_agg(left(trim(o), 100) order by n) into opts
    from unnest(coalesce(p_options, '{}')) with ordinality as u(o, n) where trim(o) <> '';
  if coalesce(cardinality(opts), 0) < 2 or cardinality(opts) > 10 then raise exception 'סקר צריך בין 2 ל-10 תשובות'; end if;
  select * into ch from channels where id = coalesce(p_channel, (select id from channels where is_main));
  if not found then raise exception 'החדר לא נמצא'; end if;
  if ch.admin_only_post and not is_mod() then raise exception 'רק מנהלים כותבים בחדר הזה' using errcode = '42501'; end if;
  insert into polls (author_id, question, multi) values (auth.uid(), left(trim(p_question), 300), coalesce(p_multi, false))
    returning id into pid;
  for i in 1 .. cardinality(opts) loop
    insert into poll_options (poll_id, position, label) values (pid, i, opts[i]);
  end loop;
  insert into messages (channel_id, author_id, body, poll_id) values (ch.id, auth.uid(), 'סקר חדש: ' || left(trim(p_question), 300), pid);
  return pid;
end $$;

-- Replaces my answer. Single-choice polls take exactly one option.
create or replace function vote_poll(p_poll bigint, p_options bigint[]) returns void
language plpgsql security definer set search_path = public as $$
declare
  pl polls;
  n int;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  select * into pl from polls where id = p_poll;
  if not found then raise exception 'הסקר לא נמצא'; end if;
  if pl.closed then raise exception 'הסקר נסגר'; end if;
  select count(*) into n from poll_options where poll_id = p_poll and id = any(coalesce(p_options, '{}'));
  if n <> coalesce(cardinality(array(select distinct unnest(p_options))), 0) then raise exception 'תשובה לא תקינה'; end if;
  if n = 0 or (not pl.multi and n > 1) then raise exception 'יש לבחור תשובה אחת'; end if;
  delete from poll_votes where poll_id = p_poll and user_id = auth.uid();
  insert into poll_votes (poll_id, option_id, user_id) select p_poll, o, auth.uid() from (select distinct unnest(p_options) as o) x;
end $$;

-- Totals per option (who voted is never returned).
create or replace function poll_results(p_poll bigint)
returns table (option_id bigint, votes int, voters int)
language sql stable security definer set search_path = public as $$
  select o.id,
         (select count(*)::int from poll_votes v where v.option_id = o.id),
         (select count(distinct user_id)::int from poll_votes v where v.poll_id = p_poll)
    from poll_options o
   where o.poll_id = p_poll and (is_active() or guest_view_open())
   order by o.position;
$$;

-- Author or content removers close a poll (no more answers) or reopen it.
create or replace function set_poll_closed(p_poll bigint, p_closed boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from polls where id = p_poll and is_active() and (author_id = auth.uid() or can_remove_content())) then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  update polls set closed = p_closed where id = p_poll;
end $$;

create or replace function send_feedback(p_kind text, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  fid bigint;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 then raise exception 'יש לכתוב את הפנייה'; end if;
  if (select count(*) from feedback where author_id = auth.uid() and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'שלחת הרבה פניות בשעה האחרונה, נסה שוב מאוחר יותר';
  end if;
  insert into feedback (author_id, kind, body) values (auth.uid(), p_kind, left(trim(p_body), 2000)) returning id into fid;
  return fid;
end $$;

-- Admin: answer a request and/or mark it handled.
-- Continue a request's conversation: its author or any admin. A member's reply reopens it.
create or replace function feedback_post(p_feedback bigint, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare
  f feedback;
  admin_side boolean;
  r record;
begin
  select * into f from feedback where id = p_feedback;
  if not found or not is_active() or not (f.author_id = auth.uid() or is_admin()) then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 then raise exception 'ההודעה ריקה'; end if;
  admin_side := f.author_id <> auth.uid();
  insert into feedback_messages (feedback_id, author_id, from_admin, body)
  values (p_feedback, auth.uid(), admin_side, left(trim(p_body), 2000));
  if admin_side then
    perform queue_email(f.author_id, 'on_feedback', 'feedback', 'fbm:' || currval(pg_get_serial_sequence('feedback_messages', 'id')),
                        'הניהול כתב לך בפנייה', p_body, '#/contact');
    perform queue_push(f.author_id, 'on_dm', 'fbm:' || currval(pg_get_serial_sequence('feedback_messages', 'id')),
                       'הניהול כתב לך בפנייה', p_body, '#/contact');
  else
    update feedback set status = 'open' where id = p_feedback;
    for r in select id from profiles where role = 'admin' and status = 'active' and id <> auth.uid() loop
      perform queue_email(r.id, 'on_feedback', 'feedback', 'fbm:' || currval(pg_get_serial_sequence('feedback_messages', 'id')),
                          'תגובה חדשה בפנייה', p_body, '#/admin?tab=feedback');
      perform queue_push(r.id, 'on_dm', 'fbm:' || currval(pg_get_serial_sequence('feedback_messages', 'id')),
                         'תגובה חדשה בפנייה', p_body, '#/admin?tab=feedback');
    end loop;
  end if;
  perform push_kick();
end $$;

-- Admins: how many requests are waiting (sidebar badge).
create or replace function open_feedback_count() returns int
language sql stable security definer set search_path = public as $$
  select case when is_admin() then (select count(*)::int from feedback where status = 'open') else 0 end;
$$;

create or replace function reply_feedback(p_id bigint, p_reply text, p_done boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  update feedback
     set reply = coalesce(nullif(left(trim(coalesce(p_reply, '')), 2000), ''), reply),
         replied_by = case when nullif(trim(coalesce(p_reply, '')), '') is not null then auth.uid() else replied_by end,
         replied_at = case when nullif(trim(coalesce(p_reply, '')), '') is not null then now() else replied_at end,
         status = case when p_done then 'done' else 'open' end
   where id = p_id;
end $$;

-- Posts the day's Hebrew birthday greetings in the main room (Israel date; once per member per Hebrew year).
-- Idempotent: the site calls it on load and the email job calls it too.
create or replace function post_birthdays() returns int
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'Asia/Jerusalem')::date;
  t record;
  b record;
  bh record;
  tm int;
  td int;
  n int := 0;
  main bigint := (select id from channels where is_main);
begin
  if auth.uid() is not null and not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  select * into t from hebrew_date(today);
  for b in select x.*, p.display_name from birthdays x join profiles p on p.id = x.user_id
            where x.announce and p.status = 'active'
              and not exists (select 1 from birthday_posts bp where bp.user_id = x.user_id and bp.hyear = t.hy) loop
    select * into bh from hebrew_date(b.birth_date + case when b.after_sunset then 1 else 0 end);
    tm := case
      when bh.hm = 13 then case when heb_leap(t.hy) then 13 else 12 end
      when bh.hm = 12 and not heb_leap(bh.hy) and heb_leap(t.hy) then 13  -- plain Adar: Adar II in a leap year
      else bh.hm end;
    td := least(bh.hd, heb_month_days(tm, t.hy));
    continue when tm <> t.hm or td <> t.hd;
    insert into birthday_posts (user_id, hyear) values (b.user_id, t.hy) on conflict do nothing;
    continue when not found;
    insert into messages (channel_id, author_id, body, system)
    values (main, null, 'מזל טוב ל-@' || b.display_name || ' ליום הולדתו, ' || hebrew_label(t.hm, t.hd, heb_leap(t.hy))
                        || '! עד מאה ועשרים 🎂', true);
    n := n + 1;
  end loop;
  return n;
end $$;

-- A member's Hebrew birthday (day and month) for his profile, when he chose to show it.
create or replace function profile_birthday(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select hebrew_label(h.hm, h.hd, heb_leap(h.hy))
    from birthdays b, hebrew_date(b.birth_date + case when b.after_sunset then 1 else 0 end) h
   where b.user_id = p_user and b.show_profile and is_active();
$$;

create or replace function propose_nickname(p_target uuid, p_nickname text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  nm text := left(regexp_replace(trim(coalesce(p_nickname, '')), '\s+', ' ', 'g'), 30);
  nid bigint;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  if is_muted() then raise exception 'הושתקת זמנית ואינך יכול לכתוב כרגע' using errcode = '42501'; end if;
  if p_target = auth.uid() then raise exception 'אי אפשר להציע כינוי לעצמך'; end if;
  if not exists (select 1 from profiles where id = p_target and status = 'active') then raise exception 'המשתמש לא נמצא'; end if;
  if char_length(nm) < 2 then raise exception 'כינוי צריך לפחות 2 תווים'; end if;
  select id into nid from nicknames where target_id = p_target and lower(nickname) = lower(nm);
  if nid is null then
    if (select count(*) from nicknames where target_id = p_target and proposed_by = auth.uid()) >= 3 then
      raise exception 'אפשר להציע עד 3 כינויים לכל חבר';
    end if;
    insert into nicknames (target_id, nickname, proposed_by) values (p_target, nm, auth.uid()) returning id into nid;
  end if;
  insert into nickname_votes (nickname_id, user_id) values (nid, auth.uid()) on conflict do nothing;
  return nid;
end $$;

create or replace function toggle_nickname_vote(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not is_active() or not exists (select 1 from nicknames where id = p_id) then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  delete from nickname_votes where nickname_id = p_id and user_id = auth.uid();
  if found then return false; end if;
  insert into nickname_votes (nickname_id, user_id) values (p_id, auth.uid());
  return true;
end $$;

-- The member himself, the proposer, or content removers take a nickname down.
create or replace function remove_nickname(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from nicknames where id = p_id and is_active()
                 and (target_id = auth.uid() or proposed_by = auth.uid() or can_remove_content())) then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  delete from nicknames where id = p_id;
end $$;

-- Nicknames of a member, most votes first. Who proposed is never returned.
create or replace function nickname_list(p_target uuid)
returns table (id bigint, nickname text, votes int, i_voted boolean, mine boolean)
language sql stable security definer set search_path = public as $$
  select n.id, n.nickname,
         (select count(*)::int from nickname_votes v where v.nickname_id = n.id),
         exists (select 1 from nickname_votes v where v.nickname_id = n.id and v.user_id = auth.uid()),
         n.proposed_by = auth.uid()
    from nicknames n
   where n.target_id = p_target and is_active()
   order by 3 desc, n.created_at;
$$;

-- ---------- News flash (מבזק) ----------
-- Members with this much reputation (or content removers) may post images made with the news-flash maker.
create or replace function gag_min_reputation() returns int language sql immutable as $$ select 50 $$;

create or replace function my_reputation() returns int
language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce((select reputation from member_stats() where id = auth.uid()), 0);
end $$;

create or replace function send_gag(p_channel bigint, p_attachment jsonb, p_caption text default '')
returns messages
language plpgsql security definer set search_path = public as $$
declare
  ch channels;
  m messages;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  if is_muted() then raise exception 'הושתקת זמנית ואינך יכול לכתוב כרגע' using errcode = '42501'; end if;
  if my_reputation() < gag_min_reputation() and not can_remove_content() then
    raise exception 'מחולל המבזקים פתוח מ-% נקודות מוניטין', gag_min_reputation() using errcode = '42501';
  end if;
  if p_attachment is null or not valid_attachment(p_attachment) or p_attachment ->> 'type' <> 'image' then
    raise exception 'קובץ מצורף לא תקין';
  end if;
  select * into ch from channels where id = p_channel;
  if not found then raise exception 'החדר לא נמצא'; end if;
  if ch.admin_only_post and not is_mod() then raise exception 'רק מנהלים כותבים בחדר הזה' using errcode = '42501'; end if;
  insert into messages (channel_id, author_id, body, attachment, gag)
  values (p_channel, auth.uid(), left(trim(coalesce(p_caption, '')), 4000), p_attachment, true)
  returning * into m;
  return m;
end $$;

-- A news flash as text: same rules as send_gag(), but no image (filters don't hold it for review).
create or replace function send_flash(p_channel bigint, p_template text, p_title text, p_text text, p_sign text default '')
returns messages
language plpgsql security definer set search_path = public as $$
declare
  ch channels;
  m messages;
  t text := coalesce(nullif(trim(p_title), ''), 'מבזק');
  x text := trim(coalesce(p_text, ''));
  g text := trim(coalesce(p_sign, ''));
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  if is_muted() then raise exception 'הושתקת זמנית ואינך יכול לכתוב כרגע' using errcode = '42501'; end if;
  if my_reputation() < gag_min_reputation() and not can_remove_content() then
    raise exception 'מחולל המבזקים פתוח מ-% נקודות מוניטין', gag_min_reputation() using errcode = '42501';
  end if;
  if p_template not in ('flash', 'quote', 'notice', 'qa') then raise exception 'תבנית לא מוכרת'; end if;
  if char_length(x) not between 1 and 400 or char_length(t) > 200 or char_length(g) > 40 then raise exception 'הטקסט ארוך מדי או ריק'; end if;
  select * into ch from channels where id = p_channel;
  if not found then raise exception 'החדר לא נמצא'; end if;
  if ch.admin_only_post and not is_mod() then raise exception 'רק מנהלים כותבים בחדר הזה' using errcode = '42501'; end if;
  insert into messages (channel_id, author_id, body, gag, flash)
  values (p_channel, auth.uid(), left(t || E'\n' || x || case when g <> '' then E'\n' || g else '' end, 4000), true,
          jsonb_build_object('t', p_template, 'title', t, 'text', x, 'sign', g))
  returning * into m;
  return m;
end $$;

-- Recent news flashes (text ones) from every room, for the strip in the main room's banner.
create or replace function recent_flashes(p_limit int default 30)
returns table (id bigint, channel_id bigint, author_id uuid, flash jsonb, created_at timestamptz, likes int)
language sql stable security definer set search_path = public as $$
  select m.id, m.channel_id, m.author_id, m.flash, m.created_at,
         (select count(*)::int from message_likes l where l.message_id = m.id)
    from messages m
   where m.flash is not null and not m.deleted and (is_active() or guest_view_open())
   order by m.id desc limit least(greatest(p_limit, 1), 100);
$$;

-- The week's top image (photo, meme or news flash) and top quote, by likes (x2) and emoji reactions.
create or replace function weekly_highlights()
returns table (kind text, message_id bigint, channel_id bigint, author_id uuid, anonymous boolean, body text,
               attachment jsonb, score int)
language sql stable security definer set search_path = public as $$
  with scored as (
    select m.*, (select count(*) from message_likes l where l.message_id = m.id) * 2
              + (select count(*) from reactions r where r.message_id = m.id) as sc
      from messages m
     where m.created_at > now() - interval '7 days' and not m.deleted and not m.system and m.poll_id is null
       and (is_active() or guest_view_open())
  )
  (select 'image', id, channel_id, author_id, anonymous, body, attachment, sc::int from scored
    where attachment ->> 'type' = 'image' and sc >= 3 order by sc desc, id desc limit 1)
  union all
  (select 'quote', id, channel_id, author_id, anonymous, body, null, sc::int from scored
    where attachment is null and char_length(body) between 8 and 300 and sc >= 3 order by sc desc, id desc limit 1);
$$;

-- ---------- פינת החבר'ה: actions ----------
create or replace function post_confession(p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  cid bigint;
begin
  if is_muted() then raise exception 'הושתקת זמנית ואינך יכול לכתוב כרגע' using errcode = '42501'; end if;
  if not can_send_anon() then raise exception 'אין לך הרשאה לפרסם בעילום שם' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_body, ''))) < 3 then raise exception 'הווידוי קצר מדי'; end if;
  if (select count(*) from anon_authors a join confessions c on c.id = a.item_id
       where a.kind = 'confession' and a.author_id = auth.uid() and c.created_at > now() - interval '1 day') >= 5 then
    raise exception 'אפשר לפרסם עד 5 וידויים ביום';
  end if;
  insert into confessions (body) values (left(trim(p_body), 500)) returning id into cid;
  insert into anon_authors (kind, item_id, author_id) values ('confession', cid, auth.uid());
  return cid;
end $$;

create or replace function delete_confession(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_active() and (owns_anon('confession', p_id) or can_remove_content())) then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  delete from confessions where id = p_id;
  delete from anon_authors where kind = 'confession' and item_id = p_id;
end $$;

create or replace function grab_quote(p_message bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  m messages;
  opts uuid[];
  qid bigint;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  if is_muted() then raise exception 'הושתקת זמנית ואינך יכול לכתוב כרגע' using errcode = '42501'; end if;
  select * into m from messages where id = p_message;
  if not found or m.deleted or m.anonymous or m.system or m.author_id is null or char_length(m.body) < 5 then
    raise exception 'אי אפשר להעביר את ההודעה הזו';
  end if;
  if m.author_id = auth.uid() then raise exception 'אי אפשר להעביר הודעה שלך'; end if;
  if exists (select 1 from quote_quizzes where message_id = p_message) then raise exception 'ההודעה הזו כבר ב"מי אמר את זה?"'; end if;
  select array_agg(x order by random()) into opts from (
    select m.author_id as x
    union all
    (select p.id from profiles p where p.status = 'active' and p.id <> m.author_id and p.id <> auth.uid() order by random() limit 3)
  ) o;
  if cardinality(opts) < 3 then raise exception 'צריך עוד חברים פעילים כדי לשחק'; end if;
  insert into quote_quizzes (message_id, quote, author_id, grabbed_by, options)
  values (p_message, left(m.body, 400), m.author_id, auth.uid(), opts) returning id into qid;
  return qid;
end $$;

create or replace function guess_quote(p_quiz bigint, p_guess uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  q quote_quizzes;
  ok boolean;
begin
  select * into q from quote_quizzes where id = p_quiz;
  if not found or not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  if q.closes_at < now() then raise exception 'המשחק על הציטוט הזה נסגר'; end if;
  if auth.uid() in (q.author_id, q.grabbed_by) then raise exception 'אתה כבר יודע את התשובה'; end if;
  if not p_guess = any(q.options) then raise exception 'ניחוש לא תקין'; end if;
  ok := p_guess = q.author_id;
  insert into quiz_guesses (quiz_id, user_id, guess, correct) values (p_quiz, auth.uid(), p_guess, ok);
  return ok;
end $$;

-- Quizzes, newest first. The answer shows once I guessed, if I know it, or when the quiz is closed.
create or replace function quiz_list()
returns table (id bigint, quote text, options uuid[], grabbed_by uuid, created_at timestamptz, closes_at timestamptz,
               guesses int, correct_count int, my_guess uuid, answer uuid)
language sql stable security definer set search_path = public as $$
  select q.id, q.quote, q.options, q.grabbed_by, q.created_at, q.closes_at,
         (select count(*)::int from quiz_guesses g where g.quiz_id = q.id),
         (select count(*)::int from quiz_guesses g where g.quiz_id = q.id and g.correct),
         (select g.guess from quiz_guesses g where g.quiz_id = q.id and g.user_id = auth.uid()),
         case when q.closes_at < now() or auth.uid() in (q.author_id, q.grabbed_by)
                or exists (select 1 from quiz_guesses g where g.quiz_id = q.id and g.user_id = auth.uid())
              then q.author_id end
    from quote_quizzes q
   where is_active() or guest_view_open()
   order by q.created_at desc
   limit 100;
$$;

-- Points: 10 per correct guess.
create or replace function quiz_leaderboard()
returns table (user_id uuid, points int, correct int)
language sql stable security definer set search_path = public as $$
  select g.user_id, count(*)::int * 10, count(*)::int
    from quiz_guesses g join profiles p on p.id = g.user_id
   where g.correct and p.status = 'active' and (is_active() or guest_view_open())
   group by g.user_id order by 2 desc limit 10;
$$;

create or replace function delete_quiz(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from quote_quizzes where id = p_id and is_active()
                 and (grabbed_by = auth.uid() or author_id = auth.uid() or can_remove_content())) then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  delete from quote_quizzes where id = p_id;
end $$;

-- ---------- Moderation: actions ----------
create or replace function report_message(p_message bigint, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  if not exists (select 1 from messages where id = p_message and not deleted) then raise exception 'ההודעה לא נמצאה'; end if;
  insert into message_reports (message_id, reporter_id, reason)
  values (p_message, auth.uid(), nullif(left(trim(coalesce(p_reason, '')), 300), ''))
  on conflict (message_id, reporter_id) do update set reason = coalesce(excluded.reason, message_reports.reason), status = 'open';
end $$;

-- Admins settle a report: delete the message, or keep it. (Reports are for admins only.)
create or replace function handle_report(p_message bigint, p_delete boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  if p_delete then update messages set deleted = true where id = p_message; end if;
  update message_reports set status = 'handled', handled_by = auth.uid(), handled_at = now() where message_id = p_message;
end $$;

-- Open reports with the message, for admins only. Reporters are not shown.
create or replace function report_list()
returns table (message_id bigint, channel_id bigint, author_id uuid, anonymous boolean, body text, attachment jsonb,
               reports int, reasons text[], last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.channel_id, m.author_id, m.anonymous, m.body, m.attachment, count(*)::int,
         array_remove(array_agg(r.reason order by r.created_at), null), max(r.created_at)
    from message_reports r join messages m on m.id = r.message_id
   where r.status = 'open' and is_admin()
   group by m.id order by max(r.created_at) desc;
$$;

-- Admins and inspectors mute a member for a while (p_minutes null = until unmuted). Never admins or the owner.
create or replace function mute_member(p_user uuid, p_minutes int, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  t profiles;
  until timestamptz := case when p_minutes is null then 'infinity'::timestamptz else now() + make_interval(mins => p_minutes) end;
begin
  select * into t from profiles where id = p_user;
  if not found or not can_remove_content() or p_user = auth.uid() or t.role::text = 'admin' or is_owner_id(p_user) then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  perform set_config('app.muting', '1', true);
  update profiles set muted_until = until where id = p_user;
  perform set_config('app.muting', '', true);
  insert into mute_log (user_id, muted_by, reason, until) values (p_user, auth.uid(), nullif(left(trim(coalesce(p_reason, '')), 300), ''), until);
end $$;

create or replace function unmute_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_remove_content() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  perform set_config('app.muting', '1', true);
  update profiles set muted_until = null where id = p_user;
  perform set_config('app.muting', '', true);
end $$;

-- The muted member's own view: until when and why (never who).
create or replace function my_mute(out until timestamptz, out reason text)
language sql stable security definer set search_path = public as $$
  select p.muted_until, (select l.reason from mute_log l where l.user_id = p.id order by l.id desc limit 1)
    from profiles p where p.id = auth.uid() and p.muted_until > now();
$$;

-- ---------- Profile tags: "הראשון בבוקר" / "האחרון בלילה" ----------
-- The yeshiva day runs from 06:40 to 06:40 (Israel time). The first room message of a day earns
-- "the first in the morning"; the last one before 06:40 earns "the last at night". Anonymous and
-- automatic messages don't count.
create or replace function day_titles(p_user uuid)
returns table (first_count int, last_count int, first_now boolean, last_now boolean)
language sql stable security definer set search_path = public as $$
  with days as (
    select ((m.created_at at time zone 'Asia/Jerusalem') - interval '6 hours 40 minutes')::date as d,
           (array_agg(m.author_id order by m.created_at))[1] as first_by,
           (array_agg(m.author_id order by m.created_at desc))[1] as last_by
      from messages m
     where not m.anonymous and not m.system and not m.deleted and m.author_id is not null
       and m.created_at > now() - interval '400 days'
     group by 1
  ), today as (select ((now() at time zone 'Asia/Jerusalem') - interval '6 hours 40 minutes')::date as d)
  select (select count(*)::int from days where first_by = p_user),
         (select count(*)::int from days where last_by = p_user and d < (select d from today)),
         exists (select 1 from days, today where days.d = today.d and first_by = p_user),
         exists (select 1 from days, today where days.d = today.d - 1 and last_by = p_user)
   where is_active();
$$;

-- ---------- Statistics for admins ----------
create or replace function admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  il date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  if not is_admin() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  return jsonb_build_object(
    'members', (select count(*) from profiles where status = 'active'),
    'pending', (select count(*) from profiles where status = 'pending'),
    'muted', (select count(*) from profiles where muted_until > now()),
    'messages_today', (select count(*) from messages where (created_at at time zone 'Asia/Jerusalem')::date = il and not system),
    'messages_week', (select count(*) from messages where created_at > now() - interval '7 days' and not system),
    'dms_week', (select count(*) from dm_messages where created_at > now() - interval '7 days'),
    'writers_today', (select count(distinct coalesce(m.author_id, a.author_id)) from messages m
                        left join anon_authors a on a.kind = 'message' and a.item_id = m.id
                       where (m.created_at at time zone 'Asia/Jerusalem')::date = il and not m.system),
    'writers_week', (select count(distinct coalesce(m.author_id, a.author_id)) from messages m
                       left join anon_authors a on a.kind = 'message' and a.item_id = m.id
                      where m.created_at > now() - interval '7 days' and not m.system),
    'new_members_week', (select count(*) from profiles where created_at > now() - interval '7 days'),
    'open_reports', (select count(distinct message_id) from message_reports where status = 'open'),
    'per_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'count', c) order by d), '[]') from (
                  select g::date as d, (select count(*) from messages m where not m.system
                                         and (m.created_at at time zone 'Asia/Jerusalem')::date = g::date) as c
                    from generate_series(il - 13, il, interval '1 day') g) x),
    'top_rooms', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'count', c) order by c desc), '[]') from (
                    select ch.name, count(*) as c from messages m join channels ch on ch.id = m.channel_id
                     where m.created_at > now() - interval '7 days' and not m.system group by ch.name order by 2 desc limit 5) y)
  );
end $$;

-- ---------- Scheduled messages ----------
create or replace function schedule_message(p_channel bigint, p_body text, p_send_at timestamptz) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  ch channels;
  sid bigint;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  if is_muted() then raise exception 'הושתקת זמנית ואינך יכול לכתוב כרגע' using errcode = '42501'; end if;
  select * into ch from channels where id = p_channel;
  if not found then raise exception 'החדר לא נמצא'; end if;
  if ch.admin_only_post and not is_mod() then raise exception 'רק מנהלים כותבים בחדר הזה' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_body, ''))) = 0 then raise exception 'ההודעה ריקה'; end if;
  if p_send_at < now() + interval '1 minute' or p_send_at > now() + interval '60 days' then
    raise exception 'אפשר לתזמן מדקה ועד 60 יום קדימה';
  end if;
  if (select count(*) from scheduled_messages where user_id = auth.uid() and sent_at is null) >= 20 then
    raise exception 'אפשר לתזמן עד 20 הודעות';
  end if;
  insert into scheduled_messages (user_id, channel_id, body, send_at) values (auth.uid(), p_channel, left(trim(p_body), 4000), p_send_at)
  returning id into sid;
  return sid;
end $$;

-- Sends what is due, as its author (with the author's current permissions). Called every minute by
-- pg_cron and also by the site while it is open; idempotent.
create or replace function send_due_scheduled() returns int
language plpgsql security definer set search_path = public as $$
declare
  r record;
  me text := current_setting('request.jwt.claim.sub', true);
  n int := 0;
begin
  for r in select * from scheduled_messages where sent_at is null and send_at <= now() order by send_at limit 50
           for update skip locked loop
    begin
      perform set_config('request.jwt.claim.sub', r.user_id::text, true);
      perform send_message(r.channel_id, r.body);
      update scheduled_messages set sent_at = now() where id = r.id;
      n := n + 1;
    exception when others then
      update scheduled_messages set sent_at = now(), error = left(sqlerrm, 200) where id = r.id;
    end;
  end loop;
  perform set_config('request.jwt.claim.sub', coalesce(me, ''), true);
  return n;
end $$;

-- ---------- Push notifications: queue ----------
create or replace function queue_push(p_user uuid, p_flag text, p_ref text, p_title text, p_body text, p_link text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  pr push_prefs;
  on_flag boolean;
  il timestamp := now() at time zone 'Asia/Jerusalem';
begin
  if not exists (select 1 from push_subscriptions where user_id = p_user) then return; end if;
  select * into pr from push_prefs where user_id = p_user;
  if not found then pr := row(p_user, true, true, true, false, true)::push_prefs; end if;
  execute format('select ($1).%I', p_flag) using pr into on_flag;
  if not coalesce(on_flag, false) then return; end if;
  if pr.no_shabbat and ((extract(dow from il) = 5 and extract(hour from il) >= 15) or (extract(dow from il) = 6 and extract(hour from il) < 21)) then
    return;
  end if;
  insert into push_queue (user_id, ref, title, body, link)
  values (p_user, p_ref, left(p_title, 120), left(coalesce(p_body, ''), 200), p_link)
  on conflict (user_id, ref) do nothing;
end $$;

-- Wakes the "send-push" Edge Function (asynchronous, sent after commit). No-op without pg_net (tests).
create or replace function push_kick() returns void
language plpgsql security definer set search_path = public as $$
begin
  if to_regproc('net.http_post') is null then return; end if;
  if not exists (select 1 from push_queue where sent_at is null) then return; end if;
  execute $k$select net.http_post(url := 'https://aircrgkljjnomoemnetq.supabase.co/functions/v1/send-push',
                                   headers := '{"Content-Type": "application/json"}'::jsonb, body := '{}'::jsonb)$k$;
end $$;

-- For the Edge Function (service role): pending pushes with their devices; marks them sent.
create or replace function push_batch()
returns table (id bigint, endpoint text, p256dh text, auth text, title text, body text, link text)
language plpgsql security definer set search_path = public as $$
declare
  ids bigint[];
begin
  select array_agg(q.id) into ids from (select q.id from push_queue q where q.sent_at is null order by q.id limit 200) q;
  if ids is null then return; end if;
  update push_queue set sent_at = now() where push_queue.id = any(ids);
  delete from push_queue where sent_at < now() - interval '3 days';
  return query select q.id, s.endpoint, s.p256dh, s.auth, q.title, q.body, q.link
                 from push_queue q join push_subscriptions s on s.user_id = q.user_id where q.id = any(ids);
end $$;

create or replace function push_public_key() returns text
language sql stable security definer set search_path = public as $$
  select public_key from push_config where id = 1 and is_active();
$$;

-- ---------- Events calendar: actions ----------
create or replace function norm_title(t text) returns text
language sql immutable as $$ select lower(regexp_replace(trim(coalesce(t, '')), '\s+', ' ', 'g')) $$;

-- An approved event this one duplicates or contradicts, if any.
create or replace function event_conflict(p_title text, p_starts date, p_except bigint default null) returns bigint
language sql stable security definer set search_path = public as $$
  select e.id from events e
   where e.status = 'approved' and e.id is distinct from p_except and e.kind <> 'simcha'
     and ((norm_title(e.title) = norm_title(p_title) and e.starts_on <> p_starts)
          or (e.starts_on = p_starts and (position(norm_title(p_title) in norm_title(e.title)) > 0
                                          or position(norm_title(e.title) in norm_title(p_title)) > 0)))
   order by e.id limit 1;
$$;

create or replace function add_event(p_title text, p_starts date, p_ends date default null, p_kind text default 'yeshiva',
                                     p_description text default null, p_message bigint default null)
returns events
language plpgsql security definer set search_path = public as $$
declare
  c bigint;
  e events;
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  if is_muted() then raise exception 'הושתקת זמנית ואינך יכול לכתוב כרגע' using errcode = '42501'; end if;
  if p_message is not null and not exists (select 1 from messages where id = p_message and author_id = auth.uid()) then
    raise exception 'אפשר לקשר רק הודעה שלך';
  end if;
  c := case when p_kind = 'simcha' then null else event_conflict(p_title, p_starts) end;
  insert into events (title, description, starts_on, ends_on, kind, created_by, message_id, status, conflict_with)
  values (left(trim(p_title), 100), nullif(left(trim(coalesce(p_description, '')), 500), ''), p_starts, p_ends,
          coalesce(p_kind, 'yeshiva'), auth.uid(), p_message,
          case when c is null then 'approved' else 'conflict' end, c)
  returning * into e;
  return e;
end $$;

-- Author, members he allowed, and admins edit an event. Moving it onto a clash re-checks it.
create or replace function update_event(p_id bigint, p_title text, p_starts date, p_ends date, p_kind text, p_description text)
returns events
language plpgsql security definer set search_path = public as $$
declare
  e events;
  c bigint;
begin
  select * into e from events where id = p_id;
  if not found or not is_active() or not (e.created_by = auth.uid() or auth.uid() = any(e.editors) or is_admin()) then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  c := case when e.status = 'approved' and p_kind <> 'simcha' then event_conflict(p_title, p_starts, p_id) end;
  update events set title = left(trim(p_title), 100), starts_on = p_starts, ends_on = p_ends, kind = p_kind,
                    description = nullif(left(trim(coalesce(p_description, '')), 500), ''),
                    status = case when c is null then status else 'conflict' end,
                    conflict_with = coalesce(c, conflict_with)
   where id = p_id returning * into e;
  return e;
end $$;

create or replace function delete_event(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from events where id = p_id and is_active() and (created_by = auth.uid() or can_remove_content())) then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  delete from events where id = p_id;
end $$;

-- Settles a clash (p_id is the event marked 'conflict'):
--   original's author: 'accept_new' (take the new date), 'allow_edit' (let the new author edit mine), 'escalate'
--   admins:            'accept_new', 'keep_original', 'keep_both'
--   new event's author: withdraws with delete_event()
create or replace function resolve_event(p_id bigint, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare
  n events;
  o events;
  owner boolean;
begin
  select * into n from events where id = p_id and status = 'conflict';
  if not found or not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  select * into o from events where id = n.conflict_with;
  owner := o.created_by = auth.uid();
  if not (is_admin() or (owner and p_action in ('accept_new', 'allow_edit', 'escalate'))) then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  if o.id is null or p_action = 'keep_both' then
    update events set status = 'approved', conflict_with = null, escalated = false where id = n.id;
  elsif p_action = 'accept_new' then
    update events set starts_on = n.starts_on, ends_on = n.ends_on, title = n.title,
                      description = coalesce(n.description, o.description) where id = o.id;
    delete from events where id = n.id;
  elsif p_action = 'allow_edit' then
    update events set editors = array(select distinct unnest(editors || n.created_by)) where id = o.id and n.created_by is not null;
    delete from events where id = n.id;
  elsif p_action = 'escalate' then
    update events set escalated = true where id = n.id;
  elsif p_action = 'keep_original' then
    delete from events where id = n.id;
  else
    raise exception 'פעולה לא מוכרת';
  end if;
end $$;

-- ---------- Email queue: triggers ----------
create or replace function queue_email(p_user uuid, p_flag text, p_kind text, p_ref text, p_title text, p_body text,
                                       p_link text, p_channel bigint default null, p_conv bigint default null,
                                       p_at timestamptz default now())
returns void
language plpgsql security definer set search_path = public as $$
declare
  pr email_prefs;
  on_flag boolean;
begin
  select * into pr from email_prefs where user_id = p_user and enabled;
  if not found then return; end if;
  execute format('select ($1).%I', p_flag) using pr into on_flag;
  if not coalesce(on_flag, false) then return; end if;
  insert into email_queue (user_id, kind, ref, title, body, link, channel_id, conv_id, ref_at)
  values (p_user, p_kind, p_ref, left(p_title, 200), left(coalesce(p_body, ''), 400), p_link, p_channel, p_conv, p_at)
  on conflict (user_id, ref) do nothing;
end $$;

-- Room messages: mentions, replies to me, new polls, birthday greetings, followed rooms.
-- Deferred to commit so the anonymous author (anon_authors, written right after the message) is known.
create or replace function email_on_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  author uuid := coalesce(new.author_id, (select author_id from anon_authors where kind = 'message' and item_id = new.id));
  who text := case when new.system then 'הודעת מערכת' when new.anonymous then 'אנונימי'
                   else coalesce((select display_name from profiles where id = new.author_id), 'מישהו') end;
  ch channels;
  room text;
  link text;
  parent uuid;
  r record;
  ref text := 'msg:' || new.id;
begin
  if new.deleted then return null; end if;
  select * into ch from channels where id = new.channel_id;
  room := case when ch.is_main then 'בצ''אט הראשי' else 'בחדר ' || ch.name end;
  link := case when ch.is_main then '#/?m=' else '#/room/' || ch.id || '?m=' end || new.id;
  if new.poll_id is not null then
    for r in select p.id from profiles p where p.status = 'active' and p.id is distinct from author loop
      perform queue_email(r.id, 'on_poll', 'poll', ref, 'סקר חדש ' || room, new.body, '#/polls/' || new.poll_id, ch.id, null, new.created_at);
      perform queue_push(r.id, 'on_poll', ref, 'סקר חדש ' || room, new.body, '#/polls/' || new.poll_id);
    end loop;
  end if;
  if new.system then
    for r in select p.id from profiles p where p.status = 'active' loop
      perform queue_email(r.id, 'on_birthday', 'birthday', ref, 'יום הולדת בקהילה', new.body, link, ch.id, null, new.created_at);
    end loop;
  end if;
  for r in select p.id from profiles p
            where p.status = 'active' and p.id is distinct from author and position('@' || p.display_name in new.body) > 0 loop
    perform queue_email(r.id, 'on_mention', 'mention', ref, who || ' הזכיר אותך ' || room, new.body, link, ch.id, null, new.created_at);
    perform queue_push(r.id, 'on_mention', ref, who || ' הזכיר אותך ' || room, new.body, link);
  end loop;
  if new.reply_to is not null then
    select coalesce(m.author_id, a.author_id) into parent
      from messages m left join anon_authors a on a.kind = 'message' and a.item_id = m.id where m.id = new.reply_to;
    if parent is not null and parent is distinct from author then
      perform queue_email(parent, 'on_reply', 'reply', ref, who || ' הגיב להודעה שלך ' || room, new.body, link, ch.id, null, new.created_at);
      perform queue_push(parent, 'on_reply', ref, who || ' הגיב להודעה שלך ' || room, new.body, link);
    end if;
  end if;
  for r in select e.user_id from email_prefs e join profiles p on p.id = e.user_id
            where p.status = 'active' and e.enabled and new.channel_id = any(e.rooms) and e.user_id is distinct from author loop
    insert into email_queue (user_id, kind, ref, title, body, link, channel_id, ref_at)
    values (r.user_id, 'room', ref, left('הודעה חדשה ' || room || ' מ' || who, 200), left(new.body, 400), link, ch.id, new.created_at)
    on conflict (user_id, ref) do nothing;
  end loop;
  perform push_kick();
  return null;
end $$;

drop trigger if exists messages_email on messages;
create constraint trigger messages_email after insert on messages
  deferrable initially deferred for each row execute function email_on_message();

-- Private messages: every participant except the sender's side.
create or replace function email_on_dm() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  sender_hidden boolean := new.sender_id is null;
  sender_name text := coalesce((select display_name from profiles where id = new.sender_id), '');
  pr email_prefs;
  title text;
begin
  for r in select * from dm_participants where conversation_id = new.conversation_id
            and case when sender_hidden then not hidden else user_id <> new.sender_id end loop
    title := case when sender_hidden then 'הודעה אנונימית חדשה'
                  when r.hidden then sender_name || ' ענה לך בשיחה האנונימית'
                  else 'הודעה חדשה מ' || sender_name end;
    select * into pr from email_prefs where user_id = r.user_id;
    perform queue_email(r.user_id, 'on_dm', 'dm', 'dm:' || new.id, title,
                        case when coalesce(pr.dm_preview, true) then new.body else '' end,
                        '#/dm/' || new.conversation_id, null, new.conversation_id, new.created_at);
    perform queue_push(r.user_id, 'on_dm', 'dm:' || new.id, title,
                       case when coalesce(pr.dm_preview, true) then new.body else '' end, '#/dm/' || new.conversation_id);
  end loop;
  perform push_kick();
  return null;
end $$;

drop trigger if exists dm_messages_email on dm_messages;
create trigger dm_messages_email after insert on dm_messages
  for each row execute function email_on_dm();

create or replace function email_on_feedback() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.reply is not null and new.reply is distinct from old.reply then
    perform queue_email(new.author_id, 'on_feedback', 'feedback', 'fb:' || new.id || ':' || extract(epoch from now())::bigint,
                        'הניהול ענה לפנייה שלך', new.reply, '#/contact');
  end if;
  return null;
end $$;

drop trigger if exists feedback_email on feedback;
create trigger feedback_email after update on feedback
  for each row execute function email_on_feedback();

-- A new request: every admin is told (email "on_feedback", push like a private message).
create or replace function email_on_new_feedback() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
begin
  for r in select id from profiles where role = 'admin' and status = 'active' and id <> new.author_id loop
    perform queue_email(r.id, 'on_feedback', 'feedback', 'fbnew:' || new.id, 'פנייה חדשה לניהול', new.body, '#/admin?tab=feedback');
    perform queue_push(r.id, 'on_dm', 'fbnew:' || new.id, 'פנייה חדשה לניהול', new.body, '#/admin?tab=feedback');
  end loop;
  perform push_kick();
  return null;
end $$;

drop trigger if exists feedback_new_email on feedback;
create trigger feedback_new_email after insert on feedback
  for each row execute function email_on_new_feedback();

create or replace function email_on_nickname() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform queue_email(new.target_id, 'on_nickname', 'nickname', 'nick:' || new.id,
                      'הציעו לך כינוי חדש: ' || new.nickname, 'אפשר לראות ולהצביע בפרופיל שלך.', '#/u/' || new.target_id);
  return null;
end $$;

drop trigger if exists nicknames_email on nicknames;
create trigger nicknames_email after insert on nicknames
  for each row execute function email_on_nickname();

-- ---------- Email queue: the sending job (service role only) ----------
-- Returns the emails that are due now, one row per member, and marks their items as taken.
-- Respects each member's frequency, delay, quiet hours, Shabbat, daily cap and "only unread"; never
-- mails the owner's address (not a real inbox); keeps the whole site under Gmail's ~500/day.
create or replace function email_batch(p_limit int default 50)
returns table (user_id uuid, email text, name text, digest boolean, items jsonb)
language plpgsql security definer set search_path = public, auth as $$
declare
  il timestamp := now() at time zone 'Asia/Jerusalem';
  dow int := extract(dow from il);
  hr int := extract(hour from il);
  shabbat boolean := (dow = 5 and hr >= 15) or (dow = 6 and hr < 21);
  sent_today int;
  u record;
  ids bigint[];
begin
  delete from email_queue where sent_at < now() - interval '14 days';
  -- Items the member already read on the site, or whose member turned emails off, are dropped.
  update email_queue q set sent_at = now()
   where q.sent_at is null and (
     not exists (select 1 from email_prefs e join profiles p on p.id = e.user_id
                  where e.user_id = q.user_id and e.enabled and p.status = 'active')
     or (select only_unread from email_prefs e where e.user_id = q.user_id) and (
          (q.channel_id is not null and exists (select 1 from channel_reads r where r.user_id = q.user_id
                                                 and r.channel_id = q.channel_id and r.last_read_at >= q.ref_at))
       or (q.conv_id is not null and exists (select 1 from dm_participants d where d.user_id = q.user_id
                                              and d.conversation_id = q.conv_id and d.last_read_at >= q.ref_at))));
  -- Taken but never confirmed (the job crashed): try again later.
  update email_queue set claimed_at = null where sent_at is null and claimed_at < now() - interval '15 minutes' and attempts < 3;
  update email_queue set sent_at = now() where sent_at is null and attempts >= 3;

  select count(distinct (q.user_id, q.sent_at)) into sent_today from email_queue q
   where q.delivered and q.sent_at > date_trunc('day', il) at time zone 'Asia/Jerusalem';
  if sent_today >= 450 then return; end if;

  for u in
    select e.*, au.email as addr, p.display_name
      from email_prefs e join profiles p on p.id = e.user_id join auth.users au on au.id = e.user_id
     where e.enabled and p.status = 'active' and lower(au.email) <> owner_email()
       and exists (select 1 from email_queue q where q.user_id = e.user_id and q.sent_at is null and q.claimed_at is null)
       and not (e.no_shabbat and shabbat)
       and not (e.quiet_from is not null and e.quiet_to is not null and
                case when e.quiet_from <= e.quiet_to then hr >= e.quiet_from and hr < e.quiet_to
                     else hr >= e.quiet_from or hr < e.quiet_to end)
     limit p_limit
  loop
    exit when sent_today >= 450;
    continue when (select count(distinct q.sent_at) from email_queue q where q.user_id = u.user_id and q.delivered
                    and q.sent_at > date_trunc('day', il) at time zone 'Asia/Jerusalem') >= u.max_per_day;
    if u.frequency = 'instant' then
      select array_agg(q.id order by q.id) into ids from email_queue q
       where q.user_id = u.user_id and q.sent_at is null and q.claimed_at is null
         and q.created_at <= now() - make_interval(mins => u.delay_minutes);
    elsif u.frequency = 'hourly' then
      select array_agg(q.id order by q.id) into ids from email_queue q
       where q.user_id = u.user_id and q.sent_at is null and q.claimed_at is null
         and (select min(x.created_at) from email_queue x where x.user_id = u.user_id and x.sent_at is null) <= now() - interval '1 hour';
    else
      if hr = u.daily_hour and (u.last_digest_at is null or u.last_digest_at < now() - interval '20 hours') then
        select array_agg(q.id order by q.id) into ids from email_queue q
         where q.user_id = u.user_id and q.sent_at is null and q.claimed_at is null;
        update email_prefs set last_digest_at = now() where email_prefs.user_id = u.user_id;
      else
        ids := null;
      end if;
    end if;
    continue when ids is null;
    ids := ids[1:30];
    update email_queue set claimed_at = now(), attempts = attempts + 1 where id = any(ids);
    user_id := u.user_id;
    email := u.addr;
    name := u.display_name;
    digest := u.frequency <> 'instant' or cardinality(ids) > 1;
    items := (select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'title', q.title, 'body', q.body,
                                                   'link', q.link, 'at', q.created_at) order by q.id)
                from email_queue q where q.id = any(ids));
    sent_today := sent_today + 1;
    return next;
  end loop;
end $$;

-- The job reports back: delivered items are done; failed ones are retried (up to 3 times).
create or replace function email_done(p_ids bigint[], p_ok boolean) returns void
language sql security definer set search_path = public as $$
  update email_queue set sent_at = case when p_ok then now() end, delivered = p_ok, claimed_at = case when p_ok then claimed_at end
   where id = any(p_ids);
$$;

-- Admin: approve a list of emails in advance. Existing pending accounts with those emails are let in now;
-- the rest are let in the moment they sign up. Nothing is sent to anyone.
create or replace function add_preapproved(p_entries jsonb)
returns table (addr text, result text)
language plpgsql security definer set search_path = public, auth as $$
declare
  e jsonb;
  em text;
  nm text;
  uid uuid;
  st member_status;
begin
  if not is_admin() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  for e in select * from jsonb_array_elements(coalesce(p_entries, '[]'::jsonb)) loop
    em := lower(trim(e ->> 'email'));
    nm := left(nullif(trim(e ->> 'name'), ''), 40);
    continue when em is null or em !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$';
    uid := null;
    st := null;
    select u.id, p.status into uid, st from auth.users u join profiles p on p.id = u.id where lower(u.email) = em limit 1;
    if uid is null then
      insert into preapproved_emails as x (email, display_name, added_by) values (em, nm, auth.uid())
        on conflict (email) do update set display_name = coalesce(excluded.display_name, x.display_name);
      addr := em; result := 'added';
    elsif st = 'pending' then
      update profiles set status = 'active', joined_via = 'email' where id = uid;
      insert into preapproved_emails as x (email, display_name, added_by, used_at) values (em, nm, auth.uid(), now())
        on conflict (email) do update set used_at = now();
      addr := em; result := 'activated';
    else
      addr := em; result := case when st = 'banned' then 'banned' else 'member' end;
    end if;
    return next;
  end loop;
end $$;

-- Admin: add names to the roster (re-pasting the same list adds nothing; a name listed twice may be
-- claimed twice). Pending accounts whose name now matches are let in. Returns how many names were added
-- and how many waiting accounts were let in.
create or replace function add_roster(p_names text[])
returns table (added int, activated int)
language plpgsql security definer set search_path = public as $$
declare
  r record;
  p record;
  rid bigint;
begin
  if not is_admin() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  added := 0;
  activated := 0;
  for r in
    select min(n) as name, tk, count(*)::int as want
    from (select left(trim(regexp_replace(x, '\s+', ' ', 'g')), 60) as n, name_tokens(x) as tk from unnest(coalesce(p_names, '{}')) x) s
    where cardinality(tk) >= 2 and char_length(n) >= 2
    group by tk
  loop
    for i in 1 .. r.want - (select count(*)::int from roster where tokens = r.tk) loop
      insert into roster (name, tokens, surname, added_by) values (r.name, r.tk, name_tokens(split_part(r.name, ' ', 1)), auth.uid());
      added := added + 1;
    end loop;
  end loop;
  for p in select id, display_name from profiles where status = 'pending' order by created_at loop
    rid := roster_match(p.display_name);
    continue when rid is null;
    update roster set claimed_by = p.id, claimed_at = now() where id = rid;
    update profiles set status = 'active', joined_via = 'roster', join_seen = false where id = p.id;
    activated := activated + 1;
  end loop;
  return next;
end $$;

-- Wipes every message, room, conversation, list and account (the caller's too), leaving an empty main
-- room. Allowed to the owner, or to an admin while no owner account exists yet; the caller confirms with
-- his own login password (checked against Supabase Auth, nothing stored here). Stored files are removed
-- by the site before calling this (Storage can't be emptied from SQL).
create or replace function reset_everything(p_password text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  pw text;
  t text;
begin
  if not (is_owner() or (is_admin() and not exists (select 1 from auth.users where lower(email) = owner_email()))) then
    raise exception 'אין הרשאה' using errcode = '42501';
  end if;
  select encrypted_password into pw from auth.users where id = auth.uid();
  if pw is null or extensions.crypt(coalesce(p_password, ''), pw) <> pw then
    raise exception 'הסיסמה שגויה' using errcode = '42501';
  end if;
  truncate feedback_messages, message_reports, mute_log, scheduled_messages, room_mutes, push_queue, push_subscriptions, push_prefs,
    quiz_guesses, quote_quizzes, confession_comments, confession_reactions, confessions, events, email_queue, email_prefs, nickname_votes, nicknames, birthday_posts, birthdays, feedback, poll_votes, poll_options, polls, dm_reactions, dm_messages, dm_participants, dm_conversations, reactions, message_likes, stars,
    anon_authors, wall_posts, channel_reads, messages, channels, preapproved_emails, roster restart identity cascade;
  foreach t in array array['thread_likes', 'thread_reads', 'threads'] loop
    if to_regclass('public.' || t) is not null then execute format('truncate %I cascade', t); end if;
  end loop;
  delete from auth.users where id is not null;  -- Supabase rejects a DELETE without WHERE
  insert into channels (name, description, is_main) values ('הצ''אט הראשי', 'השיחה של כל הקהילה', true);
  insert into channels (name, description, purpose, position)
  values ('מזל טוב וברכות', 'ברכות לשמחות: אירוסין, חתונות, בר מצווה ועוד. אפשר לשבץ את השמחה בלוח האירועים.', 'blessings', 1);
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
  if is_muted() then raise exception 'הושתקת זמנית ואינך יכול לכתוב כרגע' using errcode = '42501'; end if;
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
  if is_muted() then raise exception 'הושתקת זמנית ואינך יכול לכתוב כרגע' using errcode = '42501'; end if;
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

-- Reputation: 5 per like received from another member + 1 per message. Anonymous content never counts.
drop function if exists member_stats();
create function member_stats()
returns table (id uuid, messages int, likes int, reputation int)
language sql stable security definer set search_path = public as $$
  select s.id, s.messages, s.likes, s.likes * 5 + s.messages
  from (
    select p.id,
      (select count(*)::int from messages m where m.author_id = p.id and not m.deleted) as messages,
      (select count(*)::int from message_likes l join messages m on m.id = l.message_id
        where m.author_id = p.id and not m.deleted and l.user_id <> p.id) as likes
    from profiles p
    where p.status = 'active' and is_active()
  ) s;
$$;

revoke execute on function create_poll(text, text[], boolean, bigint), vote_poll(bigint, bigint[]), poll_results(bigint),
  set_poll_closed(bigint, boolean) from anon, public;
grant execute on function create_poll(text, text[], boolean, bigint), vote_poll(bigint, bigint[]), poll_results(bigint),
  set_poll_closed(bigint, boolean) to authenticated;
revoke execute on function send_feedback(text, text), reply_feedback(bigint, text, boolean), open_feedback_count(), feedback_post(bigint, text) from anon, public;
grant execute on function send_feedback(text, text), reply_feedback(bigint, text, boolean), open_feedback_count(), feedback_post(bigint, text) to authenticated;
revoke execute on function post_birthdays(), profile_birthday(uuid), propose_nickname(uuid, text),
  toggle_nickname_vote(bigint), remove_nickname(bigint), nickname_list(uuid) from anon, public;
grant execute on function post_birthdays(), profile_birthday(uuid), propose_nickname(uuid, text),
  toggle_nickname_vote(bigint), remove_nickname(bigint), nickname_list(uuid) to authenticated;
revoke execute on function queue_email(uuid, text, text, text, text, text, text, bigint, bigint, timestamptz),
  email_batch(int), email_done(bigint[], boolean) from anon, public, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function email_batch(int), email_done(bigint[], boolean), post_birthdays() to service_role;
  end if;
end $$;
revoke execute on function send_flash(bigint, text, text, text, text), recent_flashes(int) from anon, public;
grant execute on function send_flash(bigint, text, text, text, text), recent_flashes(int) to authenticated;
revoke execute on function my_reputation(), send_gag(bigint, jsonb, text), weekly_highlights(),
  add_event(text, date, date, text, text, bigint), update_event(bigint, text, date, date, text, text), delete_event(bigint),
  resolve_event(bigint, text), event_conflict(text, date, bigint) from anon, public;
grant execute on function my_reputation(), send_gag(bigint, jsonb, text), weekly_highlights(),
  add_event(text, date, date, text, text, bigint), update_event(bigint, text, date, date, text, text), delete_event(bigint),
  resolve_event(bigint, text) to authenticated;
revoke execute on function post_confession(text), delete_confession(bigint), grab_quote(bigint), guess_quote(bigint, uuid),
  quiz_list(), quiz_leaderboard(), delete_quiz(bigint) from anon, public;
grant execute on function post_confession(text), delete_confession(bigint), grab_quote(bigint), guess_quote(bigint, uuid),
  quiz_list(), quiz_leaderboard(), delete_quiz(bigint) to authenticated;
revoke execute on function report_message(bigint, text), handle_report(bigint, boolean), report_list(),
  mute_member(uuid, int, text), unmute_member(uuid), my_mute(), day_titles(uuid), admin_stats(),
  schedule_message(bigint, text, timestamptz), send_due_scheduled(), push_public_key() from anon, public;
grant execute on function report_message(bigint, text), handle_report(bigint, boolean), report_list(),
  mute_member(uuid, int, text), unmute_member(uuid), my_mute(), day_titles(uuid), admin_stats(),
  schedule_message(bigint, text, timestamptz), send_due_scheduled(), push_public_key() to authenticated;
revoke execute on function queue_push(uuid, text, text, text, text, text), push_kick(), push_batch() from anon, public, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function push_batch(), send_due_scheduled() to service_role;
  end if;
end $$;
revoke execute on function add_preapproved(jsonb) from anon, public;
grant execute on function add_preapproved(jsonb) to authenticated;
revoke execute on function owner_profile_id() from anon, public;
grant execute on function owner_profile_id() to authenticated;
revoke execute on function reset_everything(text) from anon, public;
grant execute on function reset_everything(text) to authenticated;
revoke execute on function add_roster(text[]) from anon, public;
grant execute on function add_roster(text[]) to authenticated;
revoke execute on function roster_match(text) from anon, public, authenticated;
revoke execute on function create_room, send_message, mark_room_read, mark_room_unread, set_message_pinned, my_rooms,
  post_wall, start_dm, send_dm, toggle_dm_reaction, mark_dm_read, mark_dm_unread, set_dm_closed, my_conversations,
  member_stats from anon, public;
grant execute on function create_room, send_message, mark_room_read, mark_room_unread, set_message_pinned, my_rooms,
  post_wall, start_dm, send_dm, toggle_dm_reaction, mark_dm_read, mark_dm_unread, set_dm_closed, my_conversations,
  member_stats to authenticated;

-- ---------- Guest view (temporary, read-only, without logging in) ----------
-- The owner may open the site for reading to visitors who are not logged in, for a limited time
-- (e.g. two days to introduce the site to the public). It closes by itself when the time is up.
-- Guests read rooms, messages, active members' names, reactions/likes, polls (totals only), confessions,
-- "who said it?" and the calendar: never private chats, anonymous authors, profiles' private data, and
-- they cannot write anything. (site_settings and guest_view_open() are created near is_active() above.)
insert into site_settings (id) values (1) on conflict (id) do nothing;
alter table site_settings enable row level security;  -- no policies: functions only

-- Until when visitors may read without logging in (null = closed). Anyone may ask, logged in or not.
create or replace function guest_view_until() returns timestamptz
language sql stable security definer set search_path = public as $$
  select guest_view_until from site_settings where id = 1 and guest_view_until > now();
$$;

-- The owner (מנהל-על) only: open guest view for p_hours hours from now (1..720), or close it (null / 0).
create or replace function set_guest_view(p_hours int) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v timestamptz;
begin
  if not is_owner() then raise exception 'רק מנהל-העל יכול לפתוח את האתר לצפייה' using errcode = '42501'; end if;
  if p_hours is not null and p_hours not between 0 and 720 then raise exception 'אפשר לפתוח לכל היותר ל-30 יום'; end if;
  v := case when coalesce(p_hours, 0) = 0 then null else now() + make_interval(hours => p_hours) end;
  insert into site_settings (id, guest_view_until, guest_view_by) values (1, v, auth.uid())
  on conflict (id) do update set guest_view_until = excluded.guest_view_until, guest_view_by = excluded.guest_view_by;
  return v;
end $$;

revoke execute on function set_guest_view(int) from anon, public;
grant execute on function set_guest_view(int) to authenticated;
grant execute on function guest_view_open(), guest_view_until() to anon, authenticated;
-- Supabase grants these already; explicit so RLS alone decides what a visitor sees.
grant select on channels, messages, profiles, reactions, message_likes, polls, poll_options,
  confessions, confession_reactions, confession_comments, events to anon;
-- Read-only summaries for guests (totals, the quiz without its open answers, the week's highlights).
grant execute on function poll_results(bigint), weekly_highlights(), quiz_list(), quiz_leaderboard(), recent_flashes(int) to anon;

-- ---------- AI bot "בוט" ----------
-- Each member has a private conversation with the bot "בוט" (/bot), only about the chat and the ועד. The Edge Function "bot" (Google AI Studio /
-- Gemini, free keys) answers from public room messages only (never private chats or who wrote anonymous
-- messages). What a member tells it about someone else is a claim: it is shared only after that person
-- agrees (bot_claims, never naming who said it). The bot can pass a message to another member (relay).
-- API keys are kept here, readable only by the Edge Function; the owner manages them (masked).
create table if not exists ai_keys (
  id             bigint generated always as identity primary key,
  label          text not null check (char_length(label) between 1 and 40),
  api_key        text not null check (char_length(api_key) between 10 and 200),
  model          text not null default 'gemini-3.8-flash' check (char_length(model) between 3 and 60),
  daily_limit    int  not null default 200 check (daily_limit between 1 and 100000),
  per_minute     int  not null default 8 check (per_minute between 1 and 1000),
  enabled        boolean not null default true,
  used_day       date not null default current_date,
  used_today     int  not null default 0,
  minute_start   timestamptz not null default now(),
  used_minute    int  not null default 0,
  cooldown_until timestamptz,
  last_error     text,
  last_used_at   timestamptz,
  added_at       timestamptz not null default now()
);
alter table ai_keys enable row level security;  -- no policies: owner functions and the Edge Function only
-- Google retired gemini-2.5-flash for new keys and recommends gemini-3.8-flash: the default, and every old key moves
-- to it (and stops resting after the 404). The Edge Function also follows Google's recommendation by itself on a 404.
alter table ai_keys alter column model set default 'gemini-3.8-flash';
-- A member's own key (null = the site's shared keys, managed by the owner). Used only for his own requests.
alter table ai_keys add column if not exists owner_id uuid references profiles on delete cascade;
create index if not exists ai_keys_owner_idx on ai_keys (owner_id);
update ai_keys set model = 'gemini-3.8-flash', cooldown_until = null, last_error = null where model = 'gemini-2.5-flash';

create table if not exists bot_messages (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles on delete cascade,  -- whose conversation
  role        text not null check (role in ('user', 'bot')),
  body        text not null check (char_length(body) between 1 and 4000),
  claim_id    bigint,  -- a consent question about this claim (yes / no buttons)
  from_id     uuid references profiles on delete set null,  -- a message passed on from this member
  created_at  timestamptz not null default now()
);
create index if not exists bot_messages_user_idx on bot_messages (user_id, id);
-- A relay whose sender asked to stay anonymous: from_id stays NULL on the recipient's row (he can read his rows),
-- and the sender sits in bot_relay_senders, which only the Edge Function and the owner can read, so an answer can
-- still go back to him.
alter table bot_messages add column if not exists relay_anon boolean not null default false;
create table if not exists bot_relay_senders (
  message_id  bigint primary key references bot_messages on delete cascade,
  from_id     uuid not null references profiles on delete cascade,
  created_at  timestamptz not null default now()
);
alter table bot_relay_senders enable row level security;
drop policy if exists bot_relay_senders_owner on bot_relay_senders;
create policy bot_relay_senders_owner on bot_relay_senders for select using (is_owner());
alter table bot_messages enable row level security;

create table if not exists bot_claims (
  id           bigint generated always as identity primary key,
  about_id     uuid not null references profiles on delete cascade,
  by_id        uuid references profiles on delete set null,  -- never shown to anyone
  claim        text not null check (char_length(claim) between 1 and 500),
  status       text not null default 'pending' check (status in ('pending', 'allowed', 'declined')),
  created_at   timestamptz not null default now(),
  answered_at  timestamptz
);
create index if not exists bot_claims_about_idx on bot_claims (about_id, status);
alter table bot_claims enable row level security;  -- no policies: functions and the Edge Function only

-- Gemini's free quota resets at midnight Pacific time.
create or replace function ai_quota_day() returns date
language sql stable as $$ select (now() at time zone 'America/Los_Angeles')::date $$;

-- Owner: keys without the secret (first and last 4 characters only).
create or replace function ai_key_list()
returns table (id bigint, label text, masked text, model text, daily_limit int, per_minute int, enabled boolean,
               used_today int, cooldown_until timestamptz, last_error text, last_used_at timestamptz)
language sql stable security definer set search_path = public as $$
  select k.id, k.label, left(k.api_key, 4) || '…' || right(k.api_key, 4), k.model, k.daily_limit, k.per_minute, k.enabled,
         case when k.used_day = ai_quota_day() then k.used_today else 0 end, k.cooldown_until, k.last_error, k.last_used_at
    from ai_keys k where is_owner() and k.owner_id is null order by k.id;
$$;

create or replace function ai_key_add(p_label text, p_key text, p_model text default null, p_daily int default 200, p_minute int default 8)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if not is_owner() then raise exception 'רק מנהל-העל מנהל את מפתחות ה-AI' using errcode = '42501'; end if;
  insert into ai_keys (label, api_key, model, daily_limit, per_minute)
  values (trim(p_label), trim(p_key), coalesce(nullif(trim(p_model), ''), 'gemini-3.8-flash'), p_daily, p_minute)
  returning id into v;
  return v;
end $$;

create or replace function ai_key_update(p_id bigint, p_enabled boolean, p_model text, p_daily int, p_minute int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'רק מנהל-העל מנהל את מפתחות ה-AI' using errcode = '42501'; end if;
  update ai_keys set enabled = p_enabled, model = coalesce(nullif(trim(p_model), ''), model), daily_limit = p_daily,
                     per_minute = p_minute, cooldown_until = case when p_enabled then null else cooldown_until end
   where id = p_id;
end $$;

create or replace function ai_key_remove(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'רק מנהל-העל מנהל את מפתחות ה-AI' using errcode = '42501'; end if;
  delete from ai_keys where id = p_id;
end $$;

-- Edge Function only: take the least used key that still has quota (today and this minute) and count the use.
-- A member with his own key uses only it; everyone else uses the shared keys.
drop function if exists ai_take_key();
create or replace function ai_take_key(p_user uuid default null, out id bigint, out api_key text, out model text)
language plpgsql security definer set search_path = public as $$
declare
  k ai_keys;
  own boolean := p_user is not null and exists (select 1 from ai_keys x where x.owner_id = p_user and x.enabled);
begin
  update ai_keys set used_day = ai_quota_day(), used_today = 0 where used_day <> ai_quota_day();
  update ai_keys set minute_start = now(), used_minute = 0 where minute_start < now() - interval '1 minute';
  select * into k from ai_keys
   where enabled and (cooldown_until is null or cooldown_until < now())
     and (case when own then owner_id = p_user else owner_id is null end)
     and used_today < daily_limit and used_minute < per_minute
   order by used_today::numeric / daily_limit, last_used_at nulls first
   limit 1 for update skip locked;
  if not found then return; end if;
  update ai_keys set used_today = used_today + 1, used_minute = used_minute + 1, last_used_at = now() where ai_keys.id = k.id;
  id := k.id; api_key := k.api_key; model := k.model;
end $$;

-- Edge Function only: how the call went. A rate-limited key rests for p_cooldown seconds.
create or replace function ai_key_result(p_id bigint, p_error text, p_cooldown int default 0) returns void
language sql security definer set search_path = public as $$
  update ai_keys set last_error = left(p_error, 300),
         cooldown_until = case when coalesce(p_cooldown, 0) > 0 then now() + make_interval(secs => p_cooldown) else cooldown_until end
   where id = p_id;
$$;

-- Saving the keys: a member who wastes the bot (off topic, repeating himself) collects strikes; at 3 he is
-- told to go chat with plain Gemini and blocked for a quarter of an hour. A useful exchange takes one strike off.
create table if not exists bot_state (
  user_id        uuid primary key references profiles on delete cascade,
  strikes        int not null default 0,
  blocked_until  timestamptz
);
alter table bot_state enable row level security;  -- no policies: functions only

-- p_ok = true: a useful exchange (one strike off). false: a wasted one. Returns true when this blocked him.
create or replace function bot_mark(p_user uuid, p_ok boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into bot_state (user_id) values (p_user) on conflict (user_id) do nothing;
  if p_ok then
    update bot_state set strikes = greatest(strikes - 1, 0) where user_id = p_user;
    return false;
  end if;
  update bot_state set strikes = strikes + 1 where user_id = p_user returning strikes into n;
  if n < 3 then return false; end if;
  update bot_state set strikes = 0, blocked_until = now() + interval '15 minutes' where user_id = p_user;
  insert into bot_messages (user_id, role, body) values (p_user, 'bot',
    'נראה לי שמשעמם לך. אני עסוק עכשיו בלנייעס עם עוד חבר''ה, אתה יכול לנייעס עם ג''מיני הרגיל, בהנאה רבה. נדבר בעוד רבע שעה.');
  return true;
end $$;

-- How many messages a day a member gets on the shared keys. After that he adds his own free key (guide on the bot page).
create or replace function bot_free_daily() returns int language sql immutable as $$ select 10 $$;
alter table bot_state add column if not exists free_day date;
alter table bot_state add column if not exists free_used int not null default 0;

-- A member saves his own Google AI Studio key (replaces an earlier one). Members can't read keys; the owner can
-- (to help members), and members are told so in the guide.
create or replace function ai_my_key_set(p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_active() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_key, ''))) not between 20 and 200 then raise exception 'זה לא נראה כמו מפתח. העתק אותו שוב מ-AI Studio.'; end if;
  delete from ai_keys where owner_id = auth.uid();
  insert into ai_keys (label, api_key, owner_id, daily_limit, per_minute)
  values ('אישי', trim(p_key), auth.uid(), 200, 8);
end $$;

create or replace function ai_my_key_remove() returns void
language sql security definer set search_path = public as $$
  delete from ai_keys where owner_id = auth.uid();
$$;

-- Owner's control panel for members' own keys (people ask him for help): every member who has a key or used
-- the bot, his key's state, and free messages used today. The owner may reveal, set, switch off or remove a key.
create or replace function ai_member_keys()
returns table (user_id uuid, key_id bigint, masked text, enabled boolean, used_today int, daily_limit int,
               cooldown_until timestamptz, last_error text, last_used_at timestamptz, free_used int)
language sql stable security definer set search_path = public as $$
  select p.id, k.id, left(k.api_key, 4) || '…' || right(k.api_key, 4), k.enabled,
         case when k.used_day = ai_quota_day() then k.used_today else 0 end, k.daily_limit, k.cooldown_until, k.last_error,
         k.last_used_at,
         case when s.free_day = (now() at time zone 'Asia/Jerusalem')::date then s.free_used else 0 end
    from profiles p
    left join ai_keys k on k.owner_id = p.id
    left join bot_state s on s.user_id = p.id
   where is_owner() and (k.id is not null or s.user_id is not null)
   order by k.id is null, p.display_name;
$$;

create or replace function ai_member_key_reveal(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select api_key from ai_keys where owner_id = p_user and is_owner() limit 1;
$$;

create or replace function ai_member_key_set(p_user uuid, p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'רק מנהל-העל מנהל את מפתחות ה-AI' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_key, ''))) not between 20 and 200 then raise exception 'זה לא נראה כמו מפתח'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'החבר לא נמצא'; end if;
  delete from ai_keys where owner_id = p_user;
  insert into ai_keys (label, api_key, owner_id, daily_limit, per_minute) values ('אישי', trim(p_key), p_user, 200, 8);
end $$;

create or replace function ai_member_key_remove(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'רק מנהל-העל מנהל את מפתחות ה-AI' using errcode = '42501'; end if;
  delete from ai_keys where owner_id = p_user;
end $$;

revoke execute on function ai_member_keys(), ai_member_key_reveal(uuid), ai_member_key_set(uuid, text), ai_member_key_remove(uuid) from anon, public;
grant execute on function ai_member_keys(), ai_member_key_reveal(uuid), ai_member_key_set(uuid, text), ai_member_key_remove(uuid) to authenticated;

-- My standing with the bot: free messages left today, and my own key (masked, usage, last error).
create or replace function bot_my_quota(out free_left int, out has_key boolean, out masked text, out used_today int,
                                        out daily_limit int, out key_error text, out resting boolean)
language plpgsql stable security definer set search_path = public as $$
declare k ai_keys; st bot_state;
begin
  select * into st from bot_state where user_id = auth.uid();
  free_left := greatest(bot_free_daily() - case when st.free_day = (now() at time zone 'Asia/Jerusalem')::date then coalesce(st.free_used, 0) else 0 end, 0);
  select * into k from ai_keys where owner_id = auth.uid() limit 1;
  has_key := found;
  if has_key then
    masked := left(k.api_key, 4) || '…' || right(k.api_key, 4);
    used_today := case when k.used_day = ai_quota_day() then k.used_today else 0 end;
    daily_limit := k.daily_limit;
    key_error := k.last_error;
    resting := k.cooldown_until > now();
  end if;
end $$;

-- Until when I may not write to the bot (null = I may).
create or replace function bot_my_block() returns timestamptz
language sql stable security definer set search_path = public as $$
  select blocked_until from bot_state where user_id = auth.uid() and blocked_until > now();
$$;

-- A member writes to the bot (the Edge Function answers). Up to 40 messages an hour, not while blocked.
-- The same question again is answered here, without spending a key, and counts as a strike.
create or replace function bot_send(p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v bigint;
  b text := trim(coalesce(p_body, ''));
  until timestamptz;
begin
  if not is_active() or is_muted() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  if char_length(b) not between 1 and 1000 then raise exception 'ההודעה ארוכה מדי'; end if;
  -- The owner (emergency account) has no limits: no block, no hourly cap, no daily quota, no repeat strikes.
  if is_owner() then
    insert into bot_messages (user_id, role, body) values (auth.uid(), 'user', b) returning id into v;
    return v;
  end if;
  select blocked_until into until from bot_state where user_id = auth.uid() and blocked_until > now();
  if until is not null then
    raise exception 'בוט עסוק עכשיו בנייעס עם חבר''ה אחרים. נסה שוב בשעה %', to_char(until at time zone 'Asia/Jerusalem', 'HH24:MI');
  end if;
  if (select count(*) from bot_messages where user_id = auth.uid() and role = 'user' and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'בוט צריך הפסקה. נסה שוב בעוד קצת.';
  end if;
  -- Free messages on the shared keys; after that only with his own key.
  if not exists (select 1 from ai_keys where owner_id = auth.uid() and enabled) then
    insert into bot_state (user_id) values (auth.uid()) on conflict (user_id) do nothing;
    update bot_state set free_day = (now() at time zone 'Asia/Jerusalem')::date, free_used = 0
     where user_id = auth.uid() and free_day is distinct from (now() at time zone 'Asia/Jerusalem')::date;
    if (select free_used from bot_state where user_id = auth.uid()) >= bot_free_daily() then
      raise exception 'נגמרו ההודעות החינמיות של היום. כדי להמשיך עם בוט צריך מפתח משלך (חינם, 2 דקות).'
        using hint = 'need_key';
    end if;
    update bot_state set free_used = free_used + 1 where user_id = auth.uid();
  end if;
  insert into bot_messages (user_id, role, body) values (auth.uid(), 'user', b) returning id into v;
  if exists (select 1 from (select body from bot_messages where user_id = auth.uid() and role = 'user' and id < v
                             and created_at > now() - interval '1 hour' order by id desc limit 5) x
              where lower(x.body) = lower(b)) then
    if not bot_mark(auth.uid(), false) then
      insert into bot_messages (user_id, role, body) values (auth.uid(), 'bot', 'כבר שאלת את זה, אחי. יש משהו חדש?');
    end if;
  end if;
  return v;
end $$;

-- The member a claim is about says whether the bot may tell others that it heard it (never who said it).
create or replace function bot_answer_claim(p_claim bigint, p_allow boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  update bot_claims set status = case when p_allow then 'allowed' else 'declined' end, answered_at = now()
   where id = p_claim and about_id = auth.uid() and status = 'pending' and is_active();
  if not found then raise exception 'השאלה כבר נענתה' using errcode = '42501'; end if;
  insert into bot_messages (user_id, role, body) values (auth.uid(), 'bot',
    case when p_allow then 'סגור, מעכשיו אם ישאלו אני יכול לספר ששמעתי את זה. אף פעם לא אגיד ממי.'
         else 'בסדר גמור, זה נשאר אצלי ולא אספר לאף אחד.' end);
end $$;

-- My own claims about me: what was said and what I answered (for the bot page).
create or replace function bot_claims_about_me()
returns table (id bigint, claim text, status text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.id, c.claim, c.status, c.created_at from bot_claims c where c.about_id = auth.uid() and is_active() order by c.id desc;
$$;

revoke execute on function ai_key_list(), ai_key_add(text, text, text, int, int), ai_key_update(bigint, boolean, text, int, int),
  ai_key_remove(bigint), bot_send(text), bot_answer_claim(bigint, boolean), bot_claims_about_me(), bot_my_block(),
  ai_my_key_set(text), ai_my_key_remove(), bot_my_quota() from anon, public;
grant execute on function ai_key_list(), ai_key_add(text, text, text, int, int), ai_key_update(bigint, boolean, text, int, int),
  ai_key_remove(bigint), bot_send(text), bot_answer_claim(bigint, boolean), bot_claims_about_me(), bot_my_block(),
  ai_my_key_set(text), ai_my_key_remove(), bot_my_quota() to authenticated;
revoke execute on function ai_take_key(uuid), ai_key_result(bigint, text, int), bot_mark(uuid, boolean) from anon, public, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function ai_take_key(uuid), ai_key_result(bigint, text, int), bot_mark(uuid, boolean) to service_role;
  end if;
end $$;

drop policy if exists bot_messages_own on bot_messages;
create policy bot_messages_own on bot_messages for select using (user_id = auth.uid() or is_owner());

-- ---------- בוט reports to the owner ----------
-- בוט flags unusual conversations (odd requests, attempts to find out who wrote anonymously, bullying, distress,
-- threats...) with the line that worried it. Owner only: the "בוט מדווח" admin tab, plus a phone push for serious
-- ones. The owner can also read a sample of conversations (bot_messages is readable by the owner; members are told).
create table if not exists bot_alerts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles on delete cascade,
  message_id  bigint references bot_messages on delete set null,
  level       text not null check (level in ('odd', 'concern', 'urgent')),
  reason      text not null check (char_length(reason) between 1 and 500),
  excerpt     text not null default '' check (char_length(excerpt) <= 1000),
  created_at  timestamptz not null default now(),
  seen_at     timestamptz
);
create index if not exists bot_alerts_new_idx on bot_alerts (id) where seen_at is null;
alter table bot_alerts enable row level security;
drop policy if exists bot_alerts_owner on bot_alerts;
create policy bot_alerts_owner on bot_alerts for select using (is_owner());

-- Serious reports reach the owner's phone at once.
create or replace function bot_alert_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare o uuid := (select u.id from auth.users u where lower(u.email) = owner_email() limit 1);
begin
  if o is null or new.level = 'odd' then return new; end if;
  perform queue_push(o, 'on_dm', 'bot-alert:' || new.id,
    case when new.level = 'urgent' then 'בוט: דחוף' else 'בוט מדווח' end,
    (select display_name from profiles where id = new.user_id) || ': ' || new.reason, '#/admin?tab=sender');
  perform push_kick();
  return new;
end $$;
drop trigger if exists bot_alert_push on bot_alerts;
create trigger bot_alert_push after insert on bot_alerts for each row execute function bot_alert_push();

create or replace function bot_alerts_seen(p_ids bigint[]) returns void
language sql security definer set search_path = public as $$
  update bot_alerts set seen_at = now() where id = any(p_ids) and seen_at is null and is_owner();
$$;

create or replace function bot_alert_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from bot_alerts where seen_at is null and is_owner();
$$;

-- Complaints about בוט ("יש לי תלונה עליך", or why someone got annoyed with him): written by the Edge Function,
-- read by the owner, who copies the open ones to improve the bot and marks them handled.
create table if not exists bot_complaints (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles on delete cascade,
  complaint   text not null check (char_length(complaint) between 1 and 1000),
  quote       text not null default '' check (char_length(quote) <= 1000),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);
alter table bot_complaints enable row level security;
alter table bot_complaints add column if not exists suggestion text not null default '' check (char_length(suggestion) <= 1000);
alter table bot_complaints add column if not exists rule_id bigint;

-- Rules the bot learned from complaints the owner approved ("אישור ותיקון אוטומטי"): the Edge Function asks Gemini
-- to turn the complaint into a short instruction and appends the active ones to the bot's prompt (below the privacy
-- rules, which they can never override). The owner can switch a rule off or delete it.
create table if not exists bot_prompt_rules (
  id            bigint generated always as identity primary key,
  rule          text not null check (char_length(rule) between 1 and 600),
  complaint_id  bigint references bot_complaints on delete set null,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
alter table bot_prompt_rules enable row level security;
drop policy if exists bot_prompt_rules_owner on bot_prompt_rules;
create policy bot_prompt_rules_owner on bot_prompt_rules for select using (is_owner());

-- The owner edits the bot's instructions (admin tab "פקודות ל-AI"): one row per kind ('chat', 'gag', 'improve');
-- no row = the default in the Edge Function. Live data (members, recent chat, learned rules) is always added by code.
create table if not exists bot_prompts (
  key         text primary key check (key in ('chat', 'gag', 'improve')),
  body        text not null check (char_length(body) between 20 and 30000),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles on delete set null
);
alter table bot_prompts enable row level security;
drop policy if exists bot_prompts_owner on bot_prompts;
create policy bot_prompts_owner on bot_prompts for select using (is_owner());

create or replace function bot_prompt_set(p_key text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'רק מנהל-העל' using errcode = '42501'; end if;
  if nullif(trim(coalesce(p_body, '')), '') is null then
    delete from bot_prompts where key = p_key;  -- back to the default
  else
    insert into bot_prompts (key, body, updated_by) values (p_key, p_body, auth.uid())
    on conflict (key) do update set body = excluded.body, updated_at = now(), updated_by = excluded.updated_by;
  end if;
end $$;
revoke execute on function bot_prompt_set(text, text) from anon, public;
grant execute on function bot_prompt_set(text, text) to authenticated;

-- Every call the Edge Function makes to an AI: what was sent (instructions + messages) and what came back.
-- Owner only; only the last 300 calls are kept.
create table if not exists bot_api_log (
  id          bigint generated always as identity primary key,
  user_id     uuid references profiles on delete set null,
  mode        text not null,
  model       text not null default '',
  system      text not null default '',
  messages    jsonb,
  response    text not null default '',
  created_at  timestamptz not null default now()
);
alter table bot_api_log enable row level security;
drop policy if exists bot_api_log_owner on bot_api_log;
create policy bot_api_log_owner on bot_api_log for select using (is_owner());

create or replace function bot_api_log_prune() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from bot_api_log where id <= (select max(id) - 300 from bot_api_log);
  return null;
end $$;
drop trigger if exists bot_api_log_prune on bot_api_log;
create trigger bot_api_log_prune after insert on bot_api_log for each statement execute function bot_api_log_prune();

-- The owner's Claude (Anthropic API) key, used only for "אישור ותיקון אוטומטי" (better fixes than Gemini; falls
-- back to Gemini when missing or failing). Kept in site_settings (no policies): only the Edge Function reads it.
alter table site_settings add column if not exists anthropic_key text;
alter table site_settings add column if not exists anthropic_error text;
alter table site_settings add column if not exists anthropic_used_at timestamptz;

create or replace function ai_claude_key_set(p_key text) returns void
language plpgsql security definer set search_path = public as $$
declare k text := nullif(trim(coalesce(p_key, '')), '');
begin
  if not is_owner() then raise exception 'רק מנהל-העל' using errcode = '42501'; end if;
  if k is not null and (k not like 'sk-ant-%' or char_length(k) not between 20 and 300) then
    raise exception 'זה לא נראה כמו מפתח של Claude (מתחיל ב-sk-ant-)';
  end if;
  insert into site_settings (id) values (1) on conflict (id) do nothing;
  update site_settings set anthropic_key = k, anthropic_error = null where id = 1;
end $$;

create or replace function ai_claude_key_status(out has_key boolean, out masked text, out last_error text, out used_at timestamptz)
language sql stable security definer set search_path = public as $$
  select anthropic_key is not null, case when anthropic_key is null then null else left(anthropic_key, 10) || '…' || right(anthropic_key, 4) end,
         anthropic_error, anthropic_used_at
    from site_settings where id = 1 and is_owner();
$$;
revoke execute on function ai_claude_key_set(text), ai_claude_key_status() from anon, public;
grant execute on function ai_claude_key_set(text), ai_claude_key_status() to authenticated;

-- The owner approves a rule he worked out with Claude in the complaint dialog: saved and the complaint closed.
create or replace function bot_rule_add(p_complaint bigint, p_rule text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if not is_owner() then raise exception 'רק מנהל-העל' using errcode = '42501'; end if;
  if char_length(trim(coalesce(p_rule, ''))) not between 5 and 600 then raise exception 'התיקון ריק או ארוך מדי'; end if;
  insert into bot_prompt_rules (rule, complaint_id) values (trim(p_rule), p_complaint) returning id into v;
  update bot_complaints set handled_at = now(), rule_id = v where id = p_complaint;
  return v;
end $$;
revoke execute on function bot_rule_add(bigint, text) from anon, public;
grant execute on function bot_rule_add(bigint, text) to authenticated;

create or replace function bot_rule_set(p_id bigint, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'אין הרשאה' using errcode = '42501'; end if;
  if p_active is null then delete from bot_prompt_rules where id = p_id;
  else update bot_prompt_rules set active = p_active where id = p_id; end if;
end $$;
revoke execute on function bot_rule_set(bigint, boolean) from anon, public;
grant execute on function bot_rule_set(bigint, boolean) to authenticated;
drop policy if exists bot_complaints_owner on bot_complaints;
create policy bot_complaints_owner on bot_complaints for select using (is_owner());

create or replace function bot_complaints_handled(p_ids bigint[]) returns void
language sql security definer set search_path = public as $$
  update bot_complaints set handled_at = now() where id = any(p_ids) and handled_at is null and is_owner();
$$;
revoke execute on function bot_complaints_handled(bigint[]) from anon, public;
grant execute on function bot_complaints_handled(bigint[]) to authenticated;

-- Owner: who talks to בוט, how much, strikes and blocks (to pick conversations to look at).
create or replace function bot_overview()
returns table (user_id uuid, messages int, last_at timestamptz, strikes int, blocked_until timestamptz, alerts int)
language sql stable security definer set search_path = public as $$
  select m.user_id, count(*)::int, max(m.created_at), coalesce(max(s.strikes), 0), max(s.blocked_until),
         (select count(*)::int from bot_alerts a where a.user_id = m.user_id)
    from bot_messages m left join bot_state s on s.user_id = m.user_id
   where m.role = 'user' and is_owner()
   group by m.user_id order by max(m.created_at) desc;
$$;

revoke execute on function bot_alerts_seen(bigint[]), bot_alert_count(), bot_overview() from anon, public;
grant execute on function bot_alerts_seen(bigint[]), bot_alert_count(), bot_overview() to authenticated;

-- ---------- Row Level Security ----------
alter table profiles         enable row level security;
alter table channels         enable row level security;
alter table messages         enable row level security;
alter table channel_reads    enable row level security;
alter table reactions        enable row level security;
alter table stars            enable row level security;
alter table preapproved_emails enable row level security;
alter table roster           enable row level security;
alter table polls            enable row level security;
alter table feedback         enable row level security;
alter table feedback_messages enable row level security;
alter table birthdays        enable row level security;
alter table birthday_posts   enable row level security;  -- no policies: functions only
alter table nicknames        enable row level security;  -- no policies: functions only
alter table nickname_votes   enable row level security;  -- no policies: functions only
alter table email_prefs      enable row level security;
alter table email_queue      enable row level security;  -- no policies: triggers and the email job only
alter table events           enable row level security;
alter table message_reports  enable row level security;
alter table mute_log         enable row level security;
alter table scheduled_messages enable row level security;
alter table room_mutes       enable row level security;
alter table push_subscriptions enable row level security;
alter table push_prefs       enable row level security;
alter table push_queue       enable row level security;  -- no policies: triggers and the push job only
alter table push_config      enable row level security;  -- no policies: the push job only
alter table confessions      enable row level security;
alter table confession_reactions enable row level security;
alter table confession_comments  enable row level security;
alter table quote_quizzes    enable row level security;  -- no policies: functions only (hides the answer)
alter table quiz_guesses     enable row level security;  -- no policies: functions only
alter table poll_options     enable row level security;
alter table poll_votes       enable row level security;
alter table message_likes    enable row level security;
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
  using (is_active() and (author_id = auth.uid() or owns_anon('message', id) or can_remove_content()));

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

-- likes: visible to all members; not on your own message (named or anonymous)
drop policy if exists likes_select on message_likes;
create policy likes_select on message_likes for select using (is_active());
drop policy if exists likes_insert on message_likes;
create policy likes_insert on message_likes for insert with check (
  is_active() and user_id = auth.uid()
  and not exists (select 1 from messages m where m.id = message_id and (m.author_id = auth.uid() or m.deleted))
  and not owns_anon('message', message_id)
);
drop policy if exists likes_delete on message_likes;
create policy likes_delete on message_likes for delete using (user_id = auth.uid());

-- Guest view (see site_settings): read-only, only while an admin keeps it open.
drop policy if exists channels_guest on channels;
create policy channels_guest on channels for select to anon, authenticated using (guest_view_open());
drop policy if exists messages_guest on messages;
create policy messages_guest on messages for select to anon, authenticated using (guest_view_open());
drop policy if exists profiles_guest on profiles;
create policy profiles_guest on profiles for select to anon, authenticated using (status = 'active' and guest_view_open());
drop policy if exists reactions_guest on reactions;
create policy reactions_guest on reactions for select to anon, authenticated using (guest_view_open());
drop policy if exists likes_guest on message_likes;
create policy likes_guest on message_likes for select to anon, authenticated using (guest_view_open());
drop policy if exists polls_guest on polls;
create policy polls_guest on polls for select to anon, authenticated using (guest_view_open());
drop policy if exists poll_options_guest on poll_options;
create policy poll_options_guest on poll_options for select to anon, authenticated using (guest_view_open());
drop policy if exists confessions_guest on confessions;
create policy confessions_guest on confessions for select to anon, authenticated using (guest_view_open());
drop policy if exists confession_reactions_guest on confession_reactions;
create policy confession_reactions_guest on confession_reactions for select to anon, authenticated using (guest_view_open());
drop policy if exists confession_comments_guest on confession_comments;
create policy confession_comments_guest on confession_comments for select to anon, authenticated using (guest_view_open());
drop policy if exists events_guest on events;
create policy events_guest on events for select to anon, authenticated using (guest_view_open());

-- pre-approved emails: admins only (adding goes through add_preapproved)
drop policy if exists preapproved_admin_select on preapproved_emails;
create policy preapproved_admin_select on preapproved_emails for select using (is_admin());
drop policy if exists preapproved_admin_delete on preapproved_emails;
create policy preapproved_admin_delete on preapproved_emails for delete using (is_admin());

-- roster: admins only (adding goes through add_roster)
drop policy if exists roster_admin_select on roster;
create policy roster_admin_select on roster for select using (is_admin());
drop policy if exists roster_admin_delete on roster;
create policy roster_admin_delete on roster for delete using (is_admin());

-- polls: visible to members; created, answered and closed only through the functions above.
-- A vote row is visible only to the voter (totals come from poll_results()).
drop policy if exists polls_select on polls;
create policy polls_select on polls for select using (is_active());
drop policy if exists polls_delete on polls;
create policy polls_delete on polls for delete using (is_active() and (author_id = auth.uid() or can_remove_content()));
drop policy if exists poll_options_select on poll_options;
create policy poll_options_select on poll_options for select using (is_active());
drop policy if exists poll_votes_own on poll_votes;
create policy poll_votes_own on poll_votes for select using (user_id = auth.uid());

-- contact requests: the sender reads his own, admins read and delete all; written only through the functions
drop policy if exists feedback_select on feedback;
create policy feedback_select on feedback for select using (is_active() and (author_id = auth.uid() or is_admin()));
drop policy if exists feedback_messages_select on feedback_messages;
create policy feedback_messages_select on feedback_messages for select using (
  is_active() and exists (select 1 from feedback f where f.id = feedback_id and (f.author_id = auth.uid() or is_admin()))
);
drop policy if exists feedback_delete on feedback;
create policy feedback_delete on feedback for delete using (is_admin());

-- birthdays and email preferences: each member manages only his own row
drop policy if exists birthdays_own on birthdays;
create policy birthdays_own on birthdays for all using (user_id = auth.uid() and is_active()) with check (user_id = auth.uid() and is_active());
drop policy if exists email_prefs_own on email_prefs;
create policy email_prefs_own on email_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- confessions: read by members; posted and deleted through the functions above
drop policy if exists confessions_select on confessions;
create policy confessions_select on confessions for select using (is_active());
drop policy if exists confession_reactions_select on confession_reactions;
create policy confession_reactions_select on confession_reactions for select using (is_active());
drop policy if exists confession_reactions_insert on confession_reactions;
create policy confession_reactions_insert on confession_reactions for insert with check (is_active() and user_id = auth.uid());
drop policy if exists confession_reactions_delete on confession_reactions;
create policy confession_reactions_delete on confession_reactions for delete using (user_id = auth.uid());
drop policy if exists confession_comments_select on confession_comments;
create policy confession_comments_select on confession_comments for select using (is_active());
drop policy if exists confession_comments_insert on confession_comments;
create policy confession_comments_insert on confession_comments for insert with check (is_active() and not is_muted() and author_id = auth.uid());
drop policy if exists confession_comments_delete on confession_comments;
create policy confession_comments_delete on confession_comments for delete using (author_id = auth.uid() or can_remove_content());

-- moderation: moderators read the mute log; reports only through report_list()
drop policy if exists mute_log_select on mute_log;
create policy mute_log_select on mute_log for select using (can_remove_content());
-- my scheduled messages, muted rooms, devices and push settings
drop policy if exists scheduled_own_select on scheduled_messages;
create policy scheduled_own_select on scheduled_messages for select using (user_id = auth.uid());
drop policy if exists scheduled_own_delete on scheduled_messages;
create policy scheduled_own_delete on scheduled_messages for delete using (user_id = auth.uid() and sent_at is null);
drop policy if exists room_mutes_own on room_mutes;
create policy room_mutes_own on room_mutes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists push_subs_own on push_subscriptions;
create policy push_subs_own on push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid() and is_active());
drop policy if exists push_prefs_own on push_prefs;
create policy push_prefs_own on push_prefs for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- events: members read the calendar; all writes go through the functions above
drop policy if exists events_select on events;
create policy events_select on events for select using (is_active());

drop policy if exists stars_own on stars;
create policy stars_own on stars for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- DM reactions: visible to the conversation; written only through toggle_dm_reaction()
drop policy if exists dm_reactions_select on dm_reactions;
create policy dm_reactions_select on dm_reactions for select using (
  is_active() and exists (select 1 from dm_messages m where m.id = message_id and (is_dm_participant(m.conversation_id) or is_owner()))
);

-- anonymous authorship: each author sees only their own rows, the owner sees all; written only by the functions above
drop policy if exists anon_authors_own on anon_authors;
create policy anon_authors_own on anon_authors for select using (author_id = auth.uid() or is_owner());

-- walls (created via post_wall only)
drop policy if exists wall_select on wall_posts;
create policy wall_select on wall_posts for select using (is_active());
drop policy if exists wall_delete on wall_posts;
create policy wall_delete on wall_posts for delete using (
  is_active() and (profile_id = auth.uid() or author_id = auth.uid() or owns_anon('wall', id) or can_remove_content())
);

-- direct conversations (private to participants; admins and moderators cannot read them, only the owner)
drop policy if exists dm_conv_select on dm_conversations;
create policy dm_conv_select on dm_conversations for select using (is_active() and (is_dm_participant(id) or is_owner()));
drop policy if exists dm_part_select on dm_participants;
create policy dm_part_select on dm_participants for select using (
  is_active() and (user_id = auth.uid() or (not hidden and is_dm_participant(conversation_id)) or is_owner())
);
drop policy if exists dm_msg_select on dm_messages;
create policy dm_msg_select on dm_messages for select using (is_active() and (is_dm_participant(conversation_id) or is_owner()));
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
alter table message_likes replica identity full;
do $$
declare t text;
begin
  foreach t in array array['messages', 'reactions', 'message_likes', 'profiles', 'channels', 'wall_posts', 'dm_messages', 'dm_reactions', 'polls', 'events', 'bot_messages'] loop
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
  -- Admins, moderators and inspectors may physically delete any stored photo or video.
  -- Chat photos and profile pictures, only while guest view is open (see site_settings).
  execute 'drop policy if exists media_guest_read on storage.objects';
  execute $p$create policy media_guest_read on storage.objects for select to anon
             using (bucket_id = 'media' and public.guest_view_open())$p$;
  execute 'drop policy if exists media_delete on storage.objects';
  execute $p$create policy media_delete on storage.objects for delete to authenticated
             using (bucket_id = 'media' and public.can_remove_content())$p$;
  execute 'drop policy if exists media_upload on storage.objects';
  execute $p$create policy media_upload on storage.objects for insert to authenticated
             with check (bucket_id = 'media' and public.is_active()
                         and (name ~ '^m/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|gif|mp4|webm|mov)$'
                              or name ~ '^a/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$'
                              or name ~ '^c/[0-9a-f-]{36}\.jpg$'))$p$;
end $$;

-- ---------- Refresh the API ----------
-- Tell the Supabase REST API (PostgREST) to reload its schema cache now, so new functions are
-- available immediately instead of returning "function not found" for a while.
notify pgrst, 'reload schema';
