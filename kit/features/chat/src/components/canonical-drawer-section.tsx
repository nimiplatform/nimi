import type { ReactNode } from 'react';
import { Surface, Tooltip } from '@nimiplatform/kit/ui';

export type CanonicalDrawerSectionProps = {
  title: string;
  hint?: string | null;
  children: ReactNode;
};

export function CanonicalDrawerSection({
  title,
  hint,
  children,
}: CanonicalDrawerSectionProps) {
  return (
    <Surface as="section" tone="card" elevation="base" padding="md" material="solid" className="space-y-4">
      {hint ? (
        <Tooltip content={hint} placement="top">
          <h3 className="cursor-default text-xs font-semibold uppercase tracking-[var(--nimi-type-label-letter-spacing)] text-[var(--nimi-text-muted)]">
            {title}
          </h3>
        </Tooltip>
      ) : (
        <h3 className="cursor-default text-xs font-semibold uppercase tracking-[var(--nimi-type-label-letter-spacing)] text-[var(--nimi-text-muted)]">
          {title}
        </h3>
      )}
      {children}
    </Surface>
  );
}
