import type {
  GgufVariantDescriptor,
  LocalAiArtifactKind,
  LocalAiArtifactRecord,
  LocalAiCatalogItemDescriptor,
  LocalAiVerifiedArtifactDescriptor,
  LocalAiVerifiedModelDescriptor,
  OrphanArtifactFile,
  OrphanModelFile,
} from '@runtime/local-ai-runtime';
import type { LocalModelOptionV11 } from '@renderer/features/runtime-config/runtime-config-state-types';
import { RuntimeSelect } from './runtime-config-primitives';
import {
  CAPABILITY_OPTIONS,
  INSTALL_ENGINE_OPTIONS,
  type CapabilityOption,
  type InstallEngineOption,
  formatBytes,
  normalizeInstallEngine,
} from './runtime-config-model-center-utils';
import {
  ARTIFACT_KIND_OPTIONS,
  DownloadIcon,
  FolderOpenIcon,
  formatArtifactKindLabel,
  ModelIcon,
  PackageIcon,
  RefreshIcon,
  SearchIcon,
  StarIcon,
  Toggle,
  TrashIcon,
} from './runtime-config-local-model-center-helpers';
import { ArtifactRequirementBadges } from './runtime-config-local-model-center-sections';

type CatalogCardProps = {
  searchQuery: string;
  catalogCapability: 'all' | CapabilityOption;
  filteredInstalledModels: LocalModelOptionV11[];
  filteredInstalledArtifacts: LocalAiArtifactRecord[];
  loadingCatalog: boolean;
  loadingInstalledArtifacts: boolean;
  loadingVerifiedArtifacts: boolean;
  artifactKindFilter: 'all' | LocalAiArtifactKind;
  artifactBusy: boolean;
  orphanFiles: OrphanModelFile[];
  orphanError: string;
  orphanCapabilities: Record<string, CapabilityOption>;
  orphanImportSessionByPath: Record<string, string>;
  scaffoldingOrphan: string | null;
  artifactOrphanFiles: OrphanArtifactFile[];
  artifactOrphanError: string;
  artifactOrphanKinds: Record<string, LocalAiArtifactKind>;
  scaffoldingArtifactOrphan: string | null;
  hasSearchQuery: boolean;
  verifiedModels: LocalAiVerifiedModelDescriptor[];
  catalogItems: LocalAiCatalogItemDescriptor[];
  catalogDisplayCount: number;
  relatedArtifactsByModelTemplate: Map<string, LocalAiVerifiedArtifactDescriptor[]>;
  installedArtifactsById: Map<string, LocalAiArtifactRecord>;
  variantPickerItem: LocalAiCatalogItemDescriptor | null;
  variantList: GgufVariantDescriptor[];
  variantError: string;
  loadingVariants: boolean;
  selectedCatalogCapability: (item: LocalAiCatalogItemDescriptor) => CapabilityOption;
  selectedCatalogEngine: (item: LocalAiCatalogItemDescriptor) => InstallEngineOption;
  isArtifactPending: (templateId: string) => boolean;
  onSearchQueryChange: (value: string) => void;
  onCatalogCapabilityChange: (value: 'all' | CapabilityOption) => void;
  onStartModel: (localModelId: string) => void;
  onStopModel: (localModelId: string) => void;
  onRemoveModel: (localModelId: string) => void;
  onArtifactKindFilterChange: (value: 'all' | LocalAiArtifactKind) => void;
  onRefreshArtifacts: () => void;
  onRemoveArtifact: (localArtifactId: string) => void;
  onOrphanCapabilityChange: (path: string, capability: CapabilityOption) => void;
  onScaffoldOrphan: (path: string) => void;
  onArtifactOrphanKindChange: (path: string, kind: LocalAiArtifactKind) => void;
  onScaffoldArtifactOrphan: (path: string) => void;
  onInstallMissingArtifacts: (artifacts: LocalAiVerifiedArtifactDescriptor[]) => void;
  onInstallVerifiedModel: (templateId: string) => void;
  onInstallArtifact: (templateId: string) => void;
  onToggleVariantPicker: (item: LocalAiCatalogItemDescriptor) => void;
  onCloseVariantPicker: () => void;
  onCatalogCapabilityOverrideChange: (itemId: string, capability: CapabilityOption) => void;
  onCatalogEngineOverrideChange: (itemId: string, engine: InstallEngineOption) => void;
  onInstallCatalogVariant: (item: LocalAiCatalogItemDescriptor, variantFilename: string) => void;
  onLoadMoreCatalog: () => void;
  installing: boolean;
};

function VerifiedModelSearchRow(props: {
  item: LocalAiVerifiedModelDescriptor;
  relatedArtifacts: LocalAiVerifiedArtifactDescriptor[];
  installedArtifactsById: Map<string, LocalAiArtifactRecord>;
  artifactBusy: boolean;
  installing: boolean;
  isArtifactPending: (templateId: string) => boolean;
  onInstallMissingArtifacts: (artifacts: LocalAiVerifiedArtifactDescriptor[]) => void;
  onInstallArtifact: (templateId: string) => void;
  onInstallVerifiedModel: (templateId: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
        <StarIcon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-900">{props.item.title}</span>
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">Verified</span>
        </div>
        <p className="truncate text-xs text-gray-500">{props.item.modelId}</p>
        {props.item.description ? <p className="mt-0.5 line-clamp-1 text-xs text-gray-400">{props.item.description}</p> : null}
        <ArtifactRequirementBadges
          modelTemplateId={props.item.templateId}
          relatedArtifacts={props.relatedArtifacts}
          installedArtifactsById={props.installedArtifactsById}
          artifactBusy={props.artifactBusy}
          isArtifactPending={props.isArtifactPending}
          onInstallMissingArtifacts={props.onInstallMissingArtifacts}
          onInstallArtifact={props.onInstallArtifact}
        />
      </div>
      <button
        type="button"
        onClick={() => props.onInstallVerifiedModel(props.item.templateId)}
        disabled={props.installing}
        className="flex items-center gap-1.5 rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-mint-600 disabled:opacity-50"
      >
        <DownloadIcon className="h-3.5 w-3.5" />
        Install
      </button>
    </div>
  );
}

function CatalogVariantPicker(props: {
  item: LocalAiCatalogItemDescriptor;
  variantList: GgufVariantDescriptor[];
  variantError: string;
  loadingVariants: boolean;
  selectedCapability: CapabilityOption;
  selectedEngine: InstallEngineOption;
  installing: boolean;
  onClose: () => void;
  onCapabilityChange: (capability: CapabilityOption) => void;
  onEngineChange: (engine: InstallEngineOption) => void;
  onInstallVariant: (filename: string) => void;
}) {
  return (
    <div className="bg-gray-50/80 px-4 pb-3">
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
          <span className="text-xs font-semibold text-gray-500">Select Variant</span>
          <button type="button" onClick={props.onClose} className="text-xs text-gray-400 hover:text-gray-600">
            Close
          </button>
        </div>
        <div className="border-b border-gray-100 bg-[#F7FBF8] px-3 py-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Capability</p>
              <RuntimeSelect
                value={props.selectedCapability}
                onChange={(next) => props.onCapabilityChange((next || 'chat') as CapabilityOption)}
                className="w-full"
                options={CAPABILITY_OPTIONS.map((capability) => ({ value: capability, label: capability }))}
              />
              <p className="mt-1 text-[10px] text-gray-500">
                Detected: {(props.item.capabilities.length > 0 ? props.item.capabilities : ['chat']).join(', ')}
              </p>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Engine</p>
              <RuntimeSelect
                value={props.selectedEngine}
                onChange={(next) => props.onEngineChange(normalizeInstallEngine(next))}
                className="w-full"
                options={INSTALL_ENGINE_OPTIONS.map((engine) => ({ value: engine, label: engine }))}
              />
              <p className="mt-1 text-[10px] text-gray-500">
                Detected: {normalizeInstallEngine(props.item.engine)}
              </p>
            </div>
          </div>
        </div>
        {props.loadingVariants ? (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-gray-500">Loading variants...</p>
          </div>
        ) : props.variantList.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-gray-500">{props.variantError ? `Error: ${props.variantError}` : 'No GGUF variants found'}</p>
          </div>
        ) : (
          <div className="max-h-48 divide-y divide-gray-100 overflow-y-auto">
            {props.variantList.map((variant) => (
              <button
                key={variant.filename}
                type="button"
                disabled={props.installing}
                onClick={() => props.onInstallVariant(variant.filename)}
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-mint-50 disabled:opacity-50"
              >
                <span className="truncate text-xs font-medium text-gray-800">{variant.filename}</span>
                {typeof variant.sizeBytes === 'number' ? (
                  <span className="ml-2 shrink-0 text-[10px] text-gray-500">{formatBytes(variant.sizeBytes)}</span>
                ) : null}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function LocalModelCenterCatalogCard(props: CatalogCardProps) {
  return (
    <div className="overflow-visible rounded-2xl bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)] ring-1 ring-black/[0.04]">
      <div className="border-b border-gray-100 px-4 py-4">
        <div className="mb-3 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-mint-100 text-mint-600">
            <SearchIcon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Model Catalog</h3>
            <p className="text-xs text-gray-500">Search and install from Hugging Face or verified models</p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={props.searchQuery}
              onChange={(event) => props.onSearchQueryChange(event.target.value)}
              placeholder="Search models by name, repo, or task..."
              className="h-10 w-full rounded-lg border border-mint-100 bg-[#F4FBF8] pl-9 pr-4 text-sm outline-none focus:border-mint-400 focus:bg-white focus:ring-2 focus:ring-mint-100"
            />
          </div>
          <RuntimeSelect
            value={props.catalogCapability}
            onChange={(nextCapability) => props.onCatalogCapabilityChange((nextCapability || 'all') as 'all' | CapabilityOption)}
            className="w-52"
            options={[
              { value: 'all', label: 'All Capabilities' },
              ...CAPABILITY_OPTIONS.map((capability) => ({ value: capability, label: capability })),
            ]}
          />
        </div>
      </div>

      <div className="rounded-b-xl bg-white/60">
        <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-2">
          <PackageIcon className="h-4 w-4 text-gray-400" />
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Installed ({props.filteredInstalledModels.length})
          </span>
        </div>
        {props.filteredInstalledModels.length > 0 ? (
          <div className="divide-y divide-gray-200/80">
            {props.filteredInstalledModels.map((model) => (
              <div key={model.localModelId} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white">
                <ModelIcon engine={model.engine} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">{model.model}</span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{model.engine}</span>
                  </div>
                  <p className="truncate text-xs text-gray-500">{model.localModelId}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {model.capabilities.slice(0, 3).map((capability) => (
                      <span key={capability} className="rounded border border-mint-100 bg-mint-50 px-1.5 py-0.5 text-[10px] text-mint-600">{capability}</span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-[10px] ${
                    model.status === 'active' ? 'bg-green-100 text-green-700' : model.status === 'unhealthy' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {model.status}
                  </span>
                  <Toggle
                    checked={model.status === 'active'}
                    onChange={() => (model.status === 'active' ? props.onStopModel(model.localModelId) : props.onStartModel(model.localModelId))}
                  />
                  <button
                    type="button"
                    onClick={() => props.onRemoveModel(model.localModelId)}
                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                    title="Remove"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8 text-center">
            <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-400">
              <PackageIcon className="h-6 w-6" />
            </div>
            <h3 className="mb-1 text-sm font-medium text-gray-900">No Installed Models</h3>
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 bg-white/60">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-2">
          <div className="flex items-center gap-2">
            <FolderOpenIcon className="h-4 w-4 text-gray-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
              Companion Assets ({props.filteredInstalledArtifacts.length})
            </span>
          </div>
          <div className="flex items-center gap-2">
            <RuntimeSelect
              value={props.artifactKindFilter}
              onChange={(next) => props.onArtifactKindFilterChange((next || 'all') as 'all' | LocalAiArtifactKind)}
              className="w-36"
              options={[
                { value: 'all', label: 'All Kinds' },
                ...ARTIFACT_KIND_OPTIONS.map((kind) => ({ value: kind, label: formatArtifactKindLabel(kind) })),
              ]}
            />
            <button
              type="button"
              onClick={props.onRefreshArtifacts}
              disabled={props.loadingInstalledArtifacts || props.loadingVerifiedArtifacts || props.artifactBusy}
              className="flex items-center gap-1.5 rounded border border-gray-200 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshIcon className="h-3 w-3" />
              Refresh
            </button>
          </div>
        </div>
        {props.loadingInstalledArtifacts ? (
          <div className="px-4 py-6 text-center">
            <p className="text-sm text-gray-500">Loading companion assets...</p>
          </div>
        ) : props.filteredInstalledArtifacts.length > 0 ? (
          <div className="divide-y divide-gray-200/80">
            {props.filteredInstalledArtifacts.map((artifact) => (
              <div key={artifact.localArtifactId} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[11px] font-semibold text-slate-600">
                  {formatArtifactKindLabel(artifact.kind).slice(0, 3).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">{artifact.artifactId}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                      {formatArtifactKindLabel(artifact.kind)}
                    </span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{artifact.engine}</span>
                  </div>
                  <p className="truncate text-xs text-gray-500">{artifact.localArtifactId}</p>
                  <p className="truncate text-[11px] text-gray-400">{artifact.entry}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2 py-0.5 text-[10px] ${
                    artifact.status === 'active' ? 'bg-green-100 text-green-700' : artifact.status === 'unhealthy' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'
                  }`}>
                    {artifact.status}
                  </span>
                  <button
                    type="button"
                    onClick={() => props.onRemoveArtifact(artifact.localArtifactId)}
                    disabled={props.artifactBusy}
                    className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    title="Remove artifact"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-6 text-center">
            <div className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-gray-400">
              <FolderOpenIcon className="h-6 w-6" />
            </div>
            <h3 className="mb-1 text-sm font-medium text-gray-900">No Companion Assets</h3>
            <p className="text-xs text-gray-500">Import `artifact.manifest.json` files or install verified VAE/LLM assets below.</p>
          </div>
        )}
      </div>

      {props.artifactOrphanFiles.length > 0 ? (
        <div className="border-t border-slate-200 bg-slate-50/60">
          <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2">
            <svg className="h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
              <path d="m3.3 7 8.7 5 8.7-5" />
              <path d="M12 22V12" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Unregistered Companion Assets ({props.artifactOrphanFiles.length})
            </span>
          </div>
          <div className="border-b border-slate-200 bg-slate-100/70 px-4 py-2 text-[11px] text-slate-600">
            Unclassified files can appear in both model and companion lanes until you import them.
          </div>
          {props.artifactOrphanError ? (
            <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600">
              {props.artifactOrphanError}
            </div>
          ) : null}
          <div className="divide-y divide-slate-200/70">
            {props.artifactOrphanFiles.map((orphan) => (
              <div key={`artifact-${orphan.path}`} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                  <FolderOpenIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-900">{orphan.filename}</div>
                  <div className="text-xs text-gray-500">{formatBytes(orphan.sizeBytes)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <RuntimeSelect
                    value={props.artifactOrphanKinds[orphan.path] || 'vae'}
                    onChange={(value) => props.onArtifactOrphanKindChange(orphan.path, (value || 'vae') as LocalAiArtifactKind)}
                    className="w-36"
                    options={ARTIFACT_KIND_OPTIONS.map((kind) => ({ value: kind, label: formatArtifactKindLabel(kind) }))}
                  />
                  <button
                    type="button"
                    disabled={props.artifactBusy || props.scaffoldingArtifactOrphan === orphan.path}
                    onClick={() => props.onScaffoldArtifactOrphan(orphan.path)}
                    className="flex items-center gap-1 rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    <DownloadIcon className="h-3 w-3" />
                    {(props.artifactBusy || props.scaffoldingArtifactOrphan === orphan.path) ? 'Importing...' : 'Import'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {props.orphanFiles.length > 0 ? (
        <div className="border-t border-amber-200 bg-amber-50/50">
          <div className="flex items-center gap-2 border-b border-amber-200 px-4 py-2">
            <svg className="h-4 w-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-700">
              Unregistered Models Found ({props.orphanFiles.length})
            </span>
          </div>
          {props.orphanError ? (
            <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-600">
              {props.orphanError}
            </div>
          ) : null}
          <div className="divide-y divide-amber-100">
            {props.orphanFiles.map((orphan) => (
              <div key={orphan.path} className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                  <FolderOpenIcon className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-gray-900">{orphan.filename}</div>
                  <div className="text-xs text-gray-500">{formatBytes(orphan.sizeBytes)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <RuntimeSelect
                    value={props.orphanCapabilities[orphan.path] || 'chat'}
                    onChange={(value) => props.onOrphanCapabilityChange(orphan.path, (value || 'chat') as CapabilityOption)}
                    className="w-32"
                    options={CAPABILITY_OPTIONS.map((capability) => ({ value: capability, label: capability }))}
                  />
                  <button
                    type="button"
                    disabled={props.scaffoldingOrphan === orphan.path || Boolean(props.orphanImportSessionByPath[orphan.path])}
                    onClick={() => props.onScaffoldOrphan(orphan.path)}
                    className="flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                  >
                    <DownloadIcon className="h-3 w-3" />
                    {(props.scaffoldingOrphan === orphan.path || props.orphanImportSessionByPath[orphan.path]) ? 'Importing...' : 'Import'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {props.hasSearchQuery ? (
        <div className="border-t border-gray-200 bg-white/60">
          <div className="border-b border-gray-200 bg-white/70 px-4 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Available to Install</span>
          </div>
          <div className="divide-y divide-gray-200/80">
            {props.verifiedModels.map((item) => (
              <VerifiedModelSearchRow
                key={item.templateId}
                item={item}
                relatedArtifacts={props.relatedArtifactsByModelTemplate.get(item.templateId) || []}
                installedArtifactsById={props.installedArtifactsById}
                artifactBusy={props.artifactBusy}
                installing={props.installing}
                isArtifactPending={props.isArtifactPending}
                onInstallMissingArtifacts={props.onInstallMissingArtifacts}
                onInstallArtifact={props.onInstallArtifact}
                onInstallVerifiedModel={props.onInstallVerifiedModel}
              />
            ))}
            {props.catalogItems.slice(0, props.catalogDisplayCount).map((item) => (
              <div key={item.itemId}>
                <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white">
                  <ModelIcon engine={item.engine} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-gray-900">{item.title || item.modelId}</span>
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">{item.engine}</span>
                      <span className="rounded bg-mint-50 px-1.5 py-0.5 text-[10px] text-mint-700">Hugging Face</span>
                    </div>
                    <p className="truncate text-xs text-gray-500">{item.modelId}</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(item.capabilities.length > 0 ? item.capabilities : ['chat']).map((capability) => (
                        <span key={`${item.itemId}-${capability}`} className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                          {capability}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] ${item.installAvailable ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {item.installAvailable ? 'Ready' : 'Manual'}
                  </span>
                  <button
                    type="button"
                    onClick={() => props.onToggleVariantPicker(item)}
                    disabled={!item.installAvailable || props.installing}
                    className="flex items-center gap-1.5 rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-mint-600 disabled:opacity-50"
                  >
                    <DownloadIcon className="h-3.5 w-3.5" />
                    Install
                  </button>
                </div>
                {props.variantPickerItem?.itemId === item.itemId ? (
                  <CatalogVariantPicker
                    item={item}
                    variantList={props.variantList}
                    variantError={props.variantError}
                    loadingVariants={props.loadingVariants}
                    selectedCapability={props.selectedCatalogCapability(item)}
                    selectedEngine={props.selectedCatalogEngine(item)}
                    installing={props.installing}
                    onClose={props.onCloseVariantPicker}
                    onCapabilityChange={(capability) => props.onCatalogCapabilityOverrideChange(item.itemId, capability)}
                    onEngineChange={(engine) => props.onCatalogEngineOverrideChange(item.itemId, engine)}
                    onInstallVariant={(filename) => props.onInstallCatalogVariant(item, filename)}
                  />
                ) : null}
              </div>
            ))}
          </div>
          {props.catalogItems.length > props.catalogDisplayCount ? (
            <div className="border-t border-gray-100 px-4 py-3 text-center">
              <button
                type="button"
                onClick={props.onLoadMoreCatalog}
                className="rounded-lg border border-gray-200 px-4 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                Load More ({props.catalogItems.length - props.catalogDisplayCount} remaining)
              </button>
            </div>
          ) : null}
          {props.catalogItems.length === 0 && props.verifiedModels.length === 0 && !props.loadingCatalog ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-gray-500">No models found matching your search</p>
            </div>
          ) : null}
          {props.loadingCatalog ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-gray-500">Searching...</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
