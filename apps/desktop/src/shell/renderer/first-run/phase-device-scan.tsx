import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/kit/ui';

type PhaseDeviceScanProps = {
  readonly deviceSummary: string | null;
  readonly deviceScanPending: boolean;
  readonly dataRootPath: string | null;
  readonly busy: boolean;
  readonly onRetry: () => void;
  readonly onChangeDataRoot: () => void;
  readonly onContinue: () => void;
};

export function PhaseDeviceScan(props: PhaseDeviceScanProps): ReactElement {
  const { t } = useTranslation();
  const canContinue = !props.busy && !props.deviceScanPending && props.deviceSummary !== null;

  return (
    <div data-testid="first-run-phase-device-scan" className="flex flex-col gap-7 text-center">
      <header className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">
          {t('FirstRun.deviceScan.heading', { defaultValue: 'Check this device' })}
        </h2>
        <p className="text-sm text-[var(--nimi-text-secondary)]">
          {t('FirstRun.deviceScan.subheading', {
            defaultValue: 'Nimi checks local hardware before offering local AI setup options.',
          })}
        </p>
      </header>

      <div className="rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-5 py-4">
        <p
          data-testid="first-run-device-summary"
          data-device-scan={props.deviceScanPending ? 'pending' : 'settled'}
          className="text-sm text-[var(--nimi-text-secondary)]"
        >
          {props.deviceScanPending ? (
            <span className="inline-flex items-center gap-2">
              <span className="nimi-first-run-pulse inline-block h-2 w-2 rounded-full bg-[var(--nimi-action-primary-bg)]" />
              {t('FirstRun.deviceScan.checking', { defaultValue: 'Checking device environment…' })}
            </span>
          ) : props.deviceSummary ? (
            t('FirstRun.deviceScan.detected', {
              device: props.deviceSummary,
              defaultValue: 'Detected: {{device}}',
            })
          ) : (
            t('FirstRun.deviceScan.unavailable', {
              defaultValue: 'Device scan evidence is unavailable.',
            })
          )}
        </p>
        {props.dataRootPath ? (
          <p
            data-testid="first-run-device-scan-storage-row"
            className="mt-2 truncate text-xs text-[var(--nimi-text-muted)]"
          >
            {t('FirstRun.deviceScan.storageFolder', {
              path: props.dataRootPath,
              defaultValue: 'Nimi data: {{path}}',
            })}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button
          type="button"
          tone="secondary"
          data-testid="first-run-device-scan-change-folder"
          disabled={props.busy}
          onClick={props.onChangeDataRoot}
        >
          {t('FirstRun.deviceScan.changeFolder', { defaultValue: 'Change folder' })}
        </Button>
        <Button
          type="button"
          tone="secondary"
          data-testid="first-run-device-scan-retry"
          disabled={props.busy || props.deviceScanPending}
          onClick={props.onRetry}
        >
          {t('FirstRun.deviceScan.retry', { defaultValue: 'Retry scan' })}
        </Button>
        <Button
          type="button"
          data-testid="first-run-device-scan-continue"
          disabled={!canContinue}
          onClick={props.onContinue}
        >
          {t('FirstRun.deviceScan.continue', { defaultValue: 'Continue' })}
        </Button>
      </div>
    </div>
  );
}
