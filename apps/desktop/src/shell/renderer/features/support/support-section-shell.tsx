/**
 * Shared presentation primitives for `Support` sub-areas.
 *
 * `SupportSectionShell` is the scrollable section frame. `SupportFailClosed`
 * is the typed fail-closed surface every sub-area renders when its upstream
 * typed projection is missing or failed (`rule.nimi.desktop.product-surfaces.r024..r028`) — it shows the
 * typed reason and a retry affordance, never a fabricated success state.
 */

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@nimiplatform/kit/ui';

export function SupportSectionShell(props: {
  title: string;
  description?: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <ScrollArea className="flex-1" contentClassName="mx-auto w-full max-w-3xl px-6 py-6">
      <div data-testid={props.testId} className="flex flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h2 className="nimi-type-page-title text-[color:var(--nimi-text-primary)]">{props.title}</h2>
          {props.description ? (
            <p className="text-sm text-[var(--nimi-text-secondary)]">{props.description}</p>
          ) : null}
        </header>
        {props.children}
      </div>
    </ScrollArea>
  );
}

export function SupportCard(props: {
  title: string;
  description?: string;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <section
      data-testid={props.testId}
      className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5"
    >
      <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{props.title}</h3>
      {props.description ? (
        <p className="mt-1 text-xs text-[var(--nimi-text-secondary)]">{props.description}</p>
      ) : null}
      {props.children ? <div className="mt-4">{props.children}</div> : null}
    </section>
  );
}

export function SupportInfoRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-[var(--nimi-text-secondary)]">{props.label}</span>
      <span className="break-all text-right font-medium text-[var(--nimi-text-primary)]">
        {props.value}
      </span>
    </div>
  );
}

/**
 * The typed fail-closed surface (`rule.nimi.desktop.product-surfaces.r024..r028`). Rendered when a sub-area's
 * upstream typed projection is missing or failed. It surfaces the typed
 * `reason` and a retry — it never synthesizes a placeholder success.
 */
export function SupportFailClosed(props: {
  testId: string;
  reason: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section
      data-testid={props.testId}
      className="rounded-2xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_28%,var(--nimi-surface-card))] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,var(--nimi-surface-card))] p-5"
    >
      <h3 className="text-sm font-semibold text-[var(--nimi-status-danger)]">
        {t('Support.failClosedTitle')}
      </h3>
      <p className="mt-1 break-words text-xs text-[var(--nimi-text-secondary)]">
        {t('Support.failClosedBody')}
      </p>
      <p
        data-testid={`${props.testId}-reason`}
        className="mt-3 break-words rounded-lg bg-[var(--nimi-surface-canvas)] px-3 py-2 text-xs text-[var(--nimi-text-primary)]"
      >
        {props.reason}
      </p>
      {props.onRetry ? (
        <button
          type="button"
          data-testid={`${props.testId}-retry`}
          onClick={props.onRetry}
          className="mt-4 inline-flex items-center rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-xs font-medium text-[var(--nimi-text-primary)] transition hover:bg-[var(--nimi-surface-active)]"
        >
          {t('Support.failClosedRetry')}
        </button>
      ) : null}
    </section>
  );
}

export function SupportLoading(props: { testId: string }) {
  const { t } = useTranslation();
  return (
    <section
      data-testid={props.testId}
      className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5 text-xs text-[var(--nimi-text-secondary)]"
    >
      {t('Support.loading')}
    </section>
  );
}
