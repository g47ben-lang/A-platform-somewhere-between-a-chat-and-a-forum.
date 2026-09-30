# Community chat/forum

Closed community chat for ועד קמ"ד ישיבת חברון (~300 members), UI in Hebrew (RTL), styled after Google Chat.
It is a CHAT, not a forum: the home screen is the main room (live, flat chat). Members open small topic
rooms (table `channels`, one row has is_main). Plus 1:1 DMs and anonymous posting. Member info (profile
card with reputation, DM / anonymous DM buttons) opens only when clicking a name or avatar.

## Architecture
- Frontend: React 19 + Vite + TypeScript, `HashRouter` (GitHub Pages friendly), no UI library; styles in `src/styles.css` (Material 3 tokens, auto dark mode, responsive at 900px).
- Icons: inline SVG Material Symbols. Names listed in `src/components/Icon.tsx`; path data generated into `src/components/iconPaths.ts` from the npm package `@material-symbols/svg-400` (outlined, `<name>.svg` / `<name>-fill.svg`; `push_pin` is `keep`). No icon font, no emoji in UI.
- Main room banner image: `public/hero.jpg` (falls back to a gradient if missing).
- Shared chat UI: `components/ChatStream.tsx` (rooms + DMs), `components/Composer.tsx` (mentions, anonymous toggle, typing pings), `lib/useTyping.ts` (broadcast, never carries a name for anonymous writers).
- Realtime: postgres_changes via `subscribe()` in `src/lib/realtime.ts` (unique topic per subscription); shared topics (presence, typing) via `joinShared()`. Reusing a topic while the old channel is being removed throws and used to blank the app.
- Backend: Supabase only (Postgres + Auth + Realtime). No custom server. Supabase auth uses PKCE (`src/supabase.ts`) because the hash belongs to the router.
- All authorization lives in `supabase/schema.sql` (RLS policies + guard triggers + SECURITY DEFINER functions). The UI just hides buttons; never rely on it for security.
- Content creation goes through RPCs (`send_message`, `create_room`, `post_wall`, `start_dm`, `send_dm`); direct inserts are not allowed. Sidebar data: `my_rooms()`, `my_conversations()`.
- Anonymity: anonymous rows have `author_id`/`sender_id` NULL. The real author sits in `anon_authors` (readable only by that author) or `dm_participants.hidden`. Anonymous content never counts toward reputation (it would leak identity). Keep it that way.
- Who may send / receive anonymously is decided by admins only (`profiles.can_send_anonymous`, `accept_anonymous`); enforced in the RPCs on every message.
- Global state (session, own profile, all profiles, channels, presence) in `src/AppContext.tsx`.
- Deploy: `.github/workflows/deploy.yml` builds on push to `main`. Supabase URL + publishable key live in `.env.production` (public by design); optional repo Variable `VITE_SITE_NAME`. Never commit the `sb_secret_` key.

## Checks before pushing
- `npm run build` (typecheck + bundle)
- `supabase/tests/run.sh` against a local Postgres 16 (mocks Supabase `auth` schema): permission tests on a fresh install plus upgrade tests from `tests/fixtures/schema_v1.sql` and `schema_v2.sql`. Add a test for any policy/trigger change; when making a breaking schema change, snapshot the current schema as the next fixture.
- `schema.sql` must stay idempotent (safe to re-run on the live project).
