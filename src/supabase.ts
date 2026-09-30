import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && key);

// Placeholder values keep the module importable when unconfigured; App shows a setup screen instead.
// PKCE puts auth callbacks in ?code=… rather than the URL hash, which the HashRouter owns.
export const supabase = createClient(url || 'http://localhost', key || 'missing-key', {
  auth: { flowType: 'pkce' },
});

/** Where email links (confirmation, password reset) should land: the app root, without any hash route. */
export const appUrl = () => window.location.origin + window.location.pathname;

/** The site owner ("מנהל-על"). Must match owner_email() in supabase/schema.sql. */
export const OWNER_EMAIL = 'shmuelshmuel@gmail.com';
/** Short login name the owner may type instead of his email. */
export const OWNER_LOGIN = 'shmuel';

export const SITE_NAME = (import.meta.env.VITE_SITE_NAME as string | undefined) || 'מערכת ועד קמ"ד ישיבת חברון';
