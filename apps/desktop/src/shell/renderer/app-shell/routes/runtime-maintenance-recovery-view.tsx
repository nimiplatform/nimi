import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@nimiplatform/kit/ui';
import { SupportDegradedEntry } from '../../features/support/support-degraded-entry.js';
import type { ProductControlMaintenanceReplacementProjection } from '../../bridge/runtime-bridge/product-control.js';

export type RuntimeMaintenanceRecoveryPhase =
  | 'idle'
  | 'replacing'
  | 'relaunching'
  | 'source-restart'
  | 'restart-failed'
  | 'restart-required'
  | 'not-empty'
  | 'overlaps'
  | 'failed';

export type RuntimeMaintenanceRecoveryViewProps = {
  readonly reasonCode: string;
  readonly currentRoot: string | null;
  readonly phase: RuntimeMaintenanceRecoveryPhase;
  readonly pendingTarget: string | null;
  readonly technicalDetail: string | null;
  readonly auditUnrecorded?: boolean;
  readonly sourceRuntime: boolean;
  readonly onChooseFolder: () => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
  readonly onReopen: () => void;
};

const PRIMARY_BUTTON = 'inline-flex h-10 min-w-36 items-center justify-center rounded-full bg-[var(--nimi-action-primary-bg)] px-5 text-sm font-semibold text-[var(--nimi-action-primary-text)] transition-colors hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-60';

/**
 * Maps the typed replacement outcome to the next page state. The Runtime
 * owner decides; the page only presents its result.
 */
export function runtimeMaintenancePhaseForReplacement(
  projection: ProductControlMaintenanceReplacementProjection,
): RuntimeMaintenanceRecoveryPhase {
  if (projection.activation?.activated) {
    if (projection.auditDiagnostic && !projection.maintenanceRestart) return 'restart-required';
    if (projection.maintenanceRestart === 'relaunching') return 'relaunching';
    if (projection.maintenanceRestart === 'source_runtime_restart_required') return 'source-restart';
    return 'restart-failed';
  }
  if (projection.activation?.reasonCode === 'DATA_ROOT_NOT_EMPTY') return 'not-empty';
  if (projection.activation?.reasonCode === 'DATA_ROOT_OVERLAPS_CURRENT') return 'overlaps';
  return 'failed';
}

// @nimi-authority: rule.nimi.desktop.product-surfaces.r038
/** The page body without the status shell, so it renders in isolation. */
export function RuntimeMaintenanceRecoveryContent(props: RuntimeMaintenanceRecoveryViewProps) {
  const { t } = useTranslation();
  const busy = props.phase === 'replacing' || props.phase === 'relaunching';
  const committed = props.phase === 'relaunching' || props.phase === 'source-restart' || props.phase === 'restart-failed' || props.phase === 'restart-required';
  const notice = props.phase === 'not-empty'
    ? t('Bootstrap.maintenanceNotEmpty')
    : props.phase === 'overlaps'
      ? t('Bootstrap.maintenanceOverlaps')
      : props.phase === 'failed'
        ? t('Bootstrap.maintenanceFailed')
        : null;
  const status = props.phase === 'replacing'
    ? t('Bootstrap.maintenanceReplacing')
    : props.phase === 'relaunching'
      ? t('Bootstrap.maintenanceRelaunching')
      : props.phase === 'source-restart'
        ? t('Bootstrap.maintenanceSourceRestart')
        : props.phase === 'restart-failed'
          ? t('Bootstrap.maintenanceRestartFailed')
          : null;
  const technicalLines = [
    props.reasonCode,
    props.technicalDetail,
    props.sourceRuntime ? t('Bootstrap.maintenanceDeveloperHint') : null,
  ].filter((line): line is string => Boolean(line));
  return (
    <>
      <div data-testid="runtime-maintenance-recovery" data-phase={props.phase} className="mt-5 flex w-full flex-col gap-4 text-left">
        <div className="rounded-xl bg-[var(--nimi-surface-canvas)] px-4 py-3">
          <p className="text-xs text-[var(--nimi-text-muted)]">{t('Bootstrap.maintenanceCurrentFolder')}</p>
          <p data-testid="runtime-maintenance-current-root" className="mt-1 break-all text-sm text-[var(--nimi-text-secondary)]">
            {props.currentRoot ?? '-'}
          </p>
        </div>
        {committed ? null : (
          <p className="text-sm leading-6 text-[var(--nimi-text-secondary)]">{t('Bootstrap.maintenanceChooseHelp')}</p>
        )}
        {notice ? (
          <p role="alert" className="text-sm text-[var(--nimi-status-warning)]">{notice}</p>
        ) : null}
        {status ? (
          <p role="status" data-testid="runtime-maintenance-status" className="text-sm text-[var(--nimi-text-secondary)]">{status}</p>
        ) : null}
        {props.auditUnrecorded ? <p role="alert" className="text-sm text-[var(--nimi-status-warning)]">{t('DataManagement.dataRootReplacedAuditUnrecorded')}</p> : null}
        <div className="flex flex-wrap items-center justify-center gap-2">
          {committed ? (
            props.phase === 'relaunching' ? null : (
              <button type="button" data-testid="runtime-maintenance-reopen" className={PRIMARY_BUTTON} onClick={props.onReopen}>
                {t('Bootstrap.maintenanceReopen')}
              </button>
            )
          ) : (
            <button
              type="button"
              data-testid="runtime-maintenance-choose-folder"
              className={PRIMARY_BUTTON}
              disabled={busy}
              onClick={props.onChooseFolder}
            >
              {t('Bootstrap.maintenanceChooseFolder')}
            </button>
          )}
          <SupportDegradedEntry />
        </div>
        <details className="w-full text-xs text-[var(--nimi-text-muted)]">
          <summary className="cursor-pointer text-center">{t('Feedback.technicalDetails')}</summary>
          <div className="mt-2 space-y-1 rounded-lg bg-[var(--nimi-surface-canvas)] px-3 py-2">
            {technicalLines.map((line) => (
              <p key={line} className="break-words font-mono">{line}</p>
            ))}
          </div>
        </details>
      </div>
      <ConfirmDialog
        open={props.pendingTarget !== null}
        title={t('Bootstrap.maintenanceConfirmTitle')}
        message={t('Bootstrap.maintenanceConfirmBody', {
          target: props.pendingTarget ?? '',
          current: props.currentRoot ?? '-',
        })}
        confirmLabel={t('Bootstrap.maintenanceConfirm')}
        cancelLabel={t('Bootstrap.maintenanceCancel')}
        onConfirm={props.onConfirm}
        onClose={props.onCancel}
      />
    </>
  );
}
