import { colorFor, initials } from '../util';

export default function Avatar({ id, name, size = 36, online }: { id: string; name: string; size?: number; online?: boolean }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: colorFor(id), fontSize: size * 0.4 }}>
      {initials(name)}
      {online && <span className="online-dot" />}
    </span>
  );
}
