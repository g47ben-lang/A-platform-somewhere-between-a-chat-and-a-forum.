#!/usr/bin/env bash
# Runs schema.sql + permission tests, and upgrade tests from every previous schema version,
# against a local Postgres with a mocked Supabase auth schema.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=community_chat_test

fresh_db() {
  psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
  psql -q -v ON_ERROR_STOP=1 -d $DB <<'SQL'
set client_min_messages = warning;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $f$;
grant usage on schema auth to authenticated;
create publication supabase_realtime;
alter default privileges in schema public grant all on tables to authenticated;
alter default privileges in schema public grant all on sequences to authenticated;
SQL
}

apply() { psql -q -v ON_ERROR_STOP=1 -d $DB -c "set client_min_messages = warning" -f "$1" >/dev/null; }

echo "== fresh install =="
fresh_db
apply schema.sql
apply schema.sql   # must be re-runnable
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/permissions.sql

for v in 1 2; do
  echo "== upgrade from v$v =="
  fresh_db
  apply tests/fixtures/schema_v$v.sql
  psql -q -v ON_ERROR_STOP=1 -v ver=$v -d $DB -f tests/upgrade.sql >/dev/null
  apply schema.sql
  apply schema.sql
  psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/upgrade_check.sql
done

echo "== upgrade from v3 =="
fresh_db
apply tests/fixtures/schema_v3.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/upgrade_v3.sql >/dev/null
apply schema.sql
apply schema.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/upgrade_check_v3.sql

echo "== upgrade from v4 =="
fresh_db
apply tests/fixtures/schema_v4.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/upgrade_v4.sql >/dev/null
apply schema.sql
apply schema.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/upgrade_check_v4.sql

echo "== upgrade from v5 =="
fresh_db
apply tests/fixtures/schema_v5.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/upgrade_v5.sql >/dev/null
apply schema.sql
apply schema.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/upgrade_check_v5.sql

psql -q -d postgres -c "drop database $DB"
