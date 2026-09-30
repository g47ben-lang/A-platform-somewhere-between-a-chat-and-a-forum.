import { colorFor, initials } from '../lib/format';
import Icon from './Icon';

interface Props {
  id?: string | null;
  name?: string;
  size?: number;
  online?: boolean;
  anonymous?: boolean;
}

export default function Avatar({ id, name = '?', size = 32, online, anonymous }: Props) {
  if (anonymous || !id) {
    return (
      <span className="avatar anon" style={{ width: size, height: size }}>
        <Icon name="visibility_off" size={size * 0.55} />
      </span>
    );
  }
  return (
    <span className="avatar" style={{ width: size, height: size, background: colorFor(id), fontSize: size * 0.4 }}>
      {initials(name)}
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
