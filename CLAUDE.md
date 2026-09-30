# Community chat/forum

Closed community site (~300 members), UI in Hebrew (RTL). Channels -> threads (forum-style topic) -> realtime messages (chat-style).

## Architecture
- Frontend: React 19 + Vite + TypeScript, `HashRouter` (GitHub Pages friendly), no UI library; styles in `src/styles.css` (mobile-first, CSS vars, auto dark mode).
- Backend: Supabase only (Postgres + Auth + Realtime). No custom server. Supabase auth uses PKCE (`src/supabase.ts`) because the hash belongs to the router.
- All authorization lives in `supabase/schema.sql` (RLS policies + guard triggers). The UI just hides buttons; never rely on it for security.
- Global state (session, own profile, all profiles, channels, presence) in `src/AppContext.tsx`.
- Deploy: `.github/workflows/deploy.yml` builds on push to `main`. Supabase URL + publishable key live in `.env.production` (public by design); optional repo Variable `VITE_SITE_NAME`. Never commit the `sb_secret_` key.

## Checks before pushing
- `npm run build` (typecheck + bundle)
- `supabase/tests/run.sh` against a local Postgres 16 (mocks Supabase `auth` schema). Add a test there for any policy/trigger change.
- `schema.sql` must stay idempotent (safe to re-run on the live project).
