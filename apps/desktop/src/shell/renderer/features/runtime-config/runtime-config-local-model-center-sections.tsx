import type { RefObject } from 'react';
import { i18n } from '@renderer/i18n';
import { ScrollArea } from '@nimiplatform/nimi-kit/ui';
import type {
  LocalRuntimeAssetDeclaration,
  LocalRuntimeAssetKind,
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
  ASSET_ENGINE_OPTIONS,
  formatBytes,
  resolveSelectedRuntimeProfileTarget,
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
      <div className="flex h-14 shrink-0 items-center border-b border-[var(--nimi-border-subtle)] bg-white px-6">
        <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">
          {i18n.t('runtimeConfig.localModelCenter.localModels', { defaultValue: 'Local Models' })}
        </h2>
      </div>
    <ScrollArea className="flex-1" contentClassName="space-y-6 p-6">
          <div className="space-y-4 rounded-2xl border border-[var(--nimi-border-subtle)]/70 bg-white/95 p-6 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
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
                  defaultValue: 'Some capabilities are not available locally. Install a local asset or configure a cloud API connector to enable them.',
                })}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button type="button" onClick={() => props.onNavigateToSetup?.('local')} className="rounded-lg border border-[color-mix(in_srgb,var(--nimi-status-warning)_34%,transparent)] bg-white px-3 py-1.5 text-xs font-medium text-[var(--nimi-status-warning)] hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)]">
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
  onOpenImportBundle: () => void;
  onImportManifest: () => void;
};

export function LocalModelCenterToolbar(props: ToolbarProps) {
  const healthTooltip = formatLastCheckedAgo(props.lastCheckedAt);
  const ghostBtnClass = 'flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-[var(--nimi-text-secondary)] hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_8%,transparent)] disabled:opacity-50 transition-colors';

  return (
    <div className="flex items-center justify-end">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={props.onHealthCheck}
          disabled={props.checkingHealth}
          title={healthTooltip}
          className={`${ghostBtnClass} ${
            props.localHealthy
              ? 'text-[var(--nimi-status-success)]'
              : ''
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
            <div className="absolute right-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-xl border border-[var(--nimi-border-subtle)] bg-white shadow-lg">
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
                  {i18n.t('runtimeConfig.localModelCenter.importAssetBundle', { defaultValue: 'Import Asset Bundle Folder' })}
                </div>
                <div className="mt-0.5 text-[var(--nimi-text-muted)]">
                  {i18n.t('runtimeConfig.localModelCenter.supportedAssetBundleFolder', {
                    defaultValue: 'Bundle directory with model.gguf and optional mmproj files',
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
    </div>
  );
}

type ImportDialogProps = {
  visible: boolean;
  assetKind: LocalRuntimeAssetKind;
  auxiliaryEngine: AssetEngineOption | '';
  endpoint: string;
  endpointRequired: boolean;
  compatibilityHint?: string;
  endpointHint?: string;
  onAssetKindChange: (kind: LocalRuntimeAssetKind) => void;
  onAuxiliaryEngineChange: (engine: AssetEngineOption | '') => void;
  onEndpointChange: (endpoint: string) => void;
  onClose: () => void;
  onChooseFile: () => void;
  onChooseFolder: () => void;
  canChooseFile?: boolean;
  canChooseFolder?: boolean;
};

export function LocalModelCenterImportDialog(props: ImportDialogProps) {
  if (!props.visible) {
    return null;
  }
  const showEndpointField = props.endpointRequired
    || Boolean(String(props.endpoint || '').trim())
    || Boolean(String(props.endpointHint || '').trim());

  return (
    <div className="rounded-2xl border border-[var(--nimi-border-subtle)]/70 bg-white/95 p-5 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
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
            onChange={(value) => props.onAssetKindChange((value || 'chat') as LocalRuntimeAssetKind)}
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
        {showEndpointField ? (
          <div className="flex min-w-[20rem] flex-1 items-center gap-2">
            <span className="text-xs text-[var(--nimi-text-muted)]">
              {i18n.t('runtimeConfig.localModelCenter.endpointLabel', { defaultValue: 'Endpoint:' })}
            </span>
            <input
              type="text"
              value={props.endpoint}
              onChange={(event) => props.onEndpointChange(event.target.value)}
              placeholder={props.endpointRequired
                ? i18n.t('runtimeConfig.localModelCenter.endpointRequiredPlaceholder', { defaultValue: 'Required attached endpoint' })
                : i18n.t('runtimeConfig.localModelCenter.endpointOptionalPlaceholder', { defaultValue: 'Optional attached endpoint' })}
              className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--nimi-border-subtle)] bg-white px-3 text-xs text-[var(--nimi-text-primary)] outline-none transition-all placeholder:text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)] focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-mint-100"
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
      {(props.endpointRequired || String(props.endpointHint || '').trim()) ? (
        <p className="mt-3 text-[11px] text-[var(--nimi-text-muted)]">
          {props.endpointRequired
            ? i18n.t('runtimeConfig.localModelCenter.endpointRequiredHint', {
                defaultValue: 'This asset must bind to an external attached endpoint on the current host.',
              })
            : null}
          {props.endpointRequired && String(props.endpointHint || '').trim() ? ' ' : ''}
          {String(props.endpointHint || '').trim()}
        </p>
      ) : null}
      {String(props.compatibilityHint || '').trim() ? (
        <p className="mt-2 text-[11px] text-[var(--nimi-status-danger)]">
          {String(props.compatibilityHint || '').trim()}
        </p>
      ) : null}
      {props.canChooseFolder === false ? (
        <p className="mt-2 text-[11px] text-[var(--nimi-text-muted)]">
          {i18n.t('runtimeConfig.localModelCenter.bundleImportChatOnlyHint', {
            defaultValue: 'Bundle folder import currently targets chat model bundles.',
          })}
        </p>
      ) : null}
    </div>
  );
}

type UnregisteredAssetsSectionProps = {
  assets: LocalRuntimeUnregisteredAssetDescriptor[];
  assetImportError: string;
  assetImportSessionByPath: Record<string, string>;
  compatibilityHintByPath: Record<string, string>;
  importAllowedByPath: Record<string, boolean>;
  importingAssetPath: string | null;
  resolveDraft: (asset: LocalRuntimeUnregisteredAssetDescriptor) => LocalRuntimeAssetDeclaration;
  endpointByPath: Record<string, string>;
  endpointRequiredByPath: Record<string, boolean>;
  endpointHintByPath: Record<string, string>;
  onRefresh: () => void;
  onAssetKindChange: (path: string, kind: LocalRuntimeAssetKind) => void;
  onAuxiliaryEngineChange: (path: string, engine: AssetEngineOption | '') => void;
  onEndpointChange: (path: string, endpoint: string) => void;
  onImport: (path: string) => void;
};

export function LocalModelCenterUnregisteredAssetsSection(props: UnregisteredAssetsSectionProps) {
  if (props.assets.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-[var(--nimi-border-subtle)]/70 bg-white/95 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
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
          const requiresEngine = draft.assetKind === 'auxiliary';
          const endpointRequired = Boolean(props.endpointRequiredByPath[asset.path]);
          const endpointValue = String(props.endpointByPath[asset.path] || '').trim();
          const endpointHint = String(props.endpointHintByPath[asset.path] || '').trim();
          const compatibilityHint = String(props.compatibilityHintByPath[asset.path] || '').trim();
          const showEndpointField = endpointRequired || Boolean(endpointValue) || Boolean(endpointHint);
          const canImport = Boolean(draft.assetKind)
            && (!requiresEngine || Boolean(String(draft.engine || '').trim()))
            && (!endpointRequired || Boolean(endpointValue))
            && !compatibilityHint
            && props.importAllowedByPath[asset.path] !== false;
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
            <div key={asset.path} className="rounded-xl border border-[var(--nimi-border-subtle)]/70 bg-white p-4 shadow-[0_2px_8px_rgba(15,23,42,0.03)] transition-all hover:border-[var(--nimi-border-strong)] hover:shadow-[0_6px_18px_rgba(15,23,42,0.06)]">
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
                  value={draft.assetKind || 'chat'}
                  onChange={(value) => props.onAssetKindChange(asset.path, (value || 'chat') as LocalRuntimeAssetKind)}
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
                {showEndpointField ? (
                  <input
                    type="text"
                    value={props.endpointByPath[asset.path] || ''}
                    onChange={(event) => props.onEndpointChange(asset.path, event.target.value)}
                    placeholder={endpointRequired
                      ? i18n.t('runtimeConfig.localModelCenter.endpointRequiredPlaceholder', { defaultValue: 'Required attached endpoint' })
                      : i18n.t('runtimeConfig.localModelCenter.endpointOptionalPlaceholder', { defaultValue: 'Optional attached endpoint' })}
                    className="h-9 min-w-[16rem] flex-1 rounded-lg border border-[var(--nimi-border-subtle)] bg-white px-3 text-xs text-[var(--nimi-text-primary)] outline-none transition-all placeholder:text-[color-mix(in_srgb,var(--nimi-text-muted)_80%,transparent)] focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-mint-100"
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
              {(endpointRequired || endpointHint) ? (
                <p className="mt-2 text-[11px] text-[var(--nimi-text-muted)]">
                  {endpointRequired
                    ? i18n.t('runtimeConfig.localModelCenter.endpointRequiredHint', {
                        defaultValue: 'This asset must bind to an external attached endpoint on the current host.',
                      })
                    : null}
                  {endpointRequired && endpointHint ? ' ' : ''}
                  {endpointHint}
                </p>
              ) : null}
              {compatibilityHint ? (
                <p className="mt-2 text-[11px] text-[var(--nimi-status-danger)]">
                  {compatibilityHint}
                </p>
              ) : null}
              <p className="mt-2 truncate text-[11px] text-[color-mix(in_srgb,var(--nimi-text-muted)_60%,transparent)]">{asset.path}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { SearchIcon };
