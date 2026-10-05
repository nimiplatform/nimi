import type {
  NimiMachineLoadout,
  NimiRuntimeLocalVerifiedAssetDescriptor,
  NimiRuntimeModelAssetRecord,
} from '@nimiplatform/sdk/runtime';
import { CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';
import { loadoutAssetLabel, loadoutModelPresentation, loadoutSlotLabelKey } from './runtime-config-loadout-model-display.js';
import type { RuntimeSetupTask } from './runtime-setup-task-store.js';

// @nimi-authority: rule.nimi.desktop.product-surfaces.global-downloads
export function DownloadSetupModels(props: {
  readonly task: RuntimeSetupTask;
  readonly loadouts: readonly NimiMachineLoadout[];
  readonly assets: readonly NimiRuntimeModelAssetRecord[];
  readonly catalog: readonly NimiRuntimeLocalVerifiedAssetDescriptor[];
  readonly loading: boolean;
  readonly unavailable: boolean;
  readonly showCapability?: boolean;
}) {
  const { t } = useTranslation();
  const { task } = props;
  const cloud = task.draft?.route === 'cloud';
  // History belongs to this task's exact configuration, never today's selection.
  const loadout = props.loadouts.find((item) => item.loadoutId === task.candidateLoadoutId
    && item.revision === task.candidateRevisionBaseline);
  const axes = loadout?.modelAxes.filter((axis) => axis.modelAssetId) ?? [];
  const noDownload = task.status === 'done' && task.refs.installPlanIds.length === 0
    && task.refs.transferIds.length === 0;
  const hasDownloads = task.refs.installPlanIds.length > 0 || task.refs.transferIds.length > 0;
  return (
    <div className="my-3 space-y-2 text-xs text-[var(--nimi-text-secondary)]" data-testid={`download-setup-models:${task.taskId}`}>
      {props.showCapability ? (
        <p className="font-medium text-[var(--nimi-text-primary)]">
          {displayRuntimeConfigCapabilityLabel(task.capabilityContract, t)}
          {' · '}{t(`runtimeConfig.setupTask.status.${task.status}`)}
        </p>
      ) : null}
      {cloud && task.draft?.cloudTargetLabel ? (
        <p>{t('runtimeConfig.downloads.configuredModel', { name: task.draft.cloudTargetLabel })}</p>
      ) : !cloud && props.loading ? (
        <p>{t('runtimeConfig.downloads.modelsLoading')}</p>
      ) : !cloud && props.unavailable ? (
        <p>{t('runtimeConfig.downloads.modelsReadFailed')}</p>
      ) : !cloud && axes.length > 0 ? (
        <ul className="divide-y divide-[var(--nimi-border-subtle)] overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-active)]/45">
          {axes.map((axis) => {
            const asset = props.assets.find((item) => item.modelAssetId === axis.modelAssetId);
            const title = asset ? loadoutModelPresentation({
              title: loadoutAssetLabel(asset, props.catalog), variantLabel: asset.entry,
            }).headline : axis.modelAssetId;
            const slotKey = loadoutSlotLabelKey(axis.slotId);
            return <li key={axis.slotId} className="flex items-baseline gap-3 px-3 py-1.5">
              <span className="w-24 shrink-0 text-[var(--nimi-text-muted)]">
                {slotKey ? t(slotKey) : t('runtimeConfig.downloads.modelLabel')}
              </span>
              <span className="min-w-0 break-words font-medium text-[var(--nimi-text-primary)]">{title}</span>
            </li>;
          })}
        </ul>
      ) : (
        <p>{t(hasDownloads ? 'runtimeConfig.downloads.modelsSeeTransfers' : 'runtimeConfig.downloads.modelsUnavailable')}</p>
      )}
      {cloud ? <p>{t('runtimeConfig.downloads.cloudNoDownload')}</p>
        : noDownload && axes.length > 0 && !props.loading && !props.unavailable ? (
          <p className="flex items-center gap-1.5 text-[var(--nimi-text-muted)]">
            <CircleCheck size={13} aria-hidden="true" className="shrink-0 text-[var(--nimi-status-success-soft-text)]" />
            {t('runtimeConfig.downloads.usedInstalledModels')}
          </p>
        ) : null}
    </div>
  );
}
