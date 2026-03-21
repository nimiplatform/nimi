import type { RefObject } from 'react';
import { i18n } from '@renderer/i18n';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
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
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="flex h-14 shrink-0 items-center border-b border-gray-200 bg-white px-6">
        <h2 className="text-lg font-semibold text-gray-900">
          {i18n.t('runtimeConfig.localModelCenter.localModels', { defaultValue: 'Local Models' })}
        </h2>
      </div>
    <ScrollShell className="flex-1" contentClassName="space-y-6 p-6">
          <div className="space-y-4 rounded-2xl bg-white p-6 shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04]">
            <div>
              <h4 className="text-sm font-semibold text-gray-900">
                {selectedProfileTarget?.modName
                  || props.selectedProfileModId
                  || i18n.t('runtimeConfig.localModelCenter.runtimeMod', { defaultValue: 'Runtime Mod' })}
              </h4>
              <p className="text-xs text-gray-500">
                {i18n.t('runtimeConfig.localModelCenter.modProfilesDescription', {
                  defaultValue: 'Configure only this mod&apos;s declared local AI profiles.',
                })}
              </p>
            </div>
            {modCapabilities.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-700">
                  {i18n.t('runtimeConfig.localModelCenter.aiCapabilityStatus', { defaultValue: 'AI Capability Status' })}
                </p>
                <div className="flex flex-wrap gap-2">
                  {capabilityStatuses.map((item) => (
                    <span key={`mod-cap-status-${item.capability}`} className={`rounded-full px-3 py-1 text-[11px] font-medium ${item.localAvailable ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
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
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <p className="text-xs font-semibold text-amber-900">
                {i18n.t('runtimeConfig.localModelCenter.setupRequired', { defaultValue: 'Setup Required' })}
              </p>
              <p className="mt-1 text-[11px] text-amber-800">
                {i18n.t('runtimeConfig.localModelCenter.setupRequiredDescription', {
                  defaultValue: 'Some capabilities are not available locally. Install a local model or configure a cloud API connector to enable them.',
                })}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={() => props.onNavigateToSetup?.('local')} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100">
                  {i18n.t('runtimeConfig.localModelCenter.installModels', { defaultValue: 'Install Models' })}
                </button>
                <button type="button" onClick={() => props.onNavigateToSetup?.('cloud')} className="px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100">
                  {i18n.t('runtimeConfig.localModelCenter.configureCloudApi', { defaultValue: 'Configure Cloud API' })}
                </button>
              </div>
            </div>
          ) : null}
      </ScrollShell>
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

  return (
    <div className="flex items-center justify-between">
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={props.onHealthCheck}
          disabled={props.checkingHealth}
          title={healthTooltip}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
            props.localHealthy
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <HeartPulseIcon className="h-4 w-4" />
          {props.checkingHealth
            ? i18n.t('runtimeConfig.localModelCenter.checking', { defaultValue: 'Checking...' })
            : i18n.t('runtimeConfig.localModelCenter.health', { defaultValue: 'Health' })}
        </button>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.discovering}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshIcon className="h-4 w-4" />
          {props.discovering
            ? i18n.t('runtimeConfig.localModelCenter.refreshing', { defaultValue: 'Refreshing...' })
            : i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
        </button>
        <button
          type="button"
          onClick={props.onOpenModelsFolder}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          <FolderOpenIcon className="h-4 w-4" />
          {i18n.t('runtimeConfig.localModelCenter.openModelsFolder', { defaultValue: 'Open Folder' })}
        </button>
        <div className="relative" ref={props.importMenuRef}>
          <button
            type="button"
            onClick={props.onToggleImportMenu}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            <FolderOpenIcon className="h-4 w-4" />
            {i18n.t('runtimeConfig.localModelCenter.import', { defaultValue: 'Import' })}
          </button>
          {props.showImportMenu ? (
            <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border border-gray-200 bg-white shadow-lg">
              <button type="button" onClick={props.onOpenImportFile} className="w-full rounded-t-lg px-3 py-2.5 text-left text-xs hover:bg-gray-50">
                <div className="font-medium text-gray-900">
                  {i18n.t('runtimeConfig.localModelCenter.importAssetFile', { defaultValue: 'Import Asset File' })}
                </div>
                <div className="mt-0.5 text-gray-500">
                  {i18n.t('runtimeConfig.localModelCenter.supportedAssetFileTypes', {
                    defaultValue: '.gguf, .safetensors, .bin, .onnx',
                  })}
                </div>
              </button>
              <button type="button" onClick={props.onImportManifest} className="w-full rounded-b-lg border-t border-gray-100 px-3 py-2.5 text-left text-xs hover:bg-gray-50">
                <div className="font-medium text-gray-900">
                  {i18n.t('runtimeConfig.localModelCenter.importRuntimeManifest', { defaultValue: 'Import Runtime Manifest' })}
                </div>
                <div className="mt-0.5 text-gray-500">
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
    <div className="rounded-2xl bg-white p-4 shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04]">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpenIcon className="h-4 w-4 text-mint-600" />
          <h3 className="text-sm font-semibold text-gray-900">
            {i18n.t('runtimeConfig.localModelCenter.importLocalAssetFile', { defaultValue: 'Import Local Asset File' })}
          </h3>
        </div>
        <button type="button" onClick={props.onClose} className="text-xs text-gray-400 hover:text-gray-600">
          {i18n.t('Common.cancel', { defaultValue: 'Cancel' })}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">
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
            <span className="text-xs text-gray-500">
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
            <span className="text-xs text-gray-500">
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
            <span className="text-xs text-gray-500">
              {i18n.t('runtimeConfig.localModelCenter.engineLabel', { defaultValue: 'Engine:' })}
            </span>
            <RuntimeSelect
              value={props.auxiliaryEngine}
              onChange={(value) => props.onAuxiliaryEngineChange((value || '') as AssetEngineOption | '')}
              className="w-32"
              options={[
                {
                  value: '',
                  label: i18n.t('runtimeConfig.localModelCenter.selectEngine', { defaultValue: 'Select engine' }),
                },
                ...ASSET_ENGINE_OPTIONS.map((engine) => ({ value: engine, label: engine })),
              ]}
            />
          </div>
        ) : null}
        <button
          type="button"
          onClick={props.onChooseFile}
          disabled={props.canChooseFile === false}
          className="flex items-center gap-1.5 rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-mint-600 disabled:opacity-50"
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
    <div className="rounded-2xl bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04]">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {i18n.t('runtimeConfig.localModelCenter.unregisteredAssets', {
              count: props.assets.length,
              defaultValue: 'Unregistered Assets ({{count}})',
            })}
          </h3>
          <p className="text-xs text-gray-500">
            {i18n.t('runtimeConfig.localModelCenter.unregisteredAssetsDescription', {
              defaultValue: 'Typed folders import automatically. Unknown files stay here until you confirm the type.',
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={props.onRefresh}
          className="flex items-center gap-1.5 rounded border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          <RefreshIcon className="h-3 w-3" />
          {i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
        </button>
      </div>
      {props.assetImportError ? (
        <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600">
          {props.assetImportError}
        </div>
      ) : null}
      <div className="divide-y divide-gray-100">
        {props.assets.map((asset) => {
          const draft = props.resolveDraft(asset);
          const importing = props.importingAssetPath === asset.path || Boolean(props.assetImportSessionByPath[asset.path]);
          const requiresEngine = draft.assetClass === 'artifact' && draft.artifactKind === 'auxiliary';
          const canImport = draft.assetClass === 'model'
            ? Boolean(draft.modelType)
            : Boolean(draft.artifactKind) && (!requiresEngine || Boolean(String(draft.engine || '').trim()));
          const confidenceClass = asset.confidence === 'high'
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-amber-100 text-amber-700';
          const sourceLabel = asset.suggestionSource === 'folder'
            ? i18n.t('runtimeConfig.localModelCenter.sourceFolder', { defaultValue: 'Folder' })
            : asset.suggestionSource === 'filename'
              ? i18n.t('runtimeConfig.localModelCenter.sourceFilename', { defaultValue: 'Filename' })
              : asset.suggestionSource === 'manifest'
                ? i18n.t('runtimeConfig.localModelCenter.sourceManifest', { defaultValue: 'Manifest' })
                : i18n.t('runtimeConfig.localModelCenter.sourceUnknown', { defaultValue: 'Unknown' });

          return (
            <div key={asset.path} className="px-4 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <FolderOpenIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-gray-900">{asset.filename}</p>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${confidenceClass}`}>
                      {asset.confidence === 'high'
                        ? i18n.t('runtimeConfig.localModelCenter.highConfidence', { defaultValue: 'High confidence' })
                        : i18n.t('runtimeConfig.localModelCenter.reviewNeeded', { defaultValue: 'Review needed' })}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                      {sourceLabel}
                    </span>
                    {asset.folderName ? (
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">
                        {asset.folderName}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-gray-500">{asset.path}</p>
                  <p className="mt-1 text-[11px] text-gray-400">{formatBytes(asset.sizeBytes)}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
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
                        options={[
                          {
                            value: '',
                            label: i18n.t('runtimeConfig.localModelCenter.selectEngine', { defaultValue: 'Select engine' }),
                          },
                          ...ASSET_ENGINE_OPTIONS.map((engine) => ({ value: engine, label: engine })),
                        ]}
                      />
                    ) : null}
                    <button
                      type="button"
                      onClick={() => props.onImport(asset.path)}
                      disabled={!canImport || importing}
                      className="flex items-center gap-1.5 rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-mint-600 disabled:opacity-50"
                    >
                      <DownloadIcon className="h-3.5 w-3.5" />
                      {importing
                        ? i18n.t('runtimeConfig.localModelCenter.importing', { defaultValue: 'Importing...' })
                        : i18n.t('runtimeConfig.localModelCenter.import', { defaultValue: 'Import' })}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { SearchIcon };
