# Community chat/forum

Closed community site for ועד קמ"ד ישיבת חברון (~300 members), UI in Hebrew (RTL), styled after Google Chat.
Spaces (table `channels`) -> threads (posts in a space) -> replies (side panel, realtime). Plus 1:1 DMs,
member profiles with reputation and a public wall, and anonymous posting (spaces, DMs, walls).

## Architecture
- Frontend: React 19 + Vite + TypeScript, `HashRouter` (GitHub Pages friendly), no UI library; styles in `src/styles.css` (Material 3 tokens, auto dark mode, responsive at 900px).
- Icons: inline SVG Material Symbols. Names listed in `src/components/Icon.tsx`; path data generated into `src/components/iconPaths.ts` from the npm package `@material-symbols/svg-400` (outlined, `<name>.svg` / `<name>-fill.svg`; `push_pin` is `keep`). No icon font, no emoji in UI.
- Home banner image: `public/hero.jpg` (falls back to a gradient if missing).
- Realtime: always subscribe via `subscribe()` in `src/lib/realtime.ts` (unique topic per subscription). Reusing a topic while the old channel is being removed throws and used to blank the app.
- Backend: Supabase only (Postgres + Auth + Realtime). No custom server. Supabase auth uses PKCE (`src/supabase.ts`) because the hash belongs to the router.
- All authorization lives in `supabase/schema.sql` (RLS policies + guard triggers + SECURITY DEFINER functions). The UI just hides buttons; never rely on it for security.
- Content creation goes through RPCs (`create_thread`, `post_message`, `post_wall`, `start_dm`, `send_dm`); direct inserts are not allowed.
- Anonymity: anonymous rows have `author_id`/`sender_id` NULL. The real author sits in `anon_authors` (readable only by that author) or `dm_participants.hidden`. Anonymous content never counts toward reputation (it would leak identity). Keep it that way.
- Global state (session, own profile, all profiles, channels, presence) in `src/AppContext.tsx`.
- Deploy: `.github/workflows/deploy.yml` builds on push to `main`. Supabase URL + publishable key live in `.env.production` (public by design); optional repo Variable `VITE_SITE_NAME`. Never commit the `sb_secret_` key.

## Checks before pushing
- `npm run build` (typecheck + bundle)
- `supabase/tests/run.sh` against a local Postgres 16 (mocks Supabase `auth` schema). Add a test there for any policy/trigger change.
- `schema.sql` must stay idempotent (safe to re-run on the live project).
