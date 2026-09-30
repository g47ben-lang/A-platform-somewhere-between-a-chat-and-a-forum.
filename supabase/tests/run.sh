#!/usr/bin/env bash
# Runs schema.sql + permission tests against a local Postgres with a mocked Supabase auth schema.
# Usage: PGHOST=... PGPORT=... PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DB=community_chat_test
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
psql -q -v ON_ERROR_STOP=1 -d $DB -c "set client_min_messages = warning" -f schema.sql
psql -q -v ON_ERROR_STOP=1 -d $DB -f tests/permissions.sql
psql -q -d postgres -c "drop database $DB"
