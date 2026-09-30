// Every icon the app uses. To add one: append its Material Symbols name here and regenerate
// iconPaths.ts from @material-symbols/svg-400 (see CLAUDE.md).
import { ICON_PATHS } from './iconPaths';

const ICONS = [
  'add', 'add_circle', 'add_photo_alternate', 'ballot', 'add_reaction', 'admin_panel_settings', 'arrow_downward', 'block',
  'cake', 'campaign', 'chat', 'check', 'close', 'content_copy', 'delete', 'download', 'edit', 'error',
  'format_quote', 'forum', 'forward', 'group', 'home', 'keep', 'label', 'link', 'lock', 'logout', 'mail',
  'mark_chat_unread', 'menu', 'mood', 'more_vert', 'person', 'person_add', 'photo_camera', 'remove', 'reply', 'schedule',
  'search', 'send', 'settings', 'shield_person', 'star', 'thumb_up', 'videocam', 'visibility',
  'visibility_off', 'workspace_premium',
] as const;

export type IconName = (typeof ICONS)[number];

/**
 * Material Symbols icons rendered as inline SVG (paths in iconPaths.ts), so they never depend
 * on a web font loading. Size follows the surrounding font-size unless `size` is given.
 */
export default function Icon({ name, filled, size, className }: { name: IconName; filled?: boolean; size?: number; className?: string }) {
  const p = ICON_PATHS[name];
  return (
    <svg
      className={`icon ${className ?? ''}`}
      viewBox="0 -960 960 960"
      width={size ?? 24}
      height={size ?? 24}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={filled ? p.f : p.o} />
    </svg>
  );
}
