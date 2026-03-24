import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { ACTION_TONE_CLASS, cx, type ActionTone } from './design-tokens.js';

type ActionSize = 'sm' | 'md';

const ACTION_SIZE_CLASS: Record<ActionSize, string> = {
  sm: 'nimi-action--size-sm',
  md: 'nimi-action--size-md',
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ActionTone;
  size?: ActionSize;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
};

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ActionTone;
  size?: ActionSize;
  icon: ReactNode;
};

export function Button({
  tone = 'secondary',
  size = 'md',
  fullWidth = false,
  leadingIcon,
  trailingIcon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'nimi-action',
        ACTION_TONE_CLASS[tone],
        ACTION_SIZE_CLASS[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {leadingIcon ? <span className="inline-flex shrink-0 items-center justify-center">{leadingIcon}</span> : null}
      <span className="truncate">{children}</span>
      {trailingIcon ? <span className="inline-flex shrink-0 items-center justify-center">{trailingIcon}</span> : null}
    </button>
  );
}

export function IconButton({
  tone = 'ghost',
  size = 'md',
  icon,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'nimi-action nimi-action--icon',
        ACTION_TONE_CLASS[tone],
        ACTION_SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      <span className="inline-flex items-center justify-center">{icon}</span>
    </button>
  );
}
