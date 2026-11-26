import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { Surface, Tooltip } from '@nimiplatform/kit/ui';
import { FOCUS_RING_CLASS_NAME } from '@nimiplatform/kit/ui/a11y';

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
      <div className="flex items-center gap-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-[var(--nimi-type-overline-letter-spacing)] text-[var(--nimi-text-muted)]">
          {title}
        </h3>
        {hint ? (
          <Tooltip content={hint} placement="top">
            <button
              type="button"
              aria-label={hint}
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[var(--nimi-text-muted)] transition-colors duration-[var(--nimi-motion-fast)] hover:text-[var(--nimi-text-secondary)] ${FOCUS_RING_CLASS_NAME}`}
            >
              <Info size={13} aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
      </div>
      {children}
    </Surface>
  );
}
