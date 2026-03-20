import type { RefObject } from 'react';
import { i18n } from '@renderer/i18n';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import type {
  LocalRuntimeAssetDeclaration,
  LocalRuntimeArtifactKind,
  LocalRuntimeArtifactRecord,
  LocalRuntimeDownloadProgressEvent,
  LocalRuntimeProfileApplyResult,
  LocalRuntimeProfileResolutionPlan,
  LocalRuntimeUnregisteredAssetDescriptor,
  LocalRuntimeVerifiedArtifactDescriptor,
  LocalRuntimeVerifiedModelDescriptor,
} from '@runtime/local-runtime';
import { toCanonicalLocalLookupKey } from '@runtime/local-runtime/local-id';
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
  downloadStateLabel,
  formatBytes,
  formatDownloadPhaseLabel,
  formatEta,
  formatSpeed,
  resolveSelectedRuntimeProfileTarget,
  type AssetClassOption,
  type AssetEngineOption,
  type ModelTypeOption,
} from './runtime-config-model-center-utils';
import {
  ARTIFACT_KIND_OPTIONS,
  artifactTaskStatusLabel,
  DownloadIcon,
  FolderOpenIcon,
  formatArtifactKindLabel,
  HeartPulseIcon,
  isRecommendedDescriptor,
  type ArtifactTaskEntry,
  RefreshIcon,
  StarIcon,
  SearchIcon,
  formatLastCheckedAgo,
} from './runtime-config-local-model-center-helpers';

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

type ArtifactRequirementBadgesProps = {
  modelTemplateId: string;
  relatedArtifacts: LocalRuntimeVerifiedArtifactDescriptor[];
  installedArtifactsById: Map<string, LocalRuntimeArtifactRecord>;
  artifactBusy: boolean;
  isArtifactPending: (templateId: string) => boolean;
  onInstallMissingArtifacts: (artifacts: LocalRuntimeVerifiedArtifactDescriptor[]) => void;
  onInstallArtifact: (templateId: string) => void;
};

function ArtifactRequirementBadges(props: ArtifactRequirementBadgesProps) {
  if (props.relatedArtifacts.length === 0) {
    return null;
  }

  const missingArtifacts = props.relatedArtifacts.filter((artifact) => (
    !props.installedArtifactsById.has(toCanonicalLocalLookupKey(artifact.artifactId))
  ));
  const hasPendingMissingArtifacts = missingArtifacts.some((artifact) => props.isArtifactPending(artifact.templateId));

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      {missingArtifacts.length > 1 ? (
        <button
          type="button"
          onClick={() => props.onInstallMissingArtifacts(props.relatedArtifacts)}
          disabled={props.artifactBusy || hasPendingMissingArtifacts}
          className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
        >
          {hasPendingMissingArtifacts
            ? i18n.t('runtimeConfig.localModelCenter.installingAssets', { defaultValue: 'Installing assets...' })
            : i18n.t('runtimeConfig.localModelCenter.installMissing', {
              count: missingArtifacts.length,
              defaultValue: 'Install Missing ({{count}})',
            })}
        </button>
      ) : null}
      {props.relatedArtifacts.map((artifact) => {
        const installed = props.installedArtifactsById.get(toCanonicalLocalLookupKey(artifact.artifactId)) || null;
        const pending = props.isArtifactPending(artifact.templateId);
        return (
          <div
            key={`${props.modelTemplateId}-${artifact.templateId}`}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
              installed
                ? 'border-green-200 bg-green-50 text-green-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}
          >
            <span>{formatArtifactKindLabel(artifact.kind)}</span>
            <span>
              {installed
                ? i18n.t('runtimeConfig.localModelCenter.installed', { defaultValue: 'Installed' })
                : pending
                  ? i18n.t('runtimeConfig.localModelCenter.installingShort', { defaultValue: 'Installing' })
                  : i18n.t('runtimeConfig.localModelCenter.required', { defaultValue: 'Required' })}
            </span>
            {!installed ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onInstallArtifact(artifact.templateId);
                }}
                disabled={props.artifactBusy || pending}
                className="rounded-full bg-white/80 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-white disabled:opacity-50"
              >
                {pending
                  ? i18n.t('runtimeConfig.localModelCenter.installing', { defaultValue: 'Installing...' })
                  : i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

type VerifiedArtifactsSectionProps = {
  hasSearchQuery: boolean;
  loadingVerifiedArtifacts: boolean;
  artifactBusy: boolean;
  visibleVerifiedArtifacts: LocalRuntimeVerifiedArtifactDescriptor[];
  isArtifactPending: (templateId: string) => boolean;
  onRefresh: () => void;
  onInstallArtifact: (templateId: string) => void;
};

export function LocalModelCenterVerifiedArtifactsSection(props: VerifiedArtifactsSectionProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FolderOpenIcon className="h-4 w-4 text-slate-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            {i18n.t('runtimeConfig.localModelCenter.verifiedCompanionAssets', { defaultValue: 'Verified Companion Assets' })}
          </span>
        </div>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.loadingVerifiedArtifacts || props.artifactBusy}
          className="flex items-center gap-1.5 rounded border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshIcon className="h-3 w-3" />
          {i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
        </button>
      </div>
      {props.loadingVerifiedArtifacts ? (
        <div className="py-6 text-center">
          <p className="text-sm text-gray-500">
            {i18n.t('runtimeConfig.localModelCenter.loadingVerifiedArtifacts', { defaultValue: 'Loading verified artifacts...' })}
          </p>
        </div>
      ) : props.visibleVerifiedArtifacts.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {props.visibleVerifiedArtifacts.slice(0, props.hasSearchQuery ? 12 : 6).map((artifact) => {
            const pending = props.isArtifactPending(artifact.templateId);
            return (
              <div key={artifact.templateId} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3 transition-colors hover:border-mint-200 hover:bg-mint-50/30">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-slate-500 to-slate-700 text-[11px] font-semibold text-white">
                  {formatArtifactKindLabel(artifact.kind).slice(0, 3).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-gray-900">{artifact.title}</p>
                    {isRecommendedDescriptor(artifact.tags) ? (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                        {i18n.t('runtimeConfig.localModelCenter.recommended', { defaultValue: 'Recommended' })}
                      </span>
                    ) : null}
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                      {formatArtifactKindLabel(artifact.kind)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-gray-500">{artifact.artifactId}</p>
                  {artifact.description ? <p className="mt-0.5 truncate text-[11px] text-gray-400">{artifact.description}</p> : null}
                </div>
                <button
                  type="button"
                  onClick={() => props.onInstallArtifact(artifact.templateId)}
                  disabled={props.artifactBusy || pending}
                  className="flex items-center gap-1.5 rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-mint-600 disabled:opacity-50"
                >
                  <DownloadIcon className="h-3.5 w-3.5" />
                  {pending
                    ? i18n.t('runtimeConfig.localModelCenter.installing', { defaultValue: 'Installing...' })
                    : i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-6 text-center">
          <p className="text-sm text-gray-500">
            {props.hasSearchQuery
              ? i18n.t('runtimeConfig.localModelCenter.noVerifiedAssetsMatchSearch', { defaultValue: 'No verified companion assets matched your search.' })
              : i18n.t('runtimeConfig.localModelCenter.noVerifiedAssetsForFilter', { defaultValue: 'No verified companion assets available for the current filter.' })}
          </p>
        </div>
      )}
    </div>
  );
}

type ActiveDownloadsSectionProps = {
  downloads: LocalRuntimeDownloadProgressEvent[];
  onPause: (installSessionId: string) => void;
  onResume: (installSessionId: string) => void;
  onCancel: (installSessionId: string) => void;
};

export function LocalModelCenterActiveDownloadsSection(props: ActiveDownloadsSectionProps) {
  if (props.downloads.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        {i18n.t('runtimeConfig.localModelCenter.activeDownloads', {
          count: props.downloads.length,
          defaultValue: 'Active Downloads ({{count}})',
        })}
      </h3>
      {props.downloads.map((event) => {
        const isRunning = event.state === 'running';
        const isPaused = event.state === 'paused';
        const isFailed = event.state === 'failed';
        const canPause = event.state === 'queued' || isRunning;
        const canResume = isPaused || (isFailed && event.retryable);
        const canCancel = event.state !== 'completed' && event.state !== 'cancelled';
        const phaseLabel = formatDownloadPhaseLabel(event.phase);
        const progressMeta = event.phase === 'verify'
          ? (event.speedBytesPerSec && event.speedBytesPerSec > 0
              ? i18n.t('runtimeConfig.localModelCenter.verifyProgressWithEta', {
                speed: formatSpeed(event.speedBytesPerSec),
                eta: formatEta(event.etaSeconds),
                defaultValue: '{{speed}} verify · ETA {{eta}}',
              })
              : i18n.t('runtimeConfig.localModelCenter.verifyingLocalFile', { defaultValue: 'Verifying local file...' }))
          : event.phase === 'upsert'
            ? i18n.t('runtimeConfig.localModelCenter.finalizingInstallation', { defaultValue: 'Finalizing installation...' })
            : event.speedBytesPerSec && event.speedBytesPerSec > 0
              ? i18n.t('runtimeConfig.localModelCenter.downloadProgressWithEta', {
                speed: formatSpeed(event.speedBytesPerSec),
                eta: formatEta(event.etaSeconds),
                defaultValue: '{{speed}} · ETA {{eta}}',
              })
              : i18n.t('runtimeConfig.localModelCenter.measuringThroughput', { defaultValue: 'Measuring throughput...' });

        return (
          <div key={event.installSessionId} className="rounded-2xl bg-white p-4 shadow-[0_4px_14px_rgba(15,23,42,0.035)] ring-1 ring-black/[0.04]">
            <div className="mb-2 flex items-center gap-3">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${isFailed ? 'bg-red-100 text-red-600' : 'bg-mint-100 text-mint-600'}`}>
                <DownloadIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{event.modelId}</p>
                <p className="text-xs text-gray-500">{phaseLabel}</p>
                {event.phase !== 'download' && event.message ? <p className="truncate text-[11px] text-gray-400">{event.message}</p> : null}
              </div>
              <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                isFailed ? 'bg-red-100 text-red-700' :
                isPaused ? 'bg-amber-100 text-amber-700' :
                isRunning ? 'bg-blue-100 text-blue-700' :
                'bg-gray-100 text-gray-600'
              }`}>
                {downloadStateLabel(event.state)}
              </span>
            </div>
            {typeof event.bytesTotal === 'number' && event.bytesTotal > 0 ? (
              <div className="mb-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full transition-all ${isFailed ? 'bg-red-500' : 'bg-mint-500'}`}
                    style={{ width: `${Math.max(0, Math.min(100, Math.round((event.bytesReceived / event.bytesTotal) * 100)))}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-gray-500">
                  <span>{formatBytes(event.bytesReceived)} / {formatBytes(event.bytesTotal)}</span>
                  {isRunning ? <span>{progressMeta}</span> : null}
                </div>
              </div>
            ) : (
              <p className="mb-2 text-xs text-gray-500">
                {i18n.t('runtimeConfig.localModelCenter.downloadedBytes', {
                  value: formatBytes(event.bytesReceived),
                  defaultValue: '{{value}} downloaded',
                })}
              </p>
            )}
            <div className="flex items-center gap-2">
              {canPause ? <button type="button" onClick={() => props.onPause(event.installSessionId)} className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">{i18n.t('runtimeConfig.localModelCenter.pause', { defaultValue: 'Pause' })}</button> : null}
              {canResume ? <button type="button" onClick={() => props.onResume(event.installSessionId)} className="rounded bg-mint-500 px-2 py-1 text-xs text-white hover:bg-mint-600">{i18n.t('runtimeConfig.localModelCenter.resume', { defaultValue: 'Resume' })}</button> : null}
              {canCancel ? <button type="button" onClick={() => props.onCancel(event.installSessionId)} className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:border-red-200 hover:text-red-600">{i18n.t('Common.cancel', { defaultValue: 'Cancel' })}</button> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type ArtifactTasksSectionProps = {
  tasks: ArtifactTaskEntry[];
  pendingTemplateIds: string[];
  onRetryTask: (templateId: string) => void;
};

export function LocalModelCenterArtifactTasksSection(props: ArtifactTasksSectionProps) {
  if (props.tasks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
        {i18n.t('runtimeConfig.localModelCenter.assetTasks', {
          count: props.tasks.length,
          defaultValue: 'Asset Tasks ({{count}})',
        })}
      </h3>
      <div className="grid grid-cols-1 gap-3">
        {props.tasks.map((task) => {
          const isRunning = task.state === 'running';
          const isFailed = task.state === 'failed';
          const pendingRetry = props.pendingTemplateIds.includes(task.templateId);
          return (
            <div key={`artifact-task-${task.templateId}`} className="rounded-2xl bg-white p-4 shadow-[0_4px_14px_rgba(15,23,42,0.035)] ring-1 ring-black/[0.04]">
              <div className="flex items-center gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                  isFailed ? 'bg-red-100 text-red-600' : isRunning ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                }`}>
                  <FolderOpenIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-gray-900">{task.title}</p>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                      {formatArtifactKindLabel(task.kind)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-gray-500">{task.artifactId}</p>
                  {task.detail ? <p className={`mt-0.5 truncate text-[11px] ${isFailed ? 'text-red-500' : 'text-gray-400'}`}>{task.detail}</p> : null}
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${
                  isFailed ? 'bg-red-100 text-red-700' : isRunning ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'
                }`}>
                  {artifactTaskStatusLabel(task.state)}
                </span>
              </div>
              {isFailed && task.taskKind === 'verified-install' ? (
                <div className="mt-3 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={() => props.onRetryTask(task.templateId)}
                    disabled={pendingRetry}
                    className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {pendingRetry
                      ? i18n.t('runtimeConfig.localModelCenter.retrying', { defaultValue: 'Retrying...' })
                      : i18n.t('runtimeConfig.localModelCenter.retry', { defaultValue: 'Retry' })}
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type QuickPicksSectionProps = {
  loadingVerifiedModels: boolean;
  installing: boolean;
  artifactBusy: boolean;
  verifiedModels: LocalRuntimeVerifiedModelDescriptor[];
  relatedArtifactsByModelTemplate: Map<string, LocalRuntimeVerifiedArtifactDescriptor[]>;
  installedArtifactsById: Map<string, LocalRuntimeArtifactRecord>;
  isArtifactPending: (templateId: string) => boolean;
  onRefresh: () => void;
  onInstallVerifiedModel: (templateId: string) => void;
  onInstallArtifact: (templateId: string) => void;
  onInstallMissingArtifacts: (artifacts: LocalRuntimeVerifiedArtifactDescriptor[]) => void;
};

export function LocalModelCenterQuickPicksSection(props: QuickPicksSectionProps) {
  if (props.verifiedModels.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StarIcon className="h-4 w-4 text-amber-500" />
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            {i18n.t('runtimeConfig.localModelCenter.quickPicks', { defaultValue: 'Quick Picks' })}
          </span>
        </div>
        <button
          type="button"
          onClick={props.onRefresh}
          disabled={props.loadingVerifiedModels}
          className="flex items-center gap-1.5 rounded border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          <RefreshIcon className="h-3 w-3" />
          {i18n.t('runtimeConfig.localModelCenter.refresh', { defaultValue: 'Refresh' })}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {props.verifiedModels.map((item) => {
          const relatedArtifacts = props.relatedArtifactsByModelTemplate.get(item.templateId) || [];
          return (
            <div key={item.templateId} className="flex items-center gap-3 rounded-lg border border-gray-100 p-3 transition-colors hover:border-mint-200 hover:bg-mint-50/30">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                <StarIcon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-gray-900">{item.title}</p>
                  {isRecommendedDescriptor(item.tags) ? (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                      {i18n.t('runtimeConfig.localModelCenter.recommended', { defaultValue: 'Recommended' })}
                    </span>
                  ) : null}
                </div>
                <p className="truncate text-xs text-gray-500">{item.modelId}</p>
                <ArtifactRequirementBadges
                  modelTemplateId={`${item.templateId}-quick`}
                  relatedArtifacts={relatedArtifacts}
                  installedArtifactsById={props.installedArtifactsById}
                  artifactBusy={props.artifactBusy}
                  isArtifactPending={props.isArtifactPending}
                  onInstallMissingArtifacts={props.onInstallMissingArtifacts}
                  onInstallArtifact={props.onInstallArtifact}
                />
              </div>
              <button
                type="button"
                onClick={() => props.onInstallVerifiedModel(item.templateId)}
                disabled={props.installing}
                className="flex items-center gap-1.5 rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-mint-600 disabled:opacity-50"
              >
                <DownloadIcon className="h-3.5 w-3.5" />
                {i18n.t('runtimeConfig.localModelCenter.install', { defaultValue: 'Install' })}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { ArtifactRequirementBadges, SearchIcon };
