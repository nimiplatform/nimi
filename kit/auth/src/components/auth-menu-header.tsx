import type { ReactNode } from 'react';
import { FOCUS_RING_CLASS_NAME } from '@nimiplatform/kit/ui/a11y';

export function CircleIconButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  dataTestId?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      data-testid={props.dataTestId}
      className={`h-10 w-10 rounded-full border border-[var(--nimi-field-border)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-base)] transition-[background-color,border-color,color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] hover:bg-[var(--nimi-action-ghost-hover)] active:scale-[var(--nimi-motion-pressed-scale)] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING_CLASS_NAME} ${props.className || ''}`}
    >
      {props.children}
    </button>
  );
}
