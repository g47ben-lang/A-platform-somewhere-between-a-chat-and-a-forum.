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
