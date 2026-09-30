// Supabase Edge Function "send-emails": posts the day's birthday greetings and sends the queued
// email notifications through Gmail. Runs every 5 minutes from pg_cron (supabase/email-setup.sql).
// Needs the secrets GMAIL_USER and GMAIL_APP_PASSWORD (Edge Functions -> Secrets); optional SITE_URL, FROM_NAME.
// Anyone may call it: it only sends what is already due, so a call can never cause extra or earlier-than-chosen mail.
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6';

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://g47ben-lang.github.io/A-platform-somewhere-between-a-chat-and-a-forum./';
const FROM_NAME = Deno.env.get('FROM_NAME') ?? 'מערכת ועד קמ"ד ישיבת חברון';

interface Item {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string;
  at: string;
}
interface Row {
  user_id: string;
  email: string;
  name: string;
  digest: boolean;
  items: Item[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const time = (iso: string) =>
  new Date(iso).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem', weekday: 'short', hour: '2-digit', minute: '2-digit' });

function render(r: Row): { subject: string; html: string; text: string } {
  const subject = r.items.length === 1 ? r.items[0].title : `${r.items.length} עדכונים חדשים בצ'אט`;
  const rows = r.items
    .map(
      (i) => `<tr><td style="padding:12px 16px;border-bottom:1px solid #e3e3e3">
        <div style="font-weight:600;color:#1f1f1f">${esc(i.title)}</div>
        ${i.body ? `<div style="color:#444746;margin-top:4px;white-space:pre-wrap">${esc(i.body)}</div>` : ''}
        <div style="margin-top:6px;font-size:12px;color:#747775">${esc(time(i.at))} · <a href="${SITE_URL}${i.link}" style="color:#0b57d0">לצפייה באתר</a></div>
      </td></tr>`,
    )
    .join('');
  const html = `<!doctype html><html lang="he" dir="rtl"><body style="margin:0;background:#f6f8fc;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" style="max-width:560px;margin:24px auto;background:#fff;border-radius:16px;overflow:hidden" dir="rtl">
      <tr><td style="background:#0b57d0;color:#fff;padding:16px;font-size:18px;font-weight:600">${esc(FROM_NAME)}</td></tr>
      <tr><td style="padding:16px 16px 0;color:#1f1f1f">שלום ${esc(r.name)},</td></tr>
      ${rows}
      <tr><td style="padding:16px;font-size:12px;color:#747775">
        קיבלת את המייל כי בחרת בהתראות במייל. אפשר לשנות מה מגיע ומתי, או לבטל, ב<a href="${SITE_URL}#/settings" style="color:#0b57d0">הגדרות</a>.
      </td></tr>
    </table></body></html>`;
  const text = r.items.map((i) => `${i.title}\n${i.body}\n${SITE_URL}${i.link}`).join('\n\n');
  return { subject, html, text };
}

Deno.serve(async () => {
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
  const report: Record<string, unknown> = {};

  const b = await db.rpc('post_birthdays');
  report.birthdays = b.error ? b.error.message : b.data;

  const user = Deno.env.get('GMAIL_USER');
  const pass = Deno.env.get('GMAIL_APP_PASSWORD');
  if (!user || !pass) return Response.json({ ...report, email: 'GMAIL_USER / GMAIL_APP_PASSWORD not set' });

  const { data, error } = await db.rpc('email_batch', { p_limit: 40 });
  if (error) return Response.json({ ...report, error: error.message }, { status: 500 });

  const mail = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user, pass } });
  let sent = 0;
  const failed: string[] = [];
  for (const r of (data ?? []) as Row[]) {
    const ids = r.items.map((i) => i.id);
    try {
      const m = render(r);
      await mail.sendMail({ from: { name: FROM_NAME, address: user }, to: r.email, subject: m.subject, html: m.html, text: m.text });
      await db.rpc('email_done', { p_ids: ids, p_ok: true });
      sent++;
    } catch (e) {
      failed.push(String(e));
      await db.rpc('email_done', { p_ids: ids, p_ok: false });
    }
  }
  return Response.json({ ...report, sent, failed });
});
