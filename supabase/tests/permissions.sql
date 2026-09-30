-- Permission tests. Runs against a plain Postgres with a mocked Supabase `auth` schema
-- (see supabase/tests/run.sh). Every check raises an exception on failure.
\set ON_ERROR_STOP 1
\o /dev/null
set client_min_messages = warning;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@x.com', '{"display_name":"מנהלת"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@x.com',   '{"display_name":"בוב"}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@x.com', '{}'),
  ('00000000-0000-0000-0000-00000000000d', 'dave@x.com',  '{"display_name":"דייב"}');

create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', what; end if;
  raise notice 'ok  %', what;
end $$;

create or replace function pg_temp.as_user(u text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u, false);
  execute 'set role authenticated';
end $$;

-- expects `sql` to be rejected (RLS / permission / raised business error)
create or replace function pg_temp.denied(sql text, what text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception
    when insufficient_privilege or raise_exception or check_violation or unique_violation then
      raise notice 'ok  %', what;
      return;
  end;
  raise exception 'FAIL (was allowed): %', what;
end $$;

set client_min_messages = notice;

select pg_temp.check((select count(*) = 1 from channels where is_main), 'fresh install has exactly one main room');

-- ===== Membership =====
select pg_temp.check((select role = 'admin' and status = 'active' from profiles where id = '00000000-0000-0000-0000-00000000000a'), 'first user is active admin');
select pg_temp.check((select status = 'pending' from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'second user pending');
select pg_temp.check((select display_name = 'carol' from profiles where id = '00000000-0000-0000-0000-00000000000c'), 'display name falls back to email prefix');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) = 0 from channels), 'pending user cannot read rooms');
select pg_temp.check((select count(*) = 1 from profiles), 'pending user sees only own profile');
update profiles set status = 'active', role = 'admin' where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select status = 'pending' and role = 'member' from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'pending user cannot self-approve/promote');
update profiles set display_name = 'בוב החדש', bio = 'שלום' where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select display_name = 'בוב החדש' and bio = 'שלום' from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'user can edit own name and bio');
select pg_temp.denied($$select send_message((select id from channels where is_main), 'x')$$, 'pending user cannot post');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update profiles set status = 'active' where id in ('00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d');
update profiles set display_name = 'hacked' where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select status = 'active' and display_name = 'בוב החדש' from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'admin approves but cannot rename others');
reset role;

-- ===== Main room chat =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.denied($$insert into messages (channel_id, author_id, body) values ((select id from channels where is_main), auth.uid(), 'direct')$$, 'direct message insert is blocked');
select send_message((select id from channels where is_main), 'שלום לכולם');
select send_message((select id from channels where is_main), 'תשובה', (select id from messages where body = 'שלום לכולם'));
select pg_temp.check((select reply_to is not null from messages where body = 'תשובה'), 'quote reply kept');
update messages set body = 'ערוך' where body = 'תשובה';
select pg_temp.check((select edited_at is not null from messages where body = 'ערוך'), 'edit sets edited_at');
delete from channels where is_main;
select pg_temp.check((select count(*) = 1 from channels where is_main), 'member cannot delete main room');
update channels set name = 'hack' where is_main;
select pg_temp.check((select name <> 'hack' from channels where is_main), 'member cannot rename main room');
reset role;

-- ===== Rooms =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select create_room('טיול שנתי', 'תיאום הטיול');
select pg_temp.check((select created_by = auth.uid() and not is_main from channels where name = 'טיול שנתי'), 'member can open a room');
update channels set name = 'טיול שנתי 2026', admin_only_post = true, is_main = true where name = 'טיול שנתי';
select pg_temp.check((select not admin_only_post and not is_main from channels where name = 'טיול שנתי 2026'), 'creator renames room but cannot make it main/announcement');
select send_message((select id from channels where name = 'טיול שנתי 2026'), 'מי מגיע?');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
update channels set name = 'hijack' where name = 'טיול שנתי 2026';
select pg_temp.check((select count(*) = 1 from channels where name = 'טיול שנתי 2026'), 'others cannot rename a room');
delete from channels where name = 'טיול שנתי 2026';
select pg_temp.check((select count(*) = 1 from channels where name = 'טיול שנתי 2026'), 'others cannot delete a room');
select pg_temp.check((select unread = 1 from my_rooms() where name = 'טיול שנתי 2026'), 'unread counted per room');
select mark_room_read((select id from channels where name = 'טיול שנתי 2026'));
select pg_temp.check((select unread = 0 from my_rooms() where name = 'טיול שנתי 2026'), 'mark read clears unread');
select pg_temp.check((select is_main from my_rooms() limit 1), 'main room listed first');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update channels set admin_only_post = true where name = 'טיול שנתי 2026';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.denied($$select send_message((select id from channels where name = 'טיול שנתי 2026'), 'x')$$, 'announcement room rejects members');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
delete from channels where name = 'טיול שנתי 2026';
select pg_temp.check((select count(*) = 0 from channels where name = 'טיול שנתי 2026'), 'creator can delete own room');
reset role;

-- ===== Likes & reputation =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into reactions (message_id, user_id, emoji) values ((select id from messages where body = 'שלום לכולם'), auth.uid(), '🔥');
select pg_temp.denied($$insert into message_likes (message_id, user_id) values ((select id from messages where body = 'שלום לכולם'), auth.uid())$$, 'cannot like own message');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
insert into reactions (message_id, user_id) values ((select id from messages where body = 'שלום לכולם'), auth.uid());
insert into reactions (message_id, user_id, emoji) values ((select id from messages where body = 'שלום לכולם'), auth.uid(), '❤️');
select pg_temp.check((select count(*) = 3 from reactions), 'emoji reactions stored (default 👍)');
select pg_temp.denied($$insert into reactions (message_id, user_id) values ((select id from messages where body = 'שלום לכולם'), '00000000-0000-0000-0000-00000000000d')$$, 'cannot like on behalf of others');
-- emoji reactions are expression only: bob has 2 messages and no likes yet -> 2
select pg_temp.check((select reputation = 2 and likes = 0 from member_stats() where id = '00000000-0000-0000-0000-00000000000b'), 'emoji reactions do not count toward reputation');
insert into message_likes (message_id, user_id) values ((select id from messages where body = 'שלום לכולם'), auth.uid());
select pg_temp.denied($$insert into message_likes (message_id, user_id) values ((select id from messages where body = 'שלום לכולם'), auth.uid())$$, 'one like per member per message');
select pg_temp.denied($$insert into message_likes (message_id, user_id) values ((select id from messages where body = 'שלום לכולם'), '00000000-0000-0000-0000-00000000000d')$$, 'cannot like on behalf of others');
-- bob: 2 messages + 1 like -> 1*5 + 2 = 7
select pg_temp.check((select reputation = 7 and likes = 1 from member_stats() where id = '00000000-0000-0000-0000-00000000000b'), 'likes build reputation');
reset role;

-- ===== Moderation =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update messages set body = 'rewritten' where body = 'ערוך';
select pg_temp.check((select count(*) = 1 from messages where body = 'ערוך'), 'mod cannot rewrite others message');
update messages set deleted = true where body = 'ערוך';
select pg_temp.check((select deleted and body = '' from messages where reply_to is not null and channel_id = (select id from channels where is_main)), 'mod soft delete wipes body');
delete from reactions;
select pg_temp.check((select count(*) = 3 from reactions), 'cannot remove others reactions');
select pg_temp.check((select count(*) = 0 from channel_reads where user_id <> auth.uid()), 'read markers are private');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
update messages set deleted = false, body = 'back' where deleted;
select pg_temp.check((select count(*) = 0 from messages where body = 'back'), 'deleted message stays deleted');
reset role;

-- ===== Anonymous room messages =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select send_message((select id from channels where is_main), 'הודעה אנונימית', null, true);
select pg_temp.check((select author_id is null and anonymous from messages where body = 'הודעה אנונימית'), 'anonymous message stores no author');
select pg_temp.check((select count(*) = 1 from anon_authors), 'author sees own anonymous items');
update messages set body = 'עריכה אנונימית' where body = 'הודעה אנונימית';
select pg_temp.check((select count(*) = 1 from messages where body = 'עריכה אנונימית'), 'anonymous author can edit own message');
insert into reactions (message_id, user_id, emoji) select id, auth.uid(), '😊' from messages where body = 'עריכה אנונימית';
select pg_temp.denied($$insert into message_likes (message_id, user_id) select id, auth.uid() from messages where body = 'עריכה אנונימית'$$, 'cannot like own anonymous message');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) = 0 from anon_authors), 'others cannot see anonymous authorship');
update messages set body = 'hijack' where body = 'עריכה אנונימית';
select pg_temp.check((select count(*) = 1 from messages where body = 'עריכה אנונימית'), 'others cannot edit anonymous message');
insert into reactions (message_id, user_id) select id, auth.uid() from messages where body = 'עריכה אנונימית';
insert into message_likes (message_id, user_id) select id, auth.uid() from messages where body = 'עריכה אנונימית';
select pg_temp.check((select reputation = 0 from member_stats() where id = '00000000-0000-0000-0000-00000000000c'), 'anonymous content earns no reputation (no leak)');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) = 0 from anon_authors), 'admins cannot see anonymous authorship');
reset role;

-- ===== Admin controls anonymity =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
update profiles set accept_anonymous = false, can_send_anonymous = false where id = auth.uid();
select pg_temp.check((select accept_anonymous and can_send_anonymous from profiles where id = auth.uid()), 'members cannot change their own anonymity permissions');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update profiles set can_send_anonymous = false where id = '00000000-0000-0000-0000-00000000000d';
update profiles set accept_anonymous = false where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select not can_send_anonymous from profiles where id = '00000000-0000-0000-0000-00000000000d'), 'admin sets who may send anonymously');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.denied($$select send_message((select id from channels where is_main), 'x', null, true)$$, 'blocked sender cannot post anonymously in rooms');
select pg_temp.denied($$select start_dm('00000000-0000-0000-0000-00000000000c', true)$$, 'blocked sender cannot open anonymous DM');
select pg_temp.denied($$select post_wall('00000000-0000-0000-0000-00000000000c', 'x', true)$$, 'blocked sender cannot post anonymously on walls');
select send_message((select id from channels where is_main), 'בשמי זה בסדר');
reset role;

-- ===== Walls =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select post_wall('00000000-0000-0000-0000-00000000000a', 'כל הכבוד!', false);
select post_wall('00000000-0000-0000-0000-00000000000a', 'מעריץ סודי', true);
select pg_temp.denied($$select post_wall('00000000-0000-0000-0000-00000000000b', 'x', true)$$, 'recipient blocked by admin: no anonymous wall posts');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) = 2 and count(author_id) = 1 from wall_posts), 'wall visible; anonymous post hides author');
delete from wall_posts;
select pg_temp.check((select count(*) = 2 from wall_posts), 'stranger cannot delete wall posts');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
delete from wall_posts where anonymous and profile_id = auth.uid();
select pg_temp.check((select count(*) = 1 from wall_posts), 'wall owner can delete posts on their wall');
reset role;

-- ===== Direct conversations =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.denied($$select start_dm('00000000-0000-0000-0000-00000000000b', true)$$, 'recipient blocked by admin: no anonymous DMs');
select pg_temp.check((select start_dm('00000000-0000-0000-0000-00000000000a') = start_dm('00000000-0000-0000-0000-00000000000a')), 'regular DM is reused');
select send_dm(1, 'היי');
select pg_temp.check((select start_dm('00000000-0000-0000-0000-00000000000a', true) = start_dm('00000000-0000-0000-0000-00000000000a', true)), 'anonymous DM is reused');
select send_dm(2, 'הודעה סודית');
select pg_temp.check((select sender_id is null from dm_messages where conversation_id = 2), 'anonymous DM stores no sender');
select pg_temp.check((select count(*) = 2 and bool_and(last_from_me) from my_conversations()), 'sender sees both conversations as theirs');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) = 1 from dm_participants where conversation_id = 2), 'recipient cannot see hidden sender');
select pg_temp.check((select other_id is null and unread = 1 from my_conversations() where id = 2), 'recipient list hides anonymous sender');
select send_dm(2, 'מי אתה?');
select mark_dm_read(2);
select pg_temp.check((select unread = 0 from my_conversations() where id = 2), 'mark read clears unread');
-- admin now revokes carol's anonymous sending: the open anonymous chat must stop too
update profiles set can_send_anonymous = false where id = '00000000-0000-0000-0000-00000000000c';
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.denied($$select send_dm(2, 'עוד')$$, 'revoked sender cannot continue an open anonymous chat');
select send_dm(1, 'בשמי עדיין אפשר');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update profiles set can_send_anonymous = true where id = '00000000-0000-0000-0000-00000000000c';
select set_dm_closed(2, true);
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.denied($$select send_dm(2, 'עוד')$$, 'blocked anonymous chat rejects sender');
select pg_temp.denied($$select set_dm_closed(2, false)$$, 'anonymous sender cannot unblock');
update dm_messages set deleted = true where conversation_id = 2 and sender_id is null;
select pg_temp.check((select bool_and(deleted) from dm_messages where conversation_id = 2 and sender_id is null), 'anonymous sender can delete own DM');
update dm_messages set body = 'x' where conversation_id = 2 and sender_id is not null;
select pg_temp.check((select body = 'מי אתה?' from dm_messages where conversation_id = 2 and sender_id is not null), 'cannot edit the other side''s DM');
reset role;

select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) = 0 from dm_messages), 'outsiders cannot read private conversations');
select pg_temp.denied($$select send_dm(1, 'intrude')$$, 'outsider cannot write into a conversation');
reset role;

-- ===== Media, pins, stars, unread =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select send_message((select id from channels where is_main), '', null, false,
  '{"type":"image","path":"m/0f8fad5b-d9cb-469f-a165-70867728950e.jpg","width":800,"height":600}'::jsonb);
select pg_temp.check((select count(*) = 1 from messages where body = '' and attachment ->> 'type' = 'image'), 'photo message without text');
select pg_temp.denied($$select send_message((select id from channels where is_main), '', null, false, '{"type":"image","path":"../evil.sh"}'::jsonb)$$, 'bad attachment path rejected');
select pg_temp.denied($$select send_message((select id from channels where is_main), '')$$, 'empty message rejected');
select send_message((select id from channels where is_main), 'הועבר', null, false, null, true);
select pg_temp.check((select forwarded from messages where body = 'הועבר'), 'forwarded flag stored');
update messages set pinned_at = now() where body = 'בשמי זה בסדר';
select pg_temp.check((select pinned_at is null from messages where body = 'בשמי זה בסדר'), 'pins cannot be set directly');
select set_message_pinned((select id from messages where body = 'בשמי זה בסדר'), true);
select pg_temp.check((select pinned_at is not null and pinned_by = auth.uid() from messages where body = 'בשמי זה בסדר'), 'member pins a message');
update messages set attachment = null, forwarded = false where body = 'הועבר';
select pg_temp.check((select forwarded from messages where body = 'הועבר'), 'forwarded/attachment are immutable');
insert into stars (user_id, kind, item_id) select auth.uid(), 'room', id from messages where body = 'בשמי זה בסדר';
select mark_room_unread((select id from messages where body = 'שלום לכולם'));
select pg_temp.check((select unread >= 1 from my_rooms() where is_main), 'mark as unread from a message');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) = 0 from stars), 'stars are private');
select pg_temp.check((select count(*) = 1 from messages where pinned_at is not null), 'pins are visible to all');
select set_message_pinned((select id from messages where body = 'בשמי זה בסדר'), false);
select pg_temp.check((select count(*) = 0 from messages where pinned_at is not null), 'members can unpin');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update messages set deleted = true where body = '' and attachment is not null;
select pg_temp.check((select count(*) = 0 from messages where attachment is not null), 'deleting a photo message removes the attachment');
reset role;

-- ===== Profile photo =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
update profiles set avatar_path = 'a/0f8fad5b-d9cb-469f-a165-70867728950e.jpg' where id = auth.uid();
select pg_temp.check((select avatar_path is not null from profiles where id = auth.uid()), 'member sets own profile photo');
select pg_temp.denied($$update profiles set avatar_path = 'm/../../x.sh' where id = auth.uid()$$, 'invalid photo path rejected');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
update profiles set avatar_path = null where id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check((select avatar_path is not null from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'others cannot change a profile photo');
reset role;

-- ===== DM reactions and replies keep the anonymous side hidden =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select set_dm_closed(2, false);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select send_dm(2, 'עוד שאלה', (select id from dm_messages where body = 'מי אתה?'));
select pg_temp.check((select reply_to is not null from dm_messages where body = 'עוד שאלה'), 'DM quote reply');
select pg_temp.check((select toggle_dm_reaction((select id from dm_messages where body = 'מי אתה?'), '😂')), 'hidden side reacts');
select pg_temp.check((select user_id is null and hidden from dm_reactions), 'hidden reaction stores no user');
select pg_temp.check((select not toggle_dm_reaction((select id from dm_messages where body = 'מי אתה?'), '😂')), 'second toggle removes reaction');
select toggle_dm_reaction((select id from dm_messages where body = 'מי אתה?'), '👍');
select mark_dm_unread((select id from dm_messages where body = 'מי אתה?'));
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) = 1 and bool_and(user_id is null) from dm_reactions), 'recipient sees reaction but not who');
select toggle_dm_reaction((select id from dm_messages where body = 'עוד שאלה'), '🙏');
select pg_temp.check((select count(*) = 1 from dm_reactions where user_id = auth.uid()), 'visible side reacts under own id');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) = 0 from dm_reactions), 'outsiders cannot see DM reactions');
select pg_temp.denied($$select toggle_dm_reaction((select min(id) from dm_messages), '👍')$$, 'outsiders cannot react in DMs');
reset role;

-- ===== Pre-approved emails & content rules =====
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'waiting@x.com');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.denied($$select * from add_preapproved('[{"email":"x@x.com"}]'::jsonb)$$, 'only admins pre-approve');
select pg_temp.check((select count(*) = 0 from preapproved_emails), 'members cannot read the pre-approved list');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) = 4 from add_preapproved('[
  {"email":" New@X.com ","name":"בחור חדש"},
  {"email":"waiting@x.com"},
  {"email":"bob@x.com"},
  {"email":"not-an-email"},
  {"email":"other@y.org"}]'::jsonb)), 'invalid lines are skipped');
select pg_temp.check((select status = 'active' from profiles where id = '00000000-0000-0000-0000-0000000000e1'), 'pending account on the list is let in');
select pg_temp.check((select count(*) = 3 and bool_and(email = lower(email)) from preapproved_emails), 'list stored lower-case');
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e2', 'new@x.com', '{}');
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e3', 'stranger@x.com', '{"terms_accepted_at":"2026-01-01"}');
select pg_temp.check((select status = 'active' and display_name = 'בחור חדש' and terms_accepted_at is null from profiles where id = '00000000-0000-0000-0000-0000000000e2'), 'pre-approved sign-up is active at once, with the given name');
select pg_temp.check((select used_at is not null from preapproved_emails where email = 'new@x.com'), 'used pre-approval is marked');
select pg_temp.check((select status = 'pending' and terms_accepted_at is not null from profiles where id = '00000000-0000-0000-0000-0000000000e3'), 'others still wait; terms accepted at sign-up recorded');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e2');
update profiles set terms_accepted_at = '2000-01-01' where id = auth.uid();
select pg_temp.check((select terms_accepted_at > now() - interval '1 minute' from profiles where id = auth.uid()), 'member records acceptance, stamped now');
update profiles set terms_accepted_at = null where id = auth.uid();
select pg_temp.check((select terms_accepted_at is not null from profiles where id = auth.uid()), 'acceptance cannot be removed');
reset role;

-- ===== Bans =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update profiles set status = 'banned' where id = '00000000-0000-0000-0000-00000000000c';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select pg_temp.check((select count(*) = 0 from messages), 'banned user cannot read messages');
select pg_temp.check((select count(*) = 0 from dm_messages), 'banned user cannot read DMs');
select pg_temp.denied($$select send_dm(1, 'x')$$, 'banned user cannot send DMs');
select pg_temp.check((select count(*) = 0 from my_rooms()), 'banned user gets no rooms');
reset role;

\o
\echo ALL PERMISSION TESTS PASSED
