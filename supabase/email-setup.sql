-- Run ONCE in the Supabase SQL Editor, after deploying the Edge Function "send-emails"
-- (see README: "התראות במייל"). Calls the function every 5 minutes. Safe to re-run.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'send-emails';
select cron.schedule(
  'send-emails',
  '*/5 * * * *',
  $$ select net.http_post(
       url := 'https://aircrgkljjnomoemnetq.supabase.co/functions/v1/send-emails',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb
     ) $$
);

-- Push notifications + scheduled messages: every minute (the Edge Function "send-push" must exist,
-- deployed with Verify JWT off). Scheduled messages are also sent straight from SQL as a fallback.
select cron.unschedule(jobid) from cron.job where jobname in ('send-push', 'scheduled-messages');
select cron.schedule(
  'send-push',
  '* * * * *',
  $$ select net.http_post(
       url := 'https://aircrgkljjnomoemnetq.supabase.co/functions/v1/send-push',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb
     ) $$
);
select cron.schedule('scheduled-messages', '* * * * *', $$ select public.send_due_scheduled() $$);
