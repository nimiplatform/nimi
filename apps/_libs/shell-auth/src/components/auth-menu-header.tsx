import type { ReactNode } from 'react';

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
      className={`h-[40px] w-[40px] rounded-full border border-[var(--nimi-field-border)] bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)] shadow-sm transition hover:bg-[var(--nimi-action-ghost-hover)] disabled:cursor-not-allowed disabled:opacity-50 ${props.className || ''}`}
    >
      {props.children}
    </button>
  );
}
