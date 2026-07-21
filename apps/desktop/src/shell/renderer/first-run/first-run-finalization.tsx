import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { NimiProductControlRecordProjection } from '../bridge';
import type { DesktopRendererFirstRunPort } from '../renderer/first-run-port.js';

/**
 * Desktop first-run finalization surface for the `local_ai_ready` state.
 *
 * At `local_ai_ready` the renderer asks the backend to refresh owner evidence,
 * then requests backend admission of the `ready_for_use` transition via
 * `desktopBridge.admitProductReadyForUse()` and displays finalization progress
 * only. Per cold-start-authority-contract P-COLD-016 the renderer never writes
 * `ready_for_use`, mints refs, or declares refs valid; the backend admission op
 * is the sole authority. The returned projection routes the workflow:
 * `ready_for_use` on success, the earliest-failed `state` (with a non-null
 * `error`) on failure.
 */

type FinalizationStatus = 'requesting' | 'failed';

type FirstRunFinalizationProps = {
  readonly firstRun: DesktopRendererFirstRunPort;
  readonly projection: NimiProductControlRecordProjection;
  readonly onProjectionChange: (projection: NimiProductControlRecordProjection) => void;
};

export function FirstRunFinalization(props: FirstRunFinalizationProps): ReactElement {
  const { t } = useTranslation();
  const notifyProjectionChange = props.onProjectionChange;
  const [status, setStatus] = useState<FinalizationStatus>('requesting');
  const [error, setError] = useState<string | null>(props.projection.error ?? null);
  const autoRequestedRef = useRef(false);

  const requestAdmission = useCallback(async (): Promise<void> => {
    setStatus('requesting');
    setError(null);
    try {
      const { prepared, final } = await props.firstRun.finalize();
      notifyProjectionChange(prepared);
      if (prepared.state !== 'local_ai_ready' && prepared.state !== 'ready_for_use') {
        setStatus('failed');
        setError(prepared.error);
        return;
      }
      const next = final;
      notifyProjectionChange(next);
      if (next.state !== 'ready_for_use') {
        setStatus('failed');
        setError(next.error);
      }
    } catch (nextError) {
      setStatus('failed');
      setError(
        nextError instanceof Error
          ? nextError.message
          : t('FirstRun.errors.finalizationRequestFailed', {
              defaultValue: 'Failed to request first-run finalization.',
            }),
      );
    }
  }, [notifyProjectionChange, props.firstRun, t]);

  // Request admission once on entry into `local_ai_ready`. The backend is the
  // only authority that may admit `ready_for_use`; the renderer only requests.
  useEffect(() => {
    if (autoRequestedRef.current) return;
    autoRequestedRef.current = true;
    void requestAdmission();
  }, [requestAdmission]);

  return (
    <div
      data-testid="product-first-run-finalization"
      data-finalization-status={status}
      className="flex flex-col gap-3 rounded-lg border border-[color:var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_82%,transparent)] p-3"
    >
      <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
        {t('FirstRun.finalizationTitle', { defaultValue: 'Finalizing' })}
      </p>
      <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">
        {t('FirstRun.states.local_ai_ready.body', {
          defaultValue:
            'Account Default Profile, built-in AIConfigs, and baseline execution evidence still need finalization.',
        })}
      </p>
      {status === 'failed' ? (
        <div className="flex flex-col gap-3">
          {error ? (
            <p
              data-testid="product-first-run-finalization-error"
              className="rounded-md border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,white)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,white)] px-3 py-2 text-sm text-[var(--nimi-status-danger)]"
            >
              {error}
            </p>
          ) : null}
          <button
            type="button"
            data-testid="product-first-run-finalization-retry"
            onClick={() => void requestAdmission()}
            className="min-h-10 w-fit rounded-md bg-[var(--nimi-accent)] px-4 text-sm font-semibold text-white"
          >
            {t('FirstRun.finalizationRetry', { defaultValue: 'Retry finalization' })}
          </button>
        </div>
      ) : null}
    </div>
  );
}
