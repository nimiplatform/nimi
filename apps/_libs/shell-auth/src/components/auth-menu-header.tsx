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
      className={`h-[40px] w-[40px] rounded-full border border-[var(--auth-input-border,#ddd4c6)] bg-[var(--auth-card-bg,#fffdf9)] text-[var(--auth-text,#3b352c)] shadow-sm transition hover:bg-[var(--auth-hover-bg,#f0ece6)] disabled:cursor-not-allowed disabled:opacity-50 ${props.className || ''}`}
    >
      {props.children}
    </button>
  );
}
