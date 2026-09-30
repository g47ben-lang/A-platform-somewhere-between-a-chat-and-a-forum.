-- Seeds data on a v6 database; run BEFORE the current schema.sql.
\set ON_ERROR_STOP 1
set client_min_messages = warning;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@x.com');
update profiles set terms_accepted_at = now();
insert into preapproved_emails (email) values ('p@x.com');
