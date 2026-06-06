import { useEffect, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { logRendererEvent } from '@nimiplatform/kit/telemetry';
import type { NimiProductControlState } from '@renderer/bridge';

/**
 * Defensive surface for the `not_logged_in` terminal screen that AppRoutes'
 * admission gate is expected to intercept upstream.
 */
export function FirstRunReconcilingScreen(props: {
  readonly productState: NimiProductControlState;
}): ReactElement {
  const { t } = useTranslation();
  useEffect(() => {
    logRendererEvent({
      level: 'warn',
      area: 'first-run',
      message: 'first-run-gate:not-logged-in-leaked-past-admission',
      details: {
        productState: props.productState,
      },
    });
  }, [props.productState]);
  return (
    <div
      data-testid="first-run-screen-reconciling"
      data-product-state={props.productState}
      className="flex flex-col items-center gap-3 text-center text-sm text-[var(--nimi-text-secondary)]"
    >
      <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--nimi-action-primary-bg)]" />
      <span>{t('FirstRun.reconcilingAuth', { defaultValue: 'Reconciling sign-in state…' })}</span>
    </div>
  );
}
