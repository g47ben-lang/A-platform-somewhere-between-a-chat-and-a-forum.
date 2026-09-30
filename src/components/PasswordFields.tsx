import { useState } from 'react';
import Icon from './Icon';

export const MIN_PASSWORD = 8;

export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD) return `הסיסמה חייבת להכיל לפחות ${MIN_PASSWORD} תווים`;
  if (!/[A-Za-z֐-׿]/.test(password) || !/\d/.test(password)) return 'הסיסמה צריכה לכלול גם אותיות וגם ספרות';
  if (password !== confirm) return 'הסיסמאות אינן תואמות';
  return null;
}

interface Props {
  value: { password: string; confirm: string };
  onChange: (v: { password: string; confirm: string }) => void;
  label?: string;
}

/** New password + confirmation, with show/hide and live validation. */
export default function PasswordFields({ value, onChange, label = 'סיסמה חדשה' }: Props) {
  const [show, setShow] = useState(false);
  const mismatch = value.confirm.length > 0 && value.confirm !== value.password;
  const tooShort = value.password.length > 0 && value.password.length < MIN_PASSWORD;

  return (
    <>
      <label className="field">
        <span>{label}</span>
        <div className="input-with-btn">
          <input
            type={show ? 'text' : 'password'}
            dir="ltr"
            value={value.password}
            onChange={(e) => onChange({ ...value, password: e.target.value })}
            autoComplete="new-password"
            required
          />
          <button type="button" className="icon-btn small" onClick={() => setShow((s) => !s)} aria-label={show ? 'הסתרת הסיסמה' : 'הצגת הסיסמה'}>
            <Icon name={show ? 'visibility_off' : 'visibility'} size={20} />
          </button>
        </div>
        <span className={`field-hint ${tooShort ? 'bad' : ''}`}>לפחות {MIN_PASSWORD} תווים, כולל אותיות וספרות</span>
      </label>
      <label className="field">
        <span>אימות סיסמה</span>
        <input
          type={show ? 'text' : 'password'}
          dir="ltr"
          value={value.confirm}
          onChange={(e) => onChange({ ...value, confirm: e.target.value })}
          autoComplete="new-password"
          required
          aria-invalid={mismatch}
        />
        {mismatch && <span className="field-hint bad">הסיסמאות אינן תואמות</span>}
      </label>
    </>
  );
}
