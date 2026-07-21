import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import type { NimiProductControlState } from '../bridge';

export function FirstRunReconcilingScreen(props: {
  readonly productState: NimiProductControlState;
  readonly mode?: 'auth' | 'ready-record';
}): ReactElement {
  const { t } = useTranslation();
  const mode = props.mode ?? 'auth';
  useEffect(() => {
    logRendererEvent({
      level: 'warn',
      area: 'first-run',
      message: mode === 'ready-record'
        ? 'first-run-gate:ready-record-return-run-reconciling'
        : 'first-run-gate:not-logged-in-leaked-past-admission',
      details: {
        productState: props.productState,
      },
    });
  }, [mode, props.productState]);
  const label = mode === 'ready-record'
    ? t('FirstRun.reconcilingReadyRecord', { defaultValue: 'Reconciling local readiness…' })
    : t('FirstRun.reconcilingAuth', { defaultValue: 'Reconciling sign-in state…' });
  return (
    <div
      data-testid="first-run-screen-reconciling"
      data-product-state={props.productState}
      className="flex flex-col items-center gap-3 text-center text-sm text-[var(--nimi-text-secondary)]"
    >
      <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--nimi-action-primary-bg)]" />
      <span>{label}</span>
    </div>
  );
}
