import type { ReactNode, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDesktopRendererBindings } from '../../renderer/binding-context';
import bootstrapLogoImage from '../../assets/logo.png';
import { SupportDegradedEntry } from '../../features/support/support-degraded-entry.js';

export function NimiLogoMark({ className = 'h-12 w-12' }: { className?: string }) {
  return (
    <img src={bootstrapLogoImage} alt="" className={`${className} object-contain`} aria-hidden="true" />
  );
}

const MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX = 92;

export const STATUS_SHELL_PRIMARY_BUTTON = 'rounded-full bg-[var(--nimi-action-primary-bg)] px-6 py-2.5 text-sm font-medium text-[var(--nimi-action-primary-text)] transition-colors hover:bg-[var(--nimi-action-primary-bg-hover)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--nimi-focus-ring-color)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60';

export const STATUS_SHELL_SECONDARY_BUTTON = 'rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-2.5 text-sm font-medium text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-surface-active)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--nimi-focus-ring-color)] disabled:cursor-not-allowed disabled:opacity-60';

export function SharedStatusShell(props: {
  title: string;
  description?: string;
  wide?: boolean;
  children?: ReactNode;
}) {
  const bindings = useDesktopRendererBindings();

  const onDragRegionMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!bindings.app.projection.titlebarDragEnabled()) return;
    if (event.button !== 0) return;
    if (event.detail > 1) return;
    if (event.clientX < MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX) return;
    void bindings.app.commands.startWindowDrag().catch(() => {
      // no-op
    });
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)]">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 z-20 h-8"
        onMouseDown={onDragRegionMouseDown}
      />
      <main className="relative z-10 flex min-h-screen items-center justify-center px-6 py-8">
        <section className={`flex w-full ${props.wide ? 'max-w-[520px]' : 'max-w-[420px]'} flex-col items-center text-center`}>
          <NimiLogoMark className="h-12 w-12" />
          <h1 className="mt-4 text-xl font-medium leading-snug text-[var(--nimi-text-primary)]">
            {props.title}
          </h1>
          {props.description ? (
            <p className="mt-3 max-w-[28rem] text-sm leading-6 text-[var(--nimi-text-secondary)]">
              {props.description}
            </p>
          ) : null}
          {props.children}
        </section>
      </main>
    </div>
  );
}

/**
 * One recovery layout for states where the ordinary shell cannot be entered:
 * what happened in plain words, an automatic-status line when Nimi keeps
 * trying on its own, a real retry, the degraded Support entry (repair and
 * recovery stay reachable, product-surfaces r029) and folded technical detail.
 */
export function DesktopRecoveryActions(props: {
  readonly testId: string;
  readonly status?: string;
  readonly retryLabel: string;
  readonly onRetry: () => void;
  readonly retrying?: boolean;
  readonly technicalDetail?: string;
}) {
  const { t } = useTranslation();
  return (
    <div data-testid={props.testId} className="mt-4 flex w-full flex-col items-center gap-4">
      {props.status ? (
        <p role="status" className="text-xs text-[var(--nimi-text-muted)]">{props.status}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          data-testid={`${props.testId}-retry`}
          onClick={props.onRetry}
          disabled={props.retrying}
          className={STATUS_SHELL_PRIMARY_BUTTON}
        >
          {props.retryLabel}
        </button>
        <SupportDegradedEntry />
      </div>
      {props.technicalDetail ? (
        <details className="w-full max-w-[28rem] text-left text-xs text-[var(--nimi-text-muted)]">
          <summary className="cursor-pointer text-center">{t('Feedback.technicalDetails')}</summary>
          <p className="mt-2 break-words rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 font-mono">{props.technicalDetail}</p>
        </details>
      ) : null}
    </div>
  );
}
