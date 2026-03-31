import type { RefObject } from 'react';
import { i18n } from '@renderer/i18n';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import type {
  LocalRuntimeAssetDeclaration,
  LocalRuntimeArtifactKind,
  LocalRuntimeProfileApplyResult,
  LocalRuntimeProfileResolutionPlan,
  LocalRuntimeUnregisteredAssetDescriptor,
} from '@runtime/local-runtime';
import type {
  RuntimeConfigStateV11,
  RuntimeSetupPageIdV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import type { RuntimeProfileTargetDescriptor } from './runtime-config-panel-types';
import { RuntimeSelect } from './runtime-config-primitives';
import { ModelCenterProfileSection } from './runtime-config-model-center-profile-section';
import {
  ASSET_CLASS_OPTIONS,
  ASSET_ENGINE_OPTIONS,
  MODEL_TYPE_OPTIONS,
  formatBytes,
  resolveSelectedRuntimeProfileTarget,
  type AssetClassOption,
  type AssetEngineOption,
  type ModelTypeOption,
} from './runtime-config-model-center-utils';
import {
  ARTIFACT_KIND_OPTIONS,
  DownloadIcon,
  FolderOpenIcon,
  formatArtifactKindLabel,
  HeartPulseIcon,
  RefreshIcon,
  SearchIcon,
  formatLastCheckedAgo,
} from './runtime-config-local-model-center-helpers';
export {
  ArtifactRequirementBadges,
  LocalModelCenterActiveDownloadsSection,
  LocalModelCenterActiveImportsSection,
  LocalModelCenterArtifactTasksSection,
  LocalModelCenterQuickPicksSection,
  LocalModelCenterVerifiedArtifactsSection,
} from './runtime-config-local-model-center-catalog-sections';

type ModModeViewProps = {
  state: RuntimeConfigStateV11;
  selectedProfileModId: string;
  loadingProfilePlan: boolean;
  profileSelectionLocked: boolean;
  selectedProfileId: string;
  selectedProfileCapability: string;
  profilePlanPreview: LocalRuntimeProfileResolutionPlan | null;
  runtimeProfileTargets: RuntimeProfileTargetDescriptor[];
  onSetSelectedProfileModId: (modId: string) => void;
  onSetSelectedProfileId: (profileId: string) => void;
  onSetSelectedProfileCapability: (capability: string) => void;
  onResolveProfilePlanPreview: () => void;
  onApplyProfile: (modId: string, profileId: string, capability?: string) => Promise<LocalRuntimeProfileApplyResult>;
  onNavigateToSetup?: (pageId: RuntimeSetupPageIdV11) => void;
};

export function LocalModelCenterModModeView(props: ModModeViewProps) {
  const modCapabilities = props.runtimeProfileTargets.find((item) => item.modId === props.selectedProfileModId)?.consumeCapabilities || [];
  const capabilityStatuses = modCapabilities.map((capability) => {
    const localNode = props.state.local.nodeMatrix.find((node) => node.capability === capability && node.available);
    const hasLocalModel = props.state.local.models.some((model) => model.status === 'active' && model.capabilities.includes(capability));
    return { capability, localAvailable: Boolean(localNode) || hasLocalModel };
  });
  const hasUnavailable = capabilityStatuses.some((item) => !item.localAvailable);
  const selectedProfileTarget = resolveSelectedRuntimeProfileTarget(
    props.runtimeProfileTargets,
    props.selectedProfileModId,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[var(--nimi-surface-canvas)]">
      <div className="flex h-14 shrink-0 items-center border-b border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-6">
        <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">
          {i18n.t('runtimeConfig.localModelCenter.localModels', { defaultValue: 'Local Models' })}
        </h2>
      </div>
    <ScrollArea className="flex-1" contentClassName="space-y-6 p-6">
          <div className="space-y-4 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-6">
            <div>
              <h4 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                {selectedProfileTarget?.modName
                  || props.selectedProfileModId
                  || i18n.t('runtimeConfig.localModelCenter.runtimeMod', { defaultValue: 'Runtime Mod' })}
              </h4>
              <p className="text-xs text-[var(--nimi-text-muted)]">
                {i18n.t('runtimeConfig.localModelCenter.modProfilesDescription', {
                  defaultValue: 'Configure only this mod&apos;s declared local AI profiles.',
                })}
              </p>
            </div>
            {modCapabilities.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-[var(--nimi-text-secondary)]">
                  {i18n.t('runtimeConfig.localModelCenter.aiCapabilityStatus', { defaultValue: 'AI Capability Status' })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {capabilityStatuses.map((item) => (
                    <span key={`mod-cap-status-${item.capability}`} className={`rounded-full px-3 py-1 text-[11px] font-medium ${item.localAvailable ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_18%,transparent)] text-[var(--nimi-status-success)]' : 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)] text-[var(--nimi-status-warning)]'}`}>
                      {item.capability}:{' '}
                      {item.localAvailable
                        ? i18n.t('runtimeConfig.localModelCenter.capabilityLocal', { defaultValue: 'local' })
                        : i18n.t('runtimeConfig.localModelCenter.capabilityNeedsSetup', { defaultValue: 'needs setup' })}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <ModelCenterProfileSection
              isModMode
              loadingProfilePlan={props.loadingProfilePlan}
              selectedProfileModId={props.selectedProfileModId}
              profileSelectionLocked={props.profileSelectionLocked}
              selectedProfileId={props.selectedProfileId}
              selectedProfileCapability={props.selectedProfileCapability}
              selectedProfileTarget={selectedProfileTarget}
              executionPlanPreview={props.profilePlanPreview}
              runtimeProfileTargets={props.runtimeProfileTargets}
              onSetSelectedProfileModId={props.onSetSelectedProfileModId}
              onSetSelectedProfileId={props.onSetSelectedProfileId}
              onSetSelectedProfileCapability={props.onSetSelectedProfileCapability}
              onResolveProfilePlanPreview={props.onResolveProfilePlanPreview}
              onApplyProfile={props.onApplyProfile}
            />
          </div>
          {hasUnavailable ? (
            <div className="rounded-2xl border border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_12%,transparent)] p-5">
              <p className="text-xs font-semibold text-[var(--nimi-status-warning)]">
                {i18n.t('runtimeConfig.localModelCenter.setupRequired', { defaultValue: 'Setup Required' })}
              </p>
              <p className="mt-1 text-[11px] text-[var(--nimi-status-warning)]">
                {i18n.t('runtimeConfig.localModelCenter.setupRequiredDescription', {
                  defaultValue: 'Some capabilities are not available locally. Install a local model or configure a cloud API connector to enable them.',
                })}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={() => props.onNavigateToSetup?.('local')} className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_34%,transparent)] bg-[var(--nimi-surface-card)] px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-warning)] hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)]">
                  {i18n.t('runtimeConfig.localModelCenter.installModels', { defaultValue: 'Install Models' })}
                </button>
                <button type="button" onClick={() => props.onNavigateToSetup?.('cloud')} className="px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-warning)] hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)]">
                  {i18n.t('runtimeConfig.localModelCenter.configureCloudApi', { defaultValue: 'Configure Cloud API' })}
                </button>
              </div>
            </div>
          ) : null}
      </ScrollArea>
    </div>
  );
}

type ToolbarProps = {
  checkingHealth: boolean;
  localHealthy: boolean;
  lastCheckedAt: string | null;
  discovering: boolean;
  importMenuRef: RefObject<HTMLDivElement | null>;
  showImportMenu: boolean;
  onHealthCheck: () => void;
  onRefresh: () => void;
  onOpenModelsFolder: () => void;
  onToggleImportMenu: () => void;
  onOpenImportFile: () => void;
  onImportManifest: () => void;
};

export function LocalModelCenterToolbar(props: ToolbarProps) {
  const healthTooltip = formatLastCheckedAgo(props.lastCheckedAt);
  const ghostBtnClass = 'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_8%,transparent)] disabled:opacity-50 transition-colors';

  return (
    <div className="flex items-center justify-between rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-2.5">
      <div className="flex items-center gap-2">
        <HeartPulseIcon className={`h-3.5 w-3.5 ${props.localHealthy ? 'text-[var(--nimi-status-success)]' : 'text-[var(--nimi-text-muted)]'}`} />
        <span className={`text-xs font-medium ${props.localHealthy ? 'text-[var(--nimi-status-success)]' : 'text-[var(--nimi-text-muted)]'}`}>
          {props.localHealthy
            ? i18n.t('runtimeConfig.localModelCenter.healthy', { defaultValue: 'Healthy' })
            : i18n.t('runtimeConfig.localModelCenter.notChecked', { defaultValue: 'Not checked' })}
        </span>
        {healthTooltip ? (
          <span className="text-[11px] text-[var(--nimi-text-muted)]">{healthTooltip}</span>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={props.onHealthCheck}
          disabled={props.checkingHealth}
          title={healthTooltip}
          className={ghostBtnClass}
        >
          <HeartPulseIcon className="h-4 w-4" />
          {props.checkingHealth
            ? i18n.t('runtimeConfig.localModelCenter.checking', { defaultValue: 'Checking...' })
            : i18n.t('runtimeConfig.localModelCenter.health', { defaultValue: 'Health' })}
        </button>
        <div className="h-5 w-px bg-[var(--nimi-border-subtle)]" />
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.discovering}
          className={ghostBtnClass}
        >
          <RefreshIcon className="h-4 w-4" />
          {props.discovering
            ? i18n.t('runtimeConfig.localModelCenter.refreshing', { defaultValue: 'Refreshing...' })
            : i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
        </button>
        <button
          type="button"
          onClick={props.onOpenModelsFolder}
          className={ghostBtnClass}
        >
          <FolderOpenIcon className="h-4 w-4" />
          {i18n.t('runtimeConfig.localModelCenter.openModelsFolder', { defaultValue: 'Open Folder' })}
        </button>
        <div className="relative" ref={props.importMenuRef}>
          <button
            type="button"
            onClick={props.onToggleImportMenu}
            className={ghostBtnClass}
          >
            <DownloadIcon className="h-4 w-4" />
            {i18n.t('runtimeConfig.localModelCenter.import', { defaultValue: 'Import' })}
          </button>
          {props.showImportMenu ? (
            <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-[var(--nimi-elevation-floating)]">
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
              <button type="button" onClick={props.onImportManifest} className="w-full border-t border-[var(--nimi-border-subtle)] px-3 py-2.5 text-left text-xs transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_6%,transparent)]">
                <div className="font-medium text-[var(--nimi-text-primary)]">
                  {i18n.t('runtimeConfig.localModelCenter.importRuntimeManifest', { defaultValue: 'Import Runtime Manifest' })}
                </div>
                <div className="mt-0.5 text-[var(--nimi-text-muted)]">
                  {i18n.t('runtimeConfig.localModelCenter.supportedRuntimeManifestFileType', {
                    defaultValue: 'manifest.json or artifact.manifest.json',
                  })}
                </div>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type ImportDialogProps = {
  visible: boolean;
  assetClass: AssetClassOption;
  modelType: ModelTypeOption;
  artifactKind: LocalRuntimeArtifactKind;
  auxiliaryEngine: AssetEngineOption | '';
  onAssetClassChange: (assetClass: AssetClassOption) => void;
  onModelTypeChange: (modelType: ModelTypeOption) => void;
  onArtifactKindChange: (kind: LocalRuntimeArtifactKind) => void;
  onAuxiliaryEngineChange: (engine: AssetEngineOption | '') => void;
  onClose: () => void;
  onChooseFile: () => void;
  canChooseFile?: boolean;
};

export function LocalModelCenterImportDialog(props: ImportDialogProps) {
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
            {i18n.t('runtimeConfig.localModelCenter.importLocalAssetFile', { defaultValue: 'Import Local Asset File' })}
          </h3>
        </div>
        <button type="button" onClick={props.onClose} className="text-xs text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)] hover:text-[var(--nimi-text-secondary)]">
          {i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--nimi-text-muted)]">
            {i18n.t('runtimeConfig.localModelCenter.assetClassLabel', { defaultValue: 'Asset:' })}
          </span>
          <RuntimeSelect
            value={props.assetClass}
            onChange={(value) => props.onAssetClassChange((value || 'model') as AssetClassOption)}
            className="w-36"
            options={ASSET_CLASS_OPTIONS.map((assetClass) => ({
              value: assetClass,
              label: assetClass === 'model' ? 'Main model' : 'Companion asset',
            }))}
          />
        </div>
        {props.assetClass === 'model' ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.modelTypeLabel', { defaultValue: 'Type:' })}
            </span>
            <RuntimeSelect
              value={props.modelType}
              onChange={(value) => props.onModelTypeChange((value || 'chat') as ModelTypeOption)}
              className="w-36"
              options={MODEL_TYPE_OPTIONS.map((modelType) => ({ value: modelType, label: modelType }))}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.artifactKindLabel', { defaultValue: 'Kind:' })}
            </span>
            <RuntimeSelect
              value={props.artifactKind}
              onChange={(value) => props.onArtifactKindChange((value || 'vae') as LocalRuntimeArtifactKind)}
              className="w-36"
              options={ARTIFACT_KIND_OPTIONS.map((kind) => ({ value: kind, label: formatArtifactKindLabel(kind) }))}
            />
          </div>
        )}
        {props.assetClass === 'artifact' && props.artifactKind === 'auxiliary' ? (
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
        <button
          type="button"
          onClick={props.onChooseFile}
          disabled={props.canChooseFile === false}
          className="flex items-center gap-1.5 rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:opacity-50"
        >
          <FolderOpenIcon className="h-3.5 w-3.5" />
          {i18n.t('runtimeConfig.localModelCenter.chooseFile', { defaultValue: 'Choose File' })}
        </button>
      </div>
    </div>
  );
}

type UnregisteredAssetsSectionProps = {
  assets: LocalRuntimeUnregisteredAssetDescriptor[];
  assetImportError: string;
  assetImportSessionByPath: Record<string, string>;
  importingAssetPath: string | null;
  resolveDraft: (asset: LocalRuntimeUnregisteredAssetDescriptor) => LocalRuntimeAssetDeclaration;
  onRefresh: () => void;
  onAssetClassChange: (path: string, assetClass: AssetClassOption) => void;
  onModelTypeChange: (path: string, modelType: ModelTypeOption) => void;
  onArtifactKindChange: (path: string, kind: LocalRuntimeArtifactKind) => void;
  onAuxiliaryEngineChange: (path: string, engine: AssetEngineOption | '') => void;
  onImport: (path: string) => void;
};

export function LocalModelCenterUnregisteredAssetsSection(props: UnregisteredAssetsSectionProps) {
  if (props.assets.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]">
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
            <p className="text-xs text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.unregisteredAssetsDescription', {
                defaultValue: 'Typed folders import automatically. Unknown files stay here until you confirm the type.',
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
            {i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
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
          const importing = props.importingAssetPath === asset.path || Boolean(props.assetImportSessionByPath[asset.path]);
          const requiresEngine = draft.assetClass === 'artifact' && draft.artifactKind === 'auxiliary';
          const canImport = draft.assetClass === 'model'
            ? Boolean(draft.modelType)
            : Boolean(draft.artifactKind) && (!requiresEngine || Boolean(String(draft.engine || '').trim()));
          const confidenceClass = asset.confidence === 'high'
            ? 'bg-[color-mix(in_srgb,var(--nimi-status-success)_14%,transparent)] text-[var(--nimi-status-success)]'
            : 'bg-[color-mix(in_srgb,var(--nimi-status-warning)_14%,transparent)] text-[var(--nimi-status-warning)]';
          const sourceLabel = asset.suggestionSource === 'folder'
            ? i18n.t('runtimeConfig.localModelCenter.sourceFolder', { defaultValue: 'Folder' })
            : asset.suggestionSource === 'filename'
              ? i18n.t('runtimeConfig.localModelCenter.sourceFilename', { defaultValue: 'Filename' })
              : asset.suggestionSource === 'manifest'
                ? i18n.t('runtimeConfig.localModelCenter.sourceManifest', { defaultValue: 'Manifest' })
                : i18n.t('runtimeConfig.localModelCenter.sourceUnknown', { defaultValue: 'Unknown' });

          return (
            <div key={asset.path} className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] p-4 transition-colors hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_24%,transparent)]">
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)] text-[var(--nimi-action-primary-bg)]">
                  <FolderOpenIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-[var(--nimi-text-primary)]">{asset.filename}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${confidenceClass}`}>
                      {asset.confidence === 'high'
                        ? i18n.t('runtimeConfig.localModelCenter.highConfidence', { defaultValue: 'High confidence' })
                        : i18n.t('runtimeConfig.localModelCenter.reviewNeeded', { defaultValue: 'Review needed' })}
                    </span>
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--nimi-text-muted)]">
                    <span>{formatBytes(asset.sizeBytes)}</span>
                    <span className="text-[var(--nimi-border-subtle)]">&middot;</span>
                    <span>{sourceLabel}</span>
                    {asset.folderName ? (
                      <>
                        <span className="text-[var(--nimi-border-subtle)]">&middot;</span>
                        <span>{asset.folderName}</span>
                      </>
                    ) : null}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[color-mix(in_srgb,var(--nimi-border-subtle)_50%,transparent)] pt-3">
                <RuntimeSelect
                  value={draft.assetClass}
                  onChange={(value) => props.onAssetClassChange(asset.path, (value || 'model') as AssetClassOption)}
                  className="w-36"
                  options={ASSET_CLASS_OPTIONS.map((assetClass) => ({
                    value: assetClass,
                    label: assetClass === 'model'
                      ? i18n.t('runtimeConfig.localModelCenter.mainModel', { defaultValue: 'Main model' })
                      : i18n.t('runtimeConfig.localModelCenter.companionAsset', { defaultValue: 'Companion asset' }),
                  }))}
                />
                {draft.assetClass === 'model' ? (
                  <RuntimeSelect
                    value={draft.modelType || 'chat'}
                    onChange={(value) => props.onModelTypeChange(asset.path, (value || 'chat') as ModelTypeOption)}
                    className="w-36"
                    options={MODEL_TYPE_OPTIONS.map((modelType) => ({ value: modelType, label: modelType }))}
                  />
                ) : (
                  <RuntimeSelect
                    value={draft.artifactKind || 'vae'}
                    onChange={(value) => props.onArtifactKindChange(asset.path, (value || 'vae') as LocalRuntimeArtifactKind)}
                    className="w-36"
                    options={ARTIFACT_KIND_OPTIONS.map((kind) => ({ value: kind, label: formatArtifactKindLabel(kind) }))}
                  />
                )}
                {requiresEngine ? (
                  <RuntimeSelect
                    value={String(draft.engine || '')}
                    onChange={(value) => props.onAuxiliaryEngineChange(asset.path, (value || '') as AssetEngineOption | '')}
                    className="w-36"
                    placeholder={i18n.t('runtimeConfig.localModelCenter.selectEngine', { defaultValue: 'Select engine' })}
                    options={ASSET_ENGINE_OPTIONS.map((engine) => ({ value: engine, label: engine }))}
                  />
                ) : null}
                <button
                  type="button"
                  onClick={() => props.onImport(asset.path)}
                  disabled={!canImport || importing}
                  className="ml-auto flex items-center gap-1.5 rounded-lg bg-[var(--nimi-action-primary-bg)] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:opacity-50"
                >
                  <DownloadIcon className="h-3.5 w-3.5" />
                  {importing
                    ? i18n.t('runtimeConfig.localModelCenter.importing', { defaultValue: 'Importing...' })
                    : i18n.t('runtimeConfig.localModelCenter.import', { defaultValue: 'Import' })}
                </button>
              </div>
              <p className="mt-2 truncate text-[11px] text-[color-mix(in_srgb,var(--nimi-text-muted)_60%,transparent)]">{asset.path}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { SearchIcon };
