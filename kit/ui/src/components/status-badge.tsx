import React, { type HTMLAttributes } from 'react';
import { STATUS_TONE_CLASS, cx, type StatusTone } from '../design-tokens.js';

type StatusBadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: StatusTone;
};

export function StatusBadge({
  tone = 'neutral',
  className,
  children,
  ...rest
}: StatusBadgeProps) {
  return (
    <span
      className={cx('nimi-status-badge', STATUS_TONE_CLASS[tone], className)}
      {...rest}
    >
      {children}
    </span>
  );
}
