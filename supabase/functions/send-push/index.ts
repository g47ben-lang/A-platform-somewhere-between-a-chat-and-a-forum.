// Supabase Edge Function "send-push": delivers queued notifications to installed apps / browsers
// (Web Push), even when the site is closed. Woken right after a message by push_kick() and every
// minute by pg_cron (supabase/email-setup.sql). Creates its VAPID keys on the first run (stored in
// push_config, never readable by members). Also sends due scheduled messages. Deploy with Verify JWT off.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://g47ben-lang.github.io/A-platform-somewhere-between-a-chat-and-a-forum./';

Deno.serve(async () => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const due = await db.rpc('send_due_scheduled');

  let { data: cfg } = await db.from('push_config').select('public_key, private_key').eq('id', 1).maybeSingle();
  if (!cfg) {
    const keys = webpush.generateVAPIDKeys();
    await db.from('push_config').insert({ id: 1, public_key: keys.publicKey, private_key: keys.privateKey });
    ({ data: cfg } = await db.from('push_config').select('public_key, private_key').eq('id', 1).maybeSingle());
  }
  webpush.setVapidDetails('mailto:noreply@example.com', cfg!.public_key, cfg!.private_key);

  const { data, error } = await db.rpc('push_batch');
  if (error) return Response.json({ scheduled: due.data, error: error.message }, { status: 500 });

  let sent = 0;
  const gone: string[] = [];
  for (const p of (data ?? []) as { endpoint: string; p256dh: string; auth: string; title: string; body: string; link: string }[]) {
    try {
      await webpush.sendNotification(
        { endpoint: p.endpoint, keys: { p256dh: p.p256dh, auth: p.auth } },
        JSON.stringify({ title: p.title, body: p.body, url: SITE_URL + p.link }),
        { TTL: 60 * 60 * 12 },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(p.endpoint); // device unsubscribed / app removed
    }
  }
  if (gone.length) await db.from('push_subscriptions').delete().in('endpoint', gone);
  return Response.json({ scheduled: due.data, sent, removed: gone.length });
});
