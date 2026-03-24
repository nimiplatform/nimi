import React, { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ACTION_SIZE_CLASS, ACTION_SLOT_CLASS, ACTION_TONE_CLASS, cx, type ActionSize, type ActionTone } from '../design-tokens.js';

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

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    tone = 'secondary',
    size = 'md',
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
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
      {leadingIcon ? <span className={ACTION_SLOT_CLASS.leadingIcon}>{leadingIcon}</span> : null}
      <span className="truncate">{children}</span>
      {trailingIcon ? <span className={ACTION_SLOT_CLASS.trailingIcon}>{trailingIcon}</span> : null}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    tone = 'ghost',
    size = 'md',
    icon,
    className,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'nimi-action nimi-action--icon',
        ACTION_TONE_CLASS[tone],
        ACTION_SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      <span className={ACTION_SLOT_CLASS.icon}>{icon}</span>
    </button>
  );
});
