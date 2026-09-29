import type { ReactNode, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AmbientBackground, Surface } from '@nimiplatform/kit/ui';
import { useDesktopRendererBindings } from '../../renderer/binding-context';
import bootstrapLogoImage from '../../assets/logo.png';
import { SupportDegradedEntry } from '../../features/support/support-degraded-entry.js';

export function NimiLogoMark({ className = 'h-12 w-12' }: { className?: string }) {
  return (
    <img src={bootstrapLogoImage} alt="" className={`${className} object-contain`} aria-hidden="true" />
  );
}

const MACOS_TRAFFIC_LIGHT_SAFE_ZONE_PX = 92;

export function SharedStatusShell(props: {
  eyebrow: string;
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
    <AmbientBackground
      variant="mesh"
      className="min-h-screen overflow-hidden bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-primary)]"
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 z-20 h-8"
        onMouseDown={onDragRegionMouseDown}
      />
      <div className="relative z-10 flex min-h-screen items-center justify-center p-6">
        <Surface
          as="section"
          tone="panel"
          material="glass-regular"
          padding="none"
          className={`w-full ${props.wide ? 'max-w-[520px]' : 'max-w-[420px]'} rounded-2xl px-6 py-7 sm:px-7 sm:py-8`}
        >
          <div className="flex flex-col items-center text-center">
            <div className="relative mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-raised)]">
              <NimiLogoMark className="h-10 w-10" />
            </div>
            <div className="mb-3 rounded-full border border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_18%,var(--nimi-surface-card))] bg-[var(--nimi-surface-active)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--nimi-action-primary-bg-hover)]">
              {props.eyebrow}
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.02em] text-[var(--nimi-text-primary)]">
              {props.title}
            </h1>
            {props.description ? (
              <p className="mt-3 max-w-[28rem] text-sm leading-6 text-[var(--nimi-text-secondary)]">
                {props.description}
              </p>
            ) : null}
            {props.children}
          </div>
        </Surface>
      </div>
    </AmbientBackground>
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
    <div data-testid={props.testId} className="mt-6 flex w-full flex-col items-center gap-4">
      {props.status ? (
        <p role="status" className="text-xs text-[var(--nimi-text-muted)]">{props.status}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          data-testid={`${props.testId}-retry`}
          onClick={props.onRetry}
          disabled={props.retrying}
          className="inline-flex h-10 min-w-36 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] px-5 text-sm font-semibold text-[var(--nimi-action-primary-text)] transition-colors hover:bg-[var(--nimi-action-primary-bg-hover)]"
        >
          {props.retryLabel}
        </button>
        <SupportDegradedEntry />
      </div>
      {props.technicalDetail ? (
        <details className="w-full text-left text-xs text-[var(--nimi-text-muted)]">
          <summary className="cursor-pointer text-center">{t('Feedback.technicalDetails')}</summary>
          <p className="mt-2 break-words rounded-lg bg-[var(--nimi-surface-canvas)] px-3 py-2 font-mono">{props.technicalDetail}</p>
        </details>
      ) : null}
    </div>
  );
}
