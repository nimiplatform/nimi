import { useDesktopI18nResource } from '../../i18n/i18n-context';
import type { RefObject } from 'react';

import type {
  NimiRuntimeLocalAssetDeclaration,
  NimiRuntimeLocalAssetKind,
  NimiRuntimeLocalUnregisteredAssetDescriptor,
} from '@nimiplatform/sdk/runtime';
import { cn } from '@nimiplatform/kit/ui';
import { Button, RuntimeSelect } from './runtime-config-primitives';
import {
  ASSET_ENGINE_OPTIONS,
  formatBytes,
  type AssetEngineOption,
} from './runtime-config-model-center-utils';
import {
  ALL_ASSET_KIND_OPTIONS,
  DownloadIcon,
  FolderOpenIcon,
  formatAssetKindLabel,
  HeartPulseIcon,
  RefreshIcon,
  SearchIcon,
  formatLastCheckedAgo,
} from './runtime-config-local-model-center-helpers';
export {
  AssetRequirementBadges,
  LocalModelCenterActiveDownloadsSection,
  LocalModelCenterActiveImportsSection,
  LocalModelCenterAssetTasksSection,
  LocalModelCenterQuickPicksSection,
  LocalModelCenterVerifiedAssetsSection,
} from './runtime-config-local-model-center-catalog-sections';

type ToolbarProps = {
  checkingHealth: boolean;
  lastCheckedAt: string | null;
  discovering: boolean;
  importMenuRef: RefObject<HTMLDivElement | null>;
  showImportMenu: boolean;
  onHealthCheck: () => void;
  onRefresh: () => void;
  onOpenModelsFolder: () => void;
  onToggleImportMenu: () => void;
  onOpenImportFile: () => void;
  onOpenImportBundle: () => void;
  onImportManifest: () => void;
};

export function LocalModelCenterToolbar(props: ToolbarProps) {
  const i18nResource = useDesktopI18nResource();
  const i18n = i18nResource.instance;
  const healthTooltip = formatLastCheckedAgo(props.lastCheckedAt, i18nResource);
  const iconBtnClass = 'flex h-8 w-8 items-center justify-center rounded-lg text-[var(--nimi-text-muted)] hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_8%,transparent)] hover:text-[var(--nimi-text-secondary)] disabled:opacity-50 transition-colors';

  return (
    <div className="flex items-center justify-end gap-2">
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={props.onHealthCheck}
          disabled={props.checkingHealth}
          title={props.checkingHealth
            ? i18n.t('runtimeConfig.localModelCenter.checking', { defaultValue: 'Checking Runtime...' })
            : `${i18n.t('runtimeConfig.localModelCenter.health', { defaultValue: 'Check Runtime' })}${healthTooltip ? ` \u00b7 ${healthTooltip}` : ''}`}
          aria-label={i18n.t('runtimeConfig.localModelCenter.health', { defaultValue: 'Check Runtime' })}
          className={iconBtnClass}
        >
          <HeartPulseIcon className={cn('h-4 w-4', props.checkingHealth ? 'animate-pulse' : undefined)} />
        </button>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.discovering}
          title={props.discovering
            ? i18n.t('runtimeConfig.localModelCenter.refreshing', { defaultValue: 'Refreshing...' })
            : i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
          aria-label={i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
          className={iconBtnClass}
        >
          <RefreshIcon className={cn('h-4 w-4', props.discovering ? 'animate-spin' : undefined)} />
        </button>
        <button
          type="button"
          onClick={props.onOpenModelsFolder}
          title={i18n.t('runtimeConfig.localModelCenter.openModelsFolder', { defaultValue: 'Open Folder' })}
          aria-label={i18n.t('runtimeConfig.localModelCenter.openModelsFolder', { defaultValue: 'Open Folder' })}
          className={iconBtnClass}
        >
          <FolderOpenIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="h-5 w-px bg-[var(--nimi-border-subtle)]" aria-hidden="true" />
      <div className="relative" ref={props.importMenuRef}>
        <Button
          size="sm"
          onClick={props.onToggleImportMenu}
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          {i18n.t('runtimeConfig.localModelCenter.import', { defaultValue: 'Import' })}
        </Button>
          {props.showImportMenu ? (
            <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-overlay)] shadow-[var(--nimi-elevation-floating)]">
              <button type="button" onClick={props.onOpenImportFile} className="w-full px-3 py-2.5 text-left text-xs transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_6%,transparent)]">
                <div className="font-medium text-[var(--nimi-text-primary)]">
                  {i18n.t('runtimeConfig.localModelCenter.importAssetFile', { defaultValue: 'Import Asset File' })}
                </div>
                <div className="mt-0.5 text-[var(--nimi-text-muted)]">
                  {i18n.t('runtimeConfig.localModelCenter.supportedAssetFileTypes', {
                    defaultValue: '.gguf, .safetensors, .bin, .onnx',
                  })}
                </div>
              </button>
              <button type="button" onClick={props.onOpenImportBundle} className="w-full border-t border-[var(--nimi-border-subtle)] px-3 py-2.5 text-left text-xs transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_6%,transparent)]">
                <div className="font-medium text-[var(--nimi-text-primary)]">
                  {i18n.t('runtimeConfig.localModelCenter.importBundle', { defaultValue: 'Import Asset Bundle Folder' })}
                </div>
                <div className="mt-0.5 text-[var(--nimi-text-muted)]">
                  {i18n.t('runtimeConfig.localModelCenter.supportedAssetBundleFolder', {
                    defaultValue: 'Complete text-generation or verified Qwen3 speech model directory',
                  })}
                </div>
              </button>
              <button type="button" onClick={props.onImportManifest} className="w-full border-t border-[var(--nimi-border-subtle)] px-3 py-2.5 text-left text-xs transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_6%,transparent)]">
                <div className="font-medium text-[var(--nimi-text-primary)]">
                  {i18n.t('runtimeConfig.localModelCenter.importRuntimeManifest', { defaultValue: 'Import Runtime Manifest' })}
                </div>
                <div className="mt-0.5 text-[var(--nimi-text-muted)]">
                  {i18n.t('runtimeConfig.localModelCenter.supportedRuntimeManifestFileType', {
                    defaultValue: 'asset.manifest.json',
                  })}
                </div>
              </button>
            </div>
          ) : null}
      </div>
    </div>
  );
}

type ImportDialogProps = {
  visible: boolean;
  assetKind: NimiRuntimeLocalAssetKind;
  auxiliaryEngine: AssetEngineOption | '';
  onAssetKindChange: (kind: NimiRuntimeLocalAssetKind) => void;
  onAuxiliaryEngineChange: (engine: AssetEngineOption | '') => void;
  onClose: () => void;
  onChooseFile: () => void;
  onChooseFolder: () => void;
  canChooseFile?: boolean;
  canChooseFolder?: boolean;
};

export function LocalModelCenterImportDialog(props: ImportDialogProps) {
  const i18n = useDesktopI18nResource().instance;
  if (!props.visible) {
    return null;
  }
  return (
    <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5 shadow-[var(--nimi-elevation-raised)]">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)]">
            <FolderOpenIcon className="h-3.5 w-3.5 text-[var(--nimi-action-primary-bg)]" />
          </div>
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {i18n.t('runtimeConfig.localModelCenter.importLocalAsset', { defaultValue: 'Import Local Asset' })}
          </h3>
        </div>
        <button type="button" onClick={props.onClose} className="text-xs text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)] hover:text-[var(--nimi-text-secondary)]">
          {i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.assetKindLabel', { defaultValue: 'Type:' })}
          </span>
          <RuntimeSelect
            value={props.assetKind}
            onChange={(value) => props.onAssetKindChange((value || 'chat') as NimiRuntimeLocalAssetKind)}
            className="w-36"
            options={ALL_ASSET_KIND_OPTIONS.map((kind) => ({ value: kind, label: formatAssetKindLabel(kind) }))}
          />
        </div>
        {props.assetKind === 'auxiliary' ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.engineLabel', { defaultValue: 'Engine:' })}
            </span>
            <RuntimeSelect
              value={props.auxiliaryEngine}
              onChange={(value) => props.onAuxiliaryEngineChange((value || '') as AssetEngineOption | '')}
              className="w-32"
              placeholder={i18n.t('runtimeConfig.localModelCenter.selectEngine', { defaultValue: 'Select engine' })}
              options={ASSET_ENGINE_OPTIONS.map((engine) => ({ value: engine, label: engine }))}
            />
          </div>
        ) : null}
        <Button
          size="sm"
          onClick={props.onChooseFile}
          disabled={props.canChooseFile === false}
        >
          <FolderOpenIcon className="h-3.5 w-3.5" />
          {i18n.t('runtimeConfig.localModelCenter.chooseFile', { defaultValue: 'Choose File' })}
        </Button>
        <button
          type="button"
          onClick={props.onChooseFolder}
          disabled={props.canChooseFolder === false}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--nimi-border-subtle)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-surface-card)_90%,var(--nimi-surface-panel))] disabled:opacity-50"
        >
          <FolderOpenIcon className="h-3.5 w-3.5" />
          {i18n.t('runtimeConfig.localModelCenter.chooseFolder', { defaultValue: 'Choose Folder' })}
        </button>
      </div>
      {props.canChooseFolder === false ? (
        <p className="mt-2 text-[length:var(--nimi-type-caption-size)] text-[var(--nimi-text-muted)]">
          {i18n.t('runtimeConfig.localModelCenter.bundleImportSupportedKindsHint', {
            defaultValue: 'Bundle folder import currently supports text-generation and verified Qwen3 speech assets.',
          })}
        </p>
      ) : null}
    </div>
  );
}

type UnregisteredAssetsSectionProps = {
  assets: NimiRuntimeLocalUnregisteredAssetDescriptor[];
  assetImportError: string;
  importingAssetPath: string | null;
  resolveDraft: (asset: NimiRuntimeLocalUnregisteredAssetDescriptor) => NimiRuntimeLocalAssetDeclaration;
  onRefresh: () => void;
  onAssetKindChange: (path: string, kind: NimiRuntimeLocalAssetKind) => void;
  onAuxiliaryEngineChange: (path: string, engine: AssetEngineOption | '') => void;
  onImport: (path: string) => void;
};

export function LocalModelCenterUnregisteredAssetsSection(props: UnregisteredAssetsSectionProps) {
  const i18n = useDesktopI18nResource().instance;
  if (props.assets.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-raised)]">
      <div className="flex items-center justify-between border-b border-[var(--nimi-border-subtle)] px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)]">
            <FolderOpenIcon className="h-4 w-4 text-[var(--nimi-status-warning)]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
              {i18n.t('runtimeConfig.localModelCenter.unregisteredAssetsTitle', {
                defaultValue: 'Unregistered Assets',
              })}
            </h3>
            <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.unregisteredAssetsAutoImportHint', {
                defaultValue: 'Discovered assets stay pending until you choose Import.',
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] px-2.5 py-0.5 text-xs font-medium text-[var(--nimi-status-warning)]">
            {props.assets.length}
          </span>
          <button
            type="button"
            onClick={props.onRefresh}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[var(--nimi-text-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_8%,transparent)]"
          >
            <RefreshIcon className="h-3 w-3" />
            {i18n.t('runtimeConfig.localModelCenter.rescanFolder', { defaultValue: 'Rescan folder' })}
          </button>
        </div>
      </div>
      {props.assetImportError ? (
        <div className="mx-4 mt-4 rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-4 py-2.5 text-xs text-[var(--nimi-status-danger)]">
          {props.assetImportError}
        </div>
      ) : null}
      <div className="space-y-3 p-4">
        {props.assets.map((asset) => {
          const draft = props.resolveDraft(asset);
          const importing = props.importingAssetPath === asset.path;
          const requiresEngine = draft.assetKind === 'auxiliary';
          const canImport = Boolean(draft.assetKind)
            && (!requiresEngine || Boolean(String(draft.engine || '').trim()));
          const confidenceClass = asset.confidence === 'high'
            ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]'
            : 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]';

          return (
            <div key={asset.path} className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-4 shadow-[var(--nimi-elevation-base)] transition-all hover:border-[var(--nimi-border-strong)] hover:shadow-[var(--nimi-elevation-raised)]">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]">
                  <FolderOpenIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{asset.filename}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[length:var(--nimi-type-caption-size)] font-medium ${confidenceClass}`}>
                      {asset.confidence === 'high'
                        ? i18n.t('runtimeConfig.localModelCenter.highConfidence', { defaultValue: 'High confidence' })
                        : i18n.t('runtimeConfig.localModelCenter.reviewNeeded', { defaultValue: 'Review needed' })}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                    {formatBytes(asset.sizeBytes)}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[color-mix(in_srgb,var(--nimi-border-subtle)_50%,transparent)] pt-3">
                <RuntimeSelect
                  value={draft.assetKind || 'chat'}
                  onChange={(value) => props.onAssetKindChange(asset.path, (value || 'chat') as NimiRuntimeLocalAssetKind)}
                  className="w-36"
                  options={ALL_ASSET_KIND_OPTIONS.map((kind) => ({ value: kind, label: formatAssetKindLabel(kind) }))}
                />
                {requiresEngine ? (
                  <RuntimeSelect
                    value={String(draft.engine || '')}
                    onChange={(value) => props.onAuxiliaryEngineChange(asset.path, (value || '') as AssetEngineOption | '')}
                    className="w-36"
                    placeholder={i18n.t('runtimeConfig.localModelCenter.selectEngine', { defaultValue: 'Select engine' })}
                    options={ASSET_ENGINE_OPTIONS.map((engine) => ({ value: engine, label: engine }))}
                  />
                ) : null}
                <span className="ml-auto">
                  <Button
                    size="sm"
                    onClick={() => props.onImport(asset.path)}
                    disabled={!canImport || importing}
                  >
                    <DownloadIcon className="h-3.5 w-3.5" />
                    {importing
                      ? i18n.t('runtimeConfig.localModelCenter.importing', { defaultValue: 'Importing...' })
                      : i18n.t('runtimeConfig.localModelCenter.import', { defaultValue: 'Import' })}
                  </Button>
                </span>
              </div>
              <p className="mt-2 truncate text-[length:var(--nimi-type-caption-size)] text-[color-mix(in_srgb,var(--nimi-text-muted)_60%,transparent)]">{asset.path}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { SearchIcon };
