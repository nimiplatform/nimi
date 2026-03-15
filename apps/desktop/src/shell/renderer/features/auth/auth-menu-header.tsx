import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// CircleIconButton — small round icon button used in the main view
// ---------------------------------------------------------------------------

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
      className={`h-[40px] w-[40px] rounded-full border border-border bg-card text-foreground shadow-sm transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 ${props.className || ''}`}
    >
      {props.children}
    </button>
  );
}
