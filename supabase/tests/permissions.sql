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

-- ===== Roster: names on the yeshiva list get in at once =====
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000f1', 'f1@x.com', '{"display_name":"יוסף חיים ביטון"}');
select pg_temp.check((select status = 'pending' from profiles where id = '00000000-0000-0000-0000-0000000000f1'), 'empty roster: sign-up waits');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.denied($$select * from add_roster(array['כהן יוסף'])$$, 'only admins add roster names');
select pg_temp.denied($$select roster_match('כהן יוסף')$$, 'roster_match is internal');
update profiles set join_seen = false, joined_via = 'roster' where id = auth.uid();
select pg_temp.check((select join_seen and joined_via is null from profiles where id = auth.uid()), 'members cannot change join flags');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select added = 7 and activated = 1 from add_roster(array[
  'הנדלר משה-שמואל', 'ביטון יוסף-חיים', 'אדלר אליעזר-מאיר', 'כהן יוסף', 'כהן  יוסף', 'הופמן משה אהרון', 'x', 'וייס יצחק-יוסף'])), 'roster added; waiting match let in');
select pg_temp.check((select added = 0 and activated = 0 from add_roster(array['כהן יוסף', 'כהן יוסף', 'אדלר אליעזר-מאיר'])), 're-pasting adds nothing');
select pg_temp.check((select status = 'active' and joined_via = 'roster' and not join_seen from profiles where id = '00000000-0000-0000-0000-0000000000f1'), 'activated waiting member flagged for the admin');
reset role;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f2', 'f2@x.com', '{"display_name":"אליעזר אדלר"}'),
  ('00000000-0000-0000-0000-0000000000f3', 'f3@x.com', '{"display_name":"יוסף כהן"}'),
  ('00000000-0000-0000-0000-0000000000f4', 'f4@x.com', '{"display_name":"כהן יוסף"}'),
  ('00000000-0000-0000-0000-0000000000f5', 'f5@x.com', '{"display_name":"יוסף כהן"}'),
  ('00000000-0000-0000-0000-0000000000f6', 'f6@x.com', '{"display_name":"אהרן הופמן משה"}'),
  ('00000000-0000-0000-0000-0000000000f7', 'f7@x.com', '{"display_name":"יצחק ויס"}'),
  ('00000000-0000-0000-0000-0000000000f8', 'f8@x.com', '{"display_name":"כהן"}'),
  ('00000000-0000-0000-0000-0000000000f9', 'f9@x.com', '{"display_name":"משה שמואל"}');
select pg_temp.check((select bool_and(status = 'active' and joined_via = 'roster' and not join_seen) from profiles where id in ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f6', '00000000-0000-0000-0000-0000000000f7')),
  'roster names get in: any order, missing second name, ו/י spelling');
select pg_temp.check((select status = 'pending' from profiles where id = '00000000-0000-0000-0000-0000000000f5'), 'each roster name gets in once');
select pg_temp.check((select status = 'pending' from profiles where id = '00000000-0000-0000-0000-0000000000f8'), 'a single word never matches');
select pg_temp.check((select status = 'pending' from profiles where id = '00000000-0000-0000-0000-0000000000f9'), 'first names without the surname never match');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) = 0 from roster), 'members cannot read the roster');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) = 7 and count(claimed_by) = 6 from roster), 'admin sees the roster and who claimed it');
update profiles set join_seen = true where id = '00000000-0000-0000-0000-0000000000f2';
select pg_temp.check((select join_seen from profiles where id = '00000000-0000-0000-0000-0000000000f2'), 'admin marks a join as seen');
reset role;

-- ===== Profile background =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
update profiles set cover_path = 'c/11111111-1111-1111-1111-111111111111.jpg' where id = auth.uid();
select pg_temp.check((select cover_path is not null from profiles where id = auth.uid()), 'member sets his profile background');
select pg_temp.denied($$update profiles set cover_path = 'm/x.jpg' where id = auth.uid()$$, 'background must be a stored c/ image');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
update profiles set cover_path = null where id = '00000000-0000-0000-0000-00000000000b';
reset role;
select pg_temp.check((select cover_path is not null from profiles where id = '00000000-0000-0000-0000-00000000000b'), 'nobody else changes a member''s background');

-- ===== Contact the management =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select send_feedback('bug', 'הכפתור לא עובד') as fb_id \gset
select pg_temp.denied($$select send_feedback('spam', 'x')$$, 'unknown request type rejected');
select pg_temp.denied($$insert into feedback (author_id, kind, body) values (auth.uid(), 'idea', 'x')$$, 'requests only through send_feedback');
select pg_temp.denied('select reply_feedback(' || :fb_id || ', ''x'', true)', 'members cannot answer requests');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) = 0 from feedback), 'others cannot read a request');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) = 1 from feedback), 'admins read all requests');
select pg_temp.check((select open_feedback_count() = 1), 'admins see how many requests wait');
select feedback_post(:fb_id, 'תוכל לפרט?');
select reply_feedback(:fb_id, 'תוקן, תודה', true);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select status = 'done' and reply = 'תוקן, תודה' from feedback where id = :fb_id), 'sender sees the answer');
select pg_temp.check((select count(*) = 1 and bool_and(from_admin) from feedback_messages), 'member sees the management''s message');
select feedback_post(:fb_id, 'זה קורה בטלפון');
select pg_temp.check((select status = 'open' from feedback where id = :fb_id), 'member''s reply reopens the request');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.denied('select feedback_post(' || :fb_id || ', ''x'')', 'others cannot write in a request');
select pg_temp.check((select count(*) = 0 from feedback_messages), 'others cannot read a request''s conversation');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
update feedback set reply = 'זויף' where id = :fb_id;
select pg_temp.check((select reply = 'תוקן, תודה' from feedback where id = :fb_id), 'sender cannot change the answer');
reset role;

-- ===== Polls =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select create_poll('לאן יוצאים?', array['חברון', ' ', 'ירושלים', 'צפת'], false) as poll_id \gset
select pg_temp.check((select count(*) = 3 from poll_options where poll_id = :poll_id), 'poll created; blank answers dropped');
select pg_temp.check((select author_id = auth.uid() and body like 'סקר חדש:%' and channel_id = (select id from channels where is_main) from messages where poll_id = :poll_id), 'poll announced in the main room');
select pg_temp.denied($$select create_poll('x', array['רק אחת'])$$, 'a poll needs at least two answers');
update messages set poll_id = null where poll_id = :poll_id;
select pg_temp.check((select count(*) = 1 from messages where poll_id = :poll_id), 'announcement stays linked to its poll');
reset role;
select id as opt1 from poll_options where poll_id = :poll_id and position = 1 \gset
select id as opt2 from poll_options where poll_id = :poll_id and position = 2 \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select vote_poll(:poll_id, array[:opt1]::bigint[]);
select vote_poll(:poll_id, array[:opt2]::bigint[]);
select pg_temp.denied('select vote_poll(' || :poll_id || ', array[' || :opt1 || ',' || :opt2 || ']::bigint[])', 'single-choice poll takes one answer');
select pg_temp.denied('select vote_poll(' || :poll_id || ', array[-1]::bigint[])', 'answer must belong to the poll');
select pg_temp.denied('select set_poll_closed(' || :poll_id || ', true)', 'only the author closes a poll');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select vote_poll(:poll_id, array[:opt2]::bigint[]);
select pg_temp.check((select count(*) = 1 from poll_votes), 'votes are private: only my own row is visible');
select pg_temp.check((select votes = 2 and voters = 2 from poll_results(:poll_id) where option_id = :opt2), 'results count answers (changed vote counted once)');
select pg_temp.check((select votes = 0 from poll_results(:poll_id) where option_id = :opt1), 'changed vote leaves no trace');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select set_poll_closed(:poll_id, true);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.denied('select vote_poll(' || :poll_id || ', array[' || :opt1 || ']::bigint[])', 'closed poll takes no answers');
reset role;

-- ===== Hebrew calendar & birthdays =====
select pg_temp.check((select hy = 5787 and hm = 7 and hd = 1 from hebrew_date('2026-09-12')), 'Rosh Hashana 5787');
select pg_temp.check((select hy = 5784 and hm = 13 and hd = 14 from hebrew_date('2024-03-24')), 'Purim 5784 in Adar II');
select pg_temp.check((select hebrew_label(8, 12) = 'י"ב בחשון' and hebrew_label(12, 15, true) = 'ט"ו באדר א'''), 'Hebrew date labels');
select min(d)::date as bday from generate_series('1995-01-01'::date, '2010-12-31', '1 day') d, hebrew_date(d::date) h,
  hebrew_date((now() at time zone 'Asia/Jerusalem')::date) t where h.hm = t.hm and h.hd = t.hd \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into birthdays (user_id, birth_date) values (auth.uid(), :'bday');
select pg_temp.denied($$insert into birthdays (user_id, birth_date) values ('00000000-0000-0000-0000-00000000000d', '2000-01-01')$$, 'nobody sets another member''s birthday');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) = 0 from birthdays), 'birth dates are private');
select pg_temp.check((select profile_birthday('00000000-0000-0000-0000-00000000000b') is not null), 'Hebrew birthday shown on the profile');
select pg_temp.check((select post_birthdays() = 1), 'birthday greeting posted on the Hebrew birthday');
select pg_temp.check((select post_birthdays() = 0), 'only once per year');
select pg_temp.check((select system and author_id is null and body like 'מזל טוב ל-@בוב%' from messages where system order by id desc limit 1), 'greeting is a system message in the main room');
reset role;

-- ===== Nicknames =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select propose_nickname('00000000-0000-0000-0000-00000000000d', 'המתמיד') as nick_id \gset
select pg_temp.denied($$select propose_nickname(auth.uid(), 'אני')$$, 'no nickname for yourself');
select propose_nickname('00000000-0000-0000-0000-00000000000d', 'שני');
select propose_nickname('00000000-0000-0000-0000-00000000000d', 'שלישי');
select pg_temp.denied($$select propose_nickname('00000000-0000-0000-0000-00000000000d', 'רביעי')$$, 'at most 3 proposals per member');
select pg_temp.check((select propose_nickname('00000000-0000-0000-0000-00000000000d', 'המתמיד ') = :nick_id), 'same nickname is not duplicated');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select toggle_nickname_vote(:nick_id);
select pg_temp.check((select votes = 2 and i_voted and not mine from nickname_list('00000000-0000-0000-0000-00000000000d') where id = :nick_id), 'votes counted; proposer hidden');
select pg_temp.check((select count(*) = 0 from nicknames), 'nickname table is not readable directly');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select pg_temp.denied('select remove_nickname(' || :nick_id || ')', 'others cannot remove a nickname');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select remove_nickname((select id from nickname_list('00000000-0000-0000-0000-00000000000d') where nickname = 'שני'));
select pg_temp.check((select count(*) = 2 from nickname_list(auth.uid())), 'member removes a nickname he dislikes');
reset role;

-- ===== Email notifications =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into email_prefs (user_id, enabled, delay_minutes, no_shabbat) values (auth.uid(), true, 0, false);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into email_prefs (user_id, enabled, delay_minutes, no_shabbat, only_unread) values (auth.uid(), true, 0, false, false);
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) = 0 from email_prefs), 'email settings are private');
select pg_temp.denied($$insert into email_prefs (user_id, enabled) values ('00000000-0000-0000-0000-00000000000b', false)$$, 'nobody changes another member''s email settings');
select (send_dm(start_dm('00000000-0000-0000-0000-00000000000b', false), 'יש מחר שיעור?')).id as dm_id \gset
select send_message((select id from channels where is_main), 'שאלה ל@בוב החדש ול@מנהלת');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select send_dm(2, 'שאלה בסוד');
reset role;
select pg_temp.check((select title = 'הודעה חדשה מדייב' and body = 'יש מחר שיעור?' and link like '#/dm/%' from email_queue where ref = 'dm:' || :dm_id), 'DM queued for the recipient');
select pg_temp.check((select count(*) = 1 from email_queue where user_id = '00000000-0000-0000-0000-00000000000a' and title = 'הודעה אנונימית חדשה'), 'anonymous sender is never named in emails');
select pg_temp.check((select count(*) = 1 from email_queue where user_id = '00000000-0000-0000-0000-00000000000b' and kind = 'mention'), 'mention queued');
select pg_temp.check((select count(*) = 0 from email_queue where user_id = '00000000-0000-0000-0000-00000000000d'), 'no emails without opting in');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) = 0 from email_queue), 'members cannot read the email queue');
select pg_temp.denied($$select * from email_batch()$$, 'only the email job takes emails');
reset role;
select pg_temp.check((select count(*) = 2 from email_batch() where email in ('bob@x.com', 'admin@x.com')), 'due emails returned per member');
select email_done(array(select id from email_queue where claimed_at is not null), true);
select pg_temp.check((select count(*) = 0 from email_batch()), 'nothing twice');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select send_dm((select conversation_id from dm_messages where id = :dm_id), 'עוד שאלה');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select mark_dm_read((select conversation_id from dm_messages where id = :dm_id));
reset role;
select pg_temp.check((select count(*) = 0 from email_batch() where email = 'bob@x.com'), 'what was already read is not emailed');

-- ===== News flash & weekly highlights =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.denied($$select send_gag((select id from channels where is_main), '{"type":"image","path":"m/11111111-1111-1111-1111-111111111111.jpg"}')$$, 'news-flash maker needs reputation');
update messages set gag = true where author_id = auth.uid();
reset role;
select pg_temp.check((select count(*) = 0 from messages where gag), 'gag flag cannot be set by hand');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select gag from send_gag((select id from channels where is_main), '{"type":"image","path":"m/11111111-1111-1111-1111-111111111111.jpg"}', 'מבזק!')), 'admins may post a news flash');
select send_message((select id from channels where is_main), 'הציטוט הכי חזק השבוע');
reset role;
insert into reactions (message_id, user_id, emoji) select m.id, u, e from messages m,
  (values ('00000000-0000-0000-0000-00000000000b'::uuid), ('00000000-0000-0000-0000-00000000000d'::uuid)) x(u), (values ('💀'), ('🔥'), ('😂'), ('👏')) y(e) where m.body in ('הציטוט הכי חזק השבוע', 'מבזק!');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) = 2 from weekly_highlights()), 'weekly highlights: top image and top quote');
select pg_temp.check((select body = 'הציטוט הכי חזק השבוע' from weekly_highlights() where kind = 'quote'), 'quote of the week');
reset role;

-- ===== Events calendar =====
select pg_temp.check((select count(*) = 1 from channels where purpose = 'blessings'), 'blessings room exists');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select (add_event('שמחת בית השואבה', '2026-10-05')).id as ev1 \gset
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select (add_event('שמחת בית השואבה', '2026-10-07')).id as ev2 \gset
select pg_temp.check((select status = 'conflict' and conflict_with = :ev1 from events where id = :ev2), 'same event on another date is a conflict');
update events set title = 'x';
select pg_temp.check((select count(*) = 0 from events where title = 'x'), 'events change only through functions');
select pg_temp.check((select status = 'approved' from add_event('מכירת מצוות', '2026-10-05')), 'a different event on the same day is fine');
select (add_event('מכירת מצוות גדולה', '2026-10-05')).id as ev3 \gset
select pg_temp.check((select status = 'conflict' from events where id = :ev3), 'a similar name on the same day is a conflict');
select pg_temp.denied('select resolve_event(' || :ev2 || ', ''accept_new'')', 'only the original''s author or admins settle a clash');
select pg_temp.denied('select update_event(' || :ev1 || ', ''x'', ''2026-01-01'', null, ''yeshiva'', null)', 'others cannot edit an event');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select resolve_event(:ev2, 'allow_edit');
reset role;
select pg_temp.check((select count(*) = 0 from events where id = :ev2), 'clash settled');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select title = 'שמחת בית השואבה' from update_event(:ev1, 'שמחת בית השואבה', '2026-10-06', null, 'yeshiva', 'באולם')), 'author let the other member edit');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select resolve_event(:ev3, 'keep_both');
select pg_temp.check((select status = 'approved' from events where id = :ev3), 'admin decides a clash');
reset role;

-- ===== Confessions & "who said it?" =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select post_confession('אף פעם לא הגעתי בזמן לשחרית') as conf_id \gset
select pg_temp.check((select count(*) = 1 from anon_authors where kind = 'confession'), 'author knows his confession');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.denied($$select post_confession('אף פעם לא')$$, 'confessions follow the anonymous-sending permission');
select pg_temp.check((select count(*) = 1 from confessions) and (select count(*) = 0 from anon_authors where kind = 'confession'), 'confession visible, author hidden');
insert into confession_reactions (confession_id, user_id, emoji) values (:conf_id, auth.uid(), '😂');
select pg_temp.denied('insert into confession_reactions (confession_id, user_id, emoji) values (' || :conf_id || ', auth.uid(), ''🍺'')', 'only the fixed reactions');
insert into confession_comments (confession_id, author_id, body) values (:conf_id, auth.uid(), 'גם אני');
select pg_temp.denied('select delete_confession(' || :conf_id || ')', 'others cannot delete a confession');
select pg_temp.denied($$select grab_quote((select id from messages where author_id = auth.uid() and not deleted and char_length(body) >= 5 limit 1))$$, 'cannot grab your own line');
select pg_temp.denied($$select grab_quote((select id from messages where anonymous limit 1))$$, 'anonymous lines are never grabbed');
select grab_quote((select id from messages where author_id = '00000000-0000-0000-0000-00000000000b' and not deleted and not anonymous and char_length(body) >= 5 order by id limit 1)) as quiz_id \gset
select pg_temp.check((select answer is not null from quiz_list() where id = :quiz_id), 'the grabber knows the answer');
select pg_temp.denied('select guess_quote(' || :quiz_id || ', ''' || '00000000-0000-0000-0000-00000000000b' || ''')', 'the grabber cannot guess');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) = 0 from quote_quizzes), 'quiz table not readable directly');
select pg_temp.check((select answer is null and cardinality(options) = 4 and quote <> '' from quiz_list() where id = :quiz_id), 'quiz hides the answer from players');
select pg_temp.check((select guess_quote(:quiz_id, '00000000-0000-0000-0000-00000000000b')), 'correct guess');
select pg_temp.check((select answer = '00000000-0000-0000-0000-00000000000b' from quiz_list() where id = :quiz_id), 'answer revealed after guessing');
select pg_temp.denied('select guess_quote(' || :quiz_id || ', ''' || '00000000-0000-0000-0000-00000000000b' || ''')', 'one guess per quiz');
select pg_temp.check((select points = 10 from quiz_leaderboard() where user_id = auth.uid()), 'points for a correct guess');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select delete_confession(:conf_id);
select pg_temp.check((select count(*) = 0 from confessions), 'author deletes his confession');
reset role;

-- ===== Reports, muting, tags, stats, scheduling, room mutes, push =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select report_message((select id from messages where author_id = '00000000-0000-0000-0000-00000000000b' and not deleted order by id limit 1), 'לא מתאים');
select pg_temp.check((select count(*) = 0 from report_list()), 'members do not see reports');
select pg_temp.denied($$select handle_report(1, true)$$, 'members do not handle reports');
select pg_temp.denied($$select mute_member('00000000-0000-0000-0000-00000000000b', 60, 'x')$$, 'members cannot mute');
update profiles set muted_until = 'infinity' where id = auth.uid();
select pg_temp.check((select muted_until is null from profiles where id = auth.uid()), 'muting only through the function');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select reports = 1 and reasons = array['לא מתאים'] from report_list()), 'admins see reports without reporters');
select handle_report((select message_id from report_list() limit 1), false);
select pg_temp.check((select count(*) = 0 from report_list()), 'report handled');
select mute_member('00000000-0000-0000-0000-00000000000d', 60, 'חוצפה');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select reason = 'חוצפה' and until > now() from my_mute()), 'muted member sees why and until when');
select pg_temp.check((select count(*) = 0 from mute_log), 'muted member cannot see who muted him');
select pg_temp.denied($$select send_message((select id from channels where is_main), 'x')$$, 'muted member cannot write in rooms');
select pg_temp.denied($$select send_dm(start_dm('00000000-0000-0000-0000-00000000000b', false), 'x')$$, 'muted member cannot send DMs');
select pg_temp.denied($$select create_poll('x', array['a','b'])$$, 'muted member cannot open polls');
select pg_temp.check((select send_feedback('other', 'למה הושתקתי?') > 0), 'muted member can still contact the management');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select pg_temp.denied($$select mute_member('00000000-0000-0000-0000-00000000000a', 60, null)$$, 'nobody mutes an admin');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select unmute_member('00000000-0000-0000-0000-00000000000d');
reset role;
select pg_temp.check((select muted_until is null from profiles where id = '00000000-0000-0000-0000-00000000000d'), 'unmuted');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select first_count + last_count >= 0 from day_titles('00000000-0000-0000-0000-00000000000b')), 'day titles computed');
select pg_temp.denied($$select admin_stats()$$, 'stats are for admins');
select pg_temp.denied($$select schedule_message((select id from channels where is_main), 'x', now())$$, 'schedule at least a minute ahead');
select schedule_message((select id from channels where is_main), 'הודעה מתוזמנת', now() + interval '2 minutes') as sched_id \gset
insert into room_mutes (user_id, channel_id) values (auth.uid(), (select id from channels where is_main));
select pg_temp.check((select count(*) = 1 from room_mutes), 'member mutes a room for himself');
select pg_temp.check((select push_public_key() is null), 'no push key before the push job ran');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select (admin_stats() ->> 'members')::int > 0), 'admin statistics');
select pg_temp.check((select count(*) = 0 from scheduled_messages), 'scheduled messages are private');
reset role;
update scheduled_messages set send_at = now() - interval '1 second' where id = :sched_id;
select pg_temp.check((select send_due_scheduled() = 1), 'due scheduled message sent');
select pg_temp.check((select author_id = '00000000-0000-0000-0000-00000000000d' from messages where body = 'הודעה מתוזמנת'), 'sent as its author');
insert into push_subscriptions (endpoint, user_id, p256dh, auth) values ('https://push.example/1', '00000000-0000-0000-0000-00000000000b', 'k', 'a');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select send_dm(start_dm('00000000-0000-0000-0000-00000000000b', false), 'פוש לבוב');
reset role;
select pg_temp.check((select count(*) = 1 from push_queue where user_id = '00000000-0000-0000-0000-00000000000b' and body = 'פוש לבוב'), 'push queued for a subscribed device');
select pg_temp.check((select count(*) = 0 from push_queue where user_id = '00000000-0000-0000-0000-00000000000d'), 'no push without a device');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) = 0 from push_queue), 'push queue is private');
select pg_temp.denied($$select * from push_batch()$$, 'only the push job takes pushes');
reset role;

-- ===== Owner (super admin) and inspector =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select send_dm(start_dm('00000000-0000-0000-0000-0000000000f2', false), 'סוד בין שניים');
reset role;
select count(*) as anon_total from anon_authors \gset
select count(*) as dm_total from dm_messages \gset
select count(*) as conv_total from dm_conversations \gset
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.denied($$select reset_everything('wrong')$$, 'reset needs the caller''s own password');
reset role;
insert into auth.users (id, email, raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e0', 'ShmuelShmuel@gmail.com', '{"display_name":"משהו"}');
select pg_temp.check((select status = 'active' and role = 'admin' and display_name = 'ss' from profiles where id = '00000000-0000-0000-0000-0000000000e0'), 'owner email signs up as active admin "ss"');
select pg_temp.check((select email_confirmed_at is not null from auth.users where id = '00000000-0000-0000-0000-0000000000e0'), 'owner email never needs confirmation');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update profiles set role = 'member', status = 'banned' where id = '00000000-0000-0000-0000-0000000000e0';
select pg_temp.check((select status = 'active' and role = 'admin' from profiles where id = '00000000-0000-0000-0000-0000000000e0'), 'no one demotes or bans the owner');
select pg_temp.check((select owner_profile_id() = '00000000-0000-0000-0000-0000000000e0'), 'members can tell who the owner is');
select pg_temp.check((select count(*) = 0 from anon_authors), 'regular admins still cannot see anonymous authors');
select pg_temp.check((select count(*) = 0 from dm_messages where body = 'סוד בין שניים'), 'regular admins still cannot read others'' DMs');
select pg_temp.denied($$select reset_everything('x')$$, 'once the owner exists, only he may reset');
update profiles set role = 'inspector' where id = '00000000-0000-0000-0000-0000000000f2';
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e0');
select pg_temp.check((select :anon_total > 0 and count(*) = :anon_total from anon_authors), 'owner sees who wrote anonymous content');
select pg_temp.check((select :dm_total > 0 and count(*) = :dm_total from dm_messages), 'owner reads all DMs');
select pg_temp.check((select count(*) = :conv_total from dm_conversations), 'owner sees all conversations');
select pg_temp.check((select count(*) > 0 from dm_participants where hidden), 'owner sees the hidden side of anonymous DMs');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000f2');
select pg_temp.check((select role::text = 'inspector' from profiles where id = auth.uid()), 'admin appoints an inspector');
update messages set deleted = true where body = 'עריכה אנונימית';
select pg_temp.check((select deleted from messages where body = '' and anonymous and deleted limit 1), 'inspector deletes any message');
update messages set body = 'שכתוב' where not deleted and author_id <> auth.uid();
select pg_temp.check((select count(*) = 0 from messages where body = 'שכתוב'), 'inspector cannot rewrite messages');
select pg_temp.check((select count(*) = 0 from anon_authors), 'inspector cannot see anonymous authors');
select report_message((select id from messages where not deleted order by id limit 1), 'בדיקה');
select pg_temp.check((select count(*) = 0 from report_list()), 'inspector does not see reports (admins only)');
select pg_temp.denied($$select handle_report((select id from messages where not deleted order by id limit 1), true)$$, 'inspector does not handle reports');
select pg_temp.check((select count(*) = 0 from preapproved_emails), 'inspector is not an admin');
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

-- ===== News flash as text =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.denied($$select send_flash((select id from channels where is_main), 'flash', 'מבזק', 'בדיקה')$$, 'news flash needs reputation');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e0');
select send_flash((select id from channels where is_main), 'flash', 'מבזק', 'השיעור נדחה בשעה');
select pg_temp.check((select flash ->> 'text' = 'השיעור נדחה בשעה' and gag and attachment is null from messages where flash is not null order by id desc limit 1), 'flash posted as text');
select pg_temp.denied($$select send_flash((select id from channels where is_main), 'evil', 'x', 'y')$$, 'unknown flash template rejected');
update messages set body = 'שונה', flash = '{"t":"flash","title":"x","text":"hack"}' where flash is not null;
select pg_temp.check((select flash ->> 'text' = 'השיעור נדחה בשעה' and body <> 'שונה' from messages where flash is not null order by id desc limit 1), 'a flash cannot be edited');
select pg_temp.check((select count(*) >= 1 from recent_flashes()), 'flashes listed for the banner');
update messages set deleted = true where id = (select max(id) from messages where flash is not null);
select pg_temp.check((select count(*) = 0 from recent_flashes()), 'deleted flash disappears');
reset role;

-- ===== AI bot =====
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check(bot_send('מה הנייעס?') > 0, 'member writes to the bot');
select pg_temp.check((select count(*) = 1 from bot_messages), 'member sees his own bot conversation');
select pg_temp.denied($$insert into bot_messages (user_id, role, body) values (auth.uid(), 'bot', 'fake')$$, 'member cannot fake bot answers');
select pg_temp.check((select count(*) = 0 from bot_claims), 'claims are hidden from members');
select bot_send('מה הנייעס?');
select pg_temp.check((select body like 'כבר שאלת%' from bot_messages where role = 'bot' order by id desc limit 1), 'a repeated question is answered without the AI');
select bot_send('מה הנייעס?');
select pg_temp.check(bot_my_block() is null, 'two strikes do not block yet');
select bot_send('מה הנייעס?');
select pg_temp.check(bot_my_block() > now() + interval '14 minutes', 'repeating himself 3 times blocks him for a quarter of an hour');
select pg_temp.check((select body like 'נראה לי שמשעמם לך%' from bot_messages where role = 'bot' order by id desc limit 1), 'he is told to go chat with Gemini');
select pg_temp.denied($$select bot_send('עוד משהו')$$, 'blocked member cannot write to the bot');
select pg_temp.denied($$select bot_mark(auth.uid(), true)$$, 'member cannot clear his own strikes');
select pg_temp.check((select count(*) = 0 from ai_key_list()), 'member sees no AI keys');
select pg_temp.denied($$select ai_key_add('x', 'AIzaSyFAKEFAKEFAKE')$$, 'member cannot add AI keys');
select pg_temp.denied($$select * from ai_take_key()$$, 'member cannot take an AI key');
-- free messages, then his own key
reset role;
update bot_state set free_used = bot_free_daily(), free_day = (now() at time zone 'Asia/Jerusalem')::date, blocked_until = null where user_id = '00000000-0000-0000-0000-00000000000d';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select free_left = 0 and not has_key from bot_my_quota()), 'free messages used up');
select pg_temp.denied($$select bot_send('עוד שאלה על הוועד')$$, 'no more free messages without his own key');
select ai_my_key_set('AIzaMEMBERKEYMEMBERKEY0001');
select pg_temp.check((select has_key and masked = 'AIza…0001' from bot_my_quota()), 'member saves his own key (masked)');
select pg_temp.check(bot_send('שאלה עם מפתח משלי') > 0, 'with his own key he keeps writing');
select pg_temp.check((select count(*) = 0 from ai_keys), 'member cannot read keys, not even his own');
select pg_temp.check((select count(*) = 0 from ai_keys), 'member cannot read AI keys directly');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.check((select count(*) = 0 from bot_messages), 'another member cannot read my bot conversation');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.denied($$select ai_key_add('x', 'AIzaSyFAKEFAKEFAKE')$$, 'a regular admin cannot add AI keys (owner only)');
select pg_temp.check((select count(*) = 0 from ai_member_keys()) and ai_member_key_reveal('00000000-0000-0000-0000-00000000000d') is null, 'a regular admin cannot see members'' keys');
select pg_temp.denied($$select ai_member_key_set('00000000-0000-0000-0000-00000000000d', 'AIzaHIJACKHIJACKHIJACK01')$$, 'a regular admin cannot set members'' keys');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e0');
select ai_key_add('ראשי', 'AIzaSyFAKEFAKEFAKE1234', null, 100, 2);
select pg_temp.check((select masked = 'AIza…1234' and model = 'gemini-3.8-flash' from ai_key_list()), 'owner sees keys masked');
select pg_temp.check((select count(*) >= 1 from ai_member_keys() where key_id is not null), 'owner sees members'' keys in his panel');
select pg_temp.check(ai_member_key_reveal('00000000-0000-0000-0000-00000000000d') = 'AIzaMEMBERKEYMEMBERKEY0001', 'owner can reveal a member''s key');
select ai_member_key_set('00000000-0000-0000-0000-00000000000b', 'AIzaHELPEDBYOWNER00000002');
select pg_temp.check((select masked = 'AIza…0002' from ai_member_keys() where user_id = '00000000-0000-0000-0000-00000000000b'), 'owner sets a key for a member');
select ai_member_key_remove('00000000-0000-0000-0000-00000000000b');
reset role;
-- the Edge Function (service role) takes keys within the per-minute limit
update bot_state set blocked_until = now() - interval '1 minute';
select pg_temp.check(not bot_mark('00000000-0000-0000-0000-00000000000d', true), 'a useful exchange takes a strike off');
select pg_temp.check((select api_key = 'AIzaMEMBERKEYMEMBERKEY0001' from ai_take_key('00000000-0000-0000-0000-00000000000d')), 'his own key serves his requests');
select pg_temp.check((select api_key = 'AIzaSyFAKEFAKEFAKE1234' from ai_take_key('00000000-0000-0000-0000-00000000000b')), 'members without a key use the shared keys');
update ai_keys set used_minute = 0 where owner_id is null;
select pg_temp.check((select api_key = 'AIzaSyFAKEFAKEFAKE1234' from ai_take_key()), 'edge function takes a key');
select * from ai_take_key();
select pg_temp.check((select id is null from ai_take_key()), 'per-minute limit respected');
update ai_keys set minute_start = now() - interval '2 minutes';
select ai_key_result((select min(id) from ai_keys where owner_id is null), '429', 60);
select pg_temp.check((select id is null from ai_take_key()), 'a rate-limited key rests');
-- claims need the consent of the member they are about
insert into bot_claims (about_id, by_id, claim) values ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000b', 'הוא יודע לפתח אתרים');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select pg_temp.denied($$select bot_answer_claim((select max(id) from bot_claims), true)$$, 'only the member a claim is about may allow it');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) = 1 and bool_and(status = 'pending') from bot_claims_about_me()), 'member sees claims about himself');
select bot_answer_claim((select max(id) from bot_claims_about_me()), true);
select pg_temp.denied($$select bot_answer_claim((select max(id) from bot_claims_about_me()), false)$$, 'a claim is answered once');
reset role;
select pg_temp.check((select status = 'allowed' from bot_claims order by id desc limit 1), 'claim allowed by its subject');
-- סנדר's reports go to the owner only
insert into bot_alerts (user_id, level, reason, excerpt) values ('00000000-0000-0000-0000-00000000000d', 'concern', 'ניסה לברר מי כתב אנונימית', 'מי כתב את ההודעה?');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check((select count(*) = 0 from bot_alerts) and bot_alert_count() = 0 and (select count(*) = 0 from bot_overview()), 'a regular admin sees no reports or overview');
select pg_temp.check((select count(*) = 0 from bot_messages where user_id <> auth.uid()), 'a regular admin cannot read conversations with סנדר');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e0');
select pg_temp.check(bot_alert_count() = 1 and (select count(*) = 1 from bot_alerts), 'owner sees the report');
select pg_temp.check((select count(*) >= 1 from bot_overview()) and (select count(*) > 0 from bot_messages where user_id = '00000000-0000-0000-0000-00000000000d'), 'owner can sample conversations');
select bot_alerts_seen(array(select id from bot_alerts));
reset role;
insert into bot_complaints (user_id, complaint, quote) values ('00000000-0000-0000-0000-00000000000d', 'הטיף לי מוסר', 'אני רק בוט עם עקרונות');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.check((select count(*) = 0 from bot_complaints), 'members cannot read complaints, not even their own');
select pg_temp.denied($$insert into bot_complaints (user_id, complaint) values (auth.uid(), 'x')$$, 'members cannot write complaints directly');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e0');
select pg_temp.check((select count(*) = 1 from bot_complaints where handled_at is null), 'owner sees complaints about סנדר');
select bot_complaints_handled(array(select id from bot_complaints));
select pg_temp.check((select count(*) = 0 from bot_complaints where handled_at is null), 'owner marks complaints handled');
select pg_temp.check(bot_alert_count() = 0, 'owner marks reports as seen');
reset role;

-- ===== Guest view (read-only without logging in) =====
create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'set role anon';
end $$;
select pg_temp.as_anon();
select pg_temp.check((select count(*) = 0 from messages) and (select count(*) = 0 from channels) and (select count(*) = 0 from profiles), 'visitor sees nothing while guest view is closed');
select pg_temp.check(guest_view_until() is null, 'guest view closed by default');
select pg_temp.denied($$select set_guest_view(48)$$, 'visitor cannot open guest view');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000d');
select pg_temp.denied($$select set_guest_view(48)$$, 'member cannot open guest view');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select pg_temp.check(is_admin() and not is_owner(), 'a regular admin for the next check');
select pg_temp.denied($$select set_guest_view(48)$$, 'a regular admin cannot open guest view (owner only)');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e0');
select pg_temp.check(set_guest_view(48) > now() + interval '47 hours', 'owner opens guest view for two days');
select pg_temp.denied($$select set_guest_view(10000)$$, 'guest view is limited to 30 days');
reset role;
select pg_temp.as_anon();
select pg_temp.check(guest_view_until() is not null, 'visitor learns guest view is open');
select pg_temp.check((select count(*) > 0 from messages) and (select count(*) > 0 from channels), 'visitor reads rooms and messages while open');
select pg_temp.check((select count(*) > 0 from profiles) and (select bool_and(status = 'active') from profiles), 'visitor sees only active members');
select pg_temp.check((select count(*) = 0 from dm_messages) and (select count(*) = 0 from dm_conversations) and (select count(*) = 0 from anon_authors)
  and (select count(*) = 0 from poll_votes) and (select count(*) = 0 from quiz_guesses) and (select count(*) = 0 from quote_quizzes)
  and (select count(*) = 0 from feedback) and (select count(*) = 0 from birthdays) and (select count(*) = 0 from mute_log) and (select count(*) = 0 from site_settings),
  'visitor never sees private chats, anonymous authors, votes, requests or other private data');
select pg_temp.check((select count(*) > 0 from polls) and (select count(*) > 0 from poll_options) and (select count(*) > 0 from events), 'visitor reads polls and the calendar');
select pg_temp.check((select count(*) > 0 from poll_results((select min(id) from polls))), 'visitor sees poll totals');
select pg_temp.check((select count(*) >= 0 from confessions) and (select count(*) >= 0 from weekly_highlights()) and (select count(*) >= 0 from quiz_leaderboard()), 'visitor reads confessions, highlights and the leaderboard');
select pg_temp.check((select count(*) = 0 from quiz_list() where closes_at > now() and answer is not null), 'visitor never sees the answer of an open quiz');
select pg_temp.denied($$select vote_poll((select min(id) from polls), array[(select min(id) from poll_options)])$$, 'visitor cannot vote');
select pg_temp.denied($$select post_confession('אף פעם לא בדקתי')$$, 'visitor cannot post a confession');
select pg_temp.denied($$select guess_quote((select min(id) from quote_quizzes), '00000000-0000-0000-0000-00000000000d')$$, 'visitor cannot guess');
select pg_temp.denied($$select send_message((select id from channels where is_main), 'x')$$, 'visitor cannot post');
select pg_temp.denied($$insert into reactions (message_id, user_id, emoji) values ((select min(id) from messages), '00000000-0000-0000-0000-00000000000d', '👍')$$, 'visitor cannot react');
update messages set body = 'hack' where id = (select min(id) from messages);
delete from messages;
select pg_temp.check((select count(*) = 0 from messages where body = 'hack') and (select count(*) > 0 from messages), 'visitor cannot edit or delete messages');
reset role;
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e0');
select pg_temp.check(set_guest_view(0) is null, 'owner closes guest view');
reset role;
select pg_temp.as_anon();
select pg_temp.check((select count(*) = 0 from messages) and guest_view_until() is null, 'visitor sees nothing again after closing');
reset role;
update site_settings set guest_view_until = now() - interval '1 minute';
select pg_temp.as_anon();
select pg_temp.check((select count(*) = 0 from messages), 'guest view closes by itself when the time is up');
reset role;

-- ===== Reset (last: wipes everything) =====
update auth.users set encrypted_password = extensions.crypt('owner-pass', extensions.gen_salt('bf', 4)) where id = '00000000-0000-0000-0000-0000000000e0';
select pg_temp.as_user('00000000-0000-0000-0000-0000000000e0');
select pg_temp.denied($$select reset_everything('wrong')$$, 'wrong password does not reset');
select reset_everything('owner-pass');
reset role;
select pg_temp.check((select count(*) = 0 from auth.users) and (select count(*) = 0 from profiles), 'reset removes every account');
select pg_temp.check((select count(*) = 0 from messages) and (select count(*) = 0 from dm_conversations)
  and (select count(*) = 0 from roster) and (select count(*) = 0 from anon_authors) and (select count(*) = 0 from polls) and (select count(*) = 0 from feedback) and (select count(*) = 0 from nicknames) and (select count(*) = 0 from email_queue), 'reset removes all content');
select pg_temp.check((select count(*) = 2 and count(*) filter (where is_main) = 1 and count(*) filter (where purpose = 'blessings') = 1 from channels) and (select count(*) = 0 from events) and (select count(*) = 0 from quote_quizzes) and (select count(*) = 0 from push_subscriptions), 'reset leaves an empty main room and the blessings room');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e0', 'shmuelshmuel@gmail.com');
select pg_temp.check((select status = 'active' and role = 'admin' from profiles where id = '00000000-0000-0000-0000-0000000000e0'), 'owner signs up again after reset');

\o
\echo ALL PERMISSION TESTS PASSED
