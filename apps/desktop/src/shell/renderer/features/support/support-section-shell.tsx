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
import {
  NimiText,
  SettingsPageShell,
  Surface,
  cn,
} from '@nimiplatform/kit/ui';

export function SupportSectionShell(props: {
  title: string;
  description?: string;
  testId: string;
  children: ReactNode;
  embedded?: boolean;
  hideHeader?: boolean;
}) {
  if (props.embedded) {
    return (
      <div data-testid={props.testId} className="flex flex-col gap-4">
        {props.children}
      </div>
    );
  }

  return (
    <SettingsPageShell
      scrollClassName="bg-transparent"
      viewportClassName="bg-transparent"
      contentClassName="w-full max-w-4xl gap-4 px-5 py-5"
    >
      <div data-testid={props.testId} className="flex flex-col gap-4">
        {!props.hideHeader ? (
          <header className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <NimiText as="h2" role="page-title" tabIndex={-1}>
                {props.title}
              </NimiText>
              {props.description ? (
                <NimiText role="helper" className="mt-1">
                  {props.description}
                </NimiText>
              ) : null}
            </div>
          </header>
        ) : null}
        {props.children}
      </div>
    </SettingsPageShell>
  );
}

export function SupportCard(props: {
  title: string;
  description?: string;
  status?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  testId?: string;
  className?: string;
}) {
  return (
    <section
      data-testid={props.testId}
      className={cn(
        'rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5 shadow-sm',
        props.className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">{props.title}</h3>
          {props.description ? (
            <p className="max-w-xl text-xs text-[var(--nimi-text-secondary)]">{props.description}</p>
          ) : null}
          {props.status}
        </div>
        {props.action ? <div className="flex shrink-0 items-center gap-2">{props.action}</div> : null}
      </div>
      {props.children ? <div className="mt-4">{props.children}</div> : null}
    </section>
  );
}

export function SupportSectionBlock(props: {
  title: string;
  description?: string;
  action?: ReactNode;
  children?: ReactNode;
  testId?: string;
  className?: string;
  bareContent?: boolean;
}) {
  return (
    <section data-testid={props.testId} className={cn('mt-4', props.className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <NimiText as="h3" role="section-title">{props.title}</NimiText>
          {props.description ? (
            <NimiText role="helper" className="mt-1 max-w-2xl">
              {props.description}
            </NimiText>
          ) : null}
        </div>
        {props.action ? <div className="flex shrink-0 items-center gap-2">{props.action}</div> : null}
      </div>
      {props.children ? (
        props.bareContent ? (
          <div className="mt-3">{props.children}</div>
        ) : (
          <Surface tone="card" material="solid" padding="md" className="mt-3">
            {props.children}
          </Surface>
        )
      ) : null}
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
          className="mt-4 inline-flex items-center rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-xs font-medium text-[var(--nimi-text-primary)] transition-[transform,background-color] duration-150 hover:bg-[var(--nimi-surface-active)] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
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
