import { useContext } from 'react';
import { AppCtx } from '../AppContext';
import { colorFor, initials } from '../lib/format';
import { useSignedUrl } from '../lib/media';
import Icon from './Icon';

interface Props {
  id?: string | null;
  name?: string;
  size?: number;
  online?: boolean;
  anonymous?: boolean;
  /** Overrides the member's stored photo (e.g. a preview before saving). */
  src?: string | null;
}

/** Member photo when one is set, otherwise colored initials. Anonymous authors get a neutral mask. */
export default function Avatar({ id, name = '?', size = 32, online, anonymous, src }: Props) {
  const app = useContext(AppCtx);
  const path = !anonymous && id ? app?.profiles.get(id)?.avatar_path ?? (app?.me?.id === id ? app?.me?.avatar_path : null) : null;
  const url = useSignedUrl(src === undefined ? path : null);
  const image = src ?? url;

  if (anonymous || !id) {
    return (
      <span className="avatar anon" style={{ width: size, height: size }}>
        <Icon name="visibility_off" size={size * 0.55} />
      </span>
    );
  }
  return (
    <span className="avatar" style={{ width: size, height: size, background: image ? 'var(--surface-3)' : colorFor(id), fontSize: size * 0.4 }}>
      {image ? <img src={image} alt="" draggable={false} /> : initials(name)}
      {online && <span className="presence" />}
    </span>
  );
}

export function SpaceTile({ name, size = 28, announce }: { name: string; size?: number; announce?: boolean }) {
  return (
    <span className="space-tile" style={{ width: size, height: size, fontSize: size * 0.45 }}>
      {announce ? <Icon name="campaign" size={size * 0.6} /> : name.trim()[0] ?? '#'}
    </span>
  );
}
