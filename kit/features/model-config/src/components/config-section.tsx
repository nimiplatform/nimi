import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/kit/ui';
import { FOCUS_RING_CLASS_NAME } from '@nimiplatform/kit/ui/a11y';

export function ConfigSection(props: { readonly title: string; readonly children: ReactNode; readonly className?: string }) {
  return (
    <section className={cn('space-y-3', props.className)}>
      <h3 className="m-0 nimi-type-overline uppercase text-[var(--nimi-text-muted)]">{props.title}</h3>
      {props.children}
      <div className="border-b border-[var(--nimi-border-subtle)]" />
    </section>
  );
}

export function ConfigAccordionSection(props: {
  readonly title: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  return (
    <section>
      <button type="button" onClick={props.onToggle} className={cn('flex w-full items-center justify-between py-2.5', FOCUS_RING_CLASS_NAME)}>
        <h3 className="m-0 nimi-type-overline uppercase text-[var(--nimi-text-muted)]">{props.title}</h3>
        <svg aria-hidden="true" className={`h-3.5 w-3.5 text-[var(--nimi-text-muted)] transition-transform ${props.expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {props.expanded ? <div className="pb-3">{props.children}</div> : null}
      <div className="border-b border-[var(--nimi-border-subtle)]" />
    </section>
  );
}

export function DisabledConfigNote(props: { readonly label: string }) {
  return <div className="rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-3 py-4 text-center text-[length:var(--nimi-type-overline-size)] text-[var(--nimi-text-secondary)]">{props.label}</div>;
}
