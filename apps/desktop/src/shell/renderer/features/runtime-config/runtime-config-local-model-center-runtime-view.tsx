import type { RefObject } from 'react';
import type {
  LocalAiArtifactKind,
  LocalAiArtifactRecord,
  LocalAiCatalogItemDescriptor,
  GgufVariantDescriptor,
  LocalAiVerifiedArtifactDescriptor,
  LocalAiVerifiedModelDescriptor,
  OrphanArtifactFile,
  OrphanModelFile,
} from '@runtime/local-ai-runtime';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import type {
  ArtifactTaskEntry,
} from './runtime-config-local-model-center-helpers';
import { LocalModelCenterCatalogCard } from './runtime-config-local-model-center-catalog-card';
import { LocalModelCenterImportControls } from './runtime-config-local-model-center-import-controls';
import {
  LocalModelCenterActiveDownloadsSection,
  LocalModelCenterArtifactTasksSection,
  LocalModelCenterQuickPicksSection,
  LocalModelCenterVerifiedArtifactsSection,
} from './runtime-config-local-model-center-sections';
import type {
  CapabilityOption,
  InstallEngineOption,
} from './runtime-config-model-center-utils';
import type { LocalModelOptionV11 } from './runtime-config-state-types';
import type { useLocalModelCenterDownloads } from './runtime-config-use-local-model-center-downloads';

type DownloadState = ReturnType<typeof useLocalModelCenterDownloads>;

type LocalModelCenterRuntimeViewProps = {
  artifactBusy: boolean;
  artifactKindFilter: 'all' | LocalAiArtifactKind;
  artifactOrphanError: string;
  artifactOrphanFiles: OrphanArtifactFile[];
  artifactOrphanKinds: Record<string, LocalAiArtifactKind>;
  artifactPendingTemplateIds: string[];
  catalogCapability: 'all' | CapabilityOption;
  catalogDisplayCount: number;
  catalogItems: LocalAiCatalogItemDescriptor[];
  checkingHealth: boolean;
  deferredSearchQuery: string;
  discovering: boolean;
  filteredInstalledArtifacts: LocalAiArtifactRecord[];
  filteredInstalledModels: LocalModelOptionV11[];
  hasSearchQuery: boolean;
  importFileCapability: CapabilityOption;
  importMenuRef: RefObject<HTMLDivElement | null>;
  installing: boolean;
  installedArtifactsById: Map<string, LocalAiArtifactRecord>;
  isArtifactPending: (templateId: string) => boolean;
  loadingCatalog: boolean;
  loadingInstalledArtifacts: boolean;
  loadingVariants: boolean;
  loadingVerifiedArtifacts: boolean;
  loadingVerifiedModels: boolean;
  localHealthy: boolean;
  onArtifactKindFilterChange: (value: 'all' | LocalAiArtifactKind) => void;
  onArtifactOrphanKindChange: (path: string, kind: LocalAiArtifactKind) => void;
  onCapabilityChange: (capability: CapabilityOption) => void;
  onCatalogCapabilityChange: (value: 'all' | CapabilityOption) => void;
  onCatalogCapabilityOverrideChange: (itemId: string, capability: CapabilityOption) => void;
  onCatalogEngineOverrideChange: (itemId: string, engine: InstallEngineOption) => void;
  onChooseImportFile: () => void;
  onCloseImportFileDialog: () => void;
  onCloseVariantPicker: () => void;
  onHealthCheck: () => void;
  onImportArtifact: () => void;
  onImportManifest: () => void;
  onInstallArtifact: (templateId: string) => void;
  onInstallCatalogVariant: (item: LocalAiCatalogItemDescriptor, variantFilename: string) => void;
  onInstallMissingArtifacts: (artifacts: LocalAiVerifiedArtifactDescriptor[]) => void;
  onInstallVerifiedModel: (templateId: string) => void;
  onLoadMoreCatalog: () => void;
  onOpenImportFile: () => void;
  onOrphanCapabilityChange: (path: string, capability: CapabilityOption) => void;
  onPauseDownload: DownloadState['onPauseDownload'];
  onRefresh: () => void;
  onRefreshArtifacts: () => void;
  onRefreshQuickPicks: () => void;
  onRemoveArtifact: (localArtifactId: string) => void;
  onRemoveModel: (localModelId: string) => void;
  onResumeDownload: DownloadState['onResumeDownload'];
  onScaffoldArtifactOrphan: (path: string) => void;
  onScaffoldOrphan: (path: string) => void;
  onSearchQueryChange: (value: string) => void;
  onStartModel: (localModelId: string) => void;
  onStopModel: (localModelId: string) => void;
  onToggleImportMenu: () => void;
  onToggleVariantPicker: (item: LocalAiCatalogItemDescriptor) => void;
  orphanCapabilities: Record<string, CapabilityOption>;
  orphanError: string;
  orphanFiles: OrphanModelFile[];
  orphanImportSessionByPath: Record<string, string>;
  relatedArtifactsByModelTemplate: Map<string, LocalAiVerifiedArtifactDescriptor[]>;
  scaffoldingArtifactOrphan: string | null;
  scaffoldingOrphan: string | null;
  searchQuery: string;
  selectedCatalogCapability: (item: LocalAiCatalogItemDescriptor) => CapabilityOption;
  selectedCatalogEngine: (item: LocalAiCatalogItemDescriptor) => InstallEngineOption;
  showImportFileDialog: boolean;
  showImportMenu: boolean;
  variantError: string;
  variantList: GgufVariantDescriptor[];
  variantPickerItem: LocalAiCatalogItemDescriptor | null;
  verifiedModels: LocalAiVerifiedModelDescriptor[];
  visibleArtifactTasks: ArtifactTaskEntry[];
  visibleVerifiedArtifacts: LocalAiVerifiedArtifactDescriptor[];
  downloads: DownloadState['activeDownloads'];
  onCancelDownload: DownloadState['onCancelDownload'];
  lastCheckedAt?: string | null;
};

export function LocalModelCenterRuntimeView(props: LocalModelCenterRuntimeViewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <ScrollShell className="flex-1" contentClassName="mx-auto max-w-4xl space-y-6 p-6">
        <LocalModelCenterImportControls
          checkingHealth={props.checkingHealth}
          localHealthy={props.localHealthy}
          lastCheckedAt={props.lastCheckedAt}
          discovering={props.discovering}
          importMenuRef={props.importMenuRef}
          showImportMenu={props.showImportMenu}
          showImportFileDialog={props.showImportFileDialog}
          importFileCapability={props.importFileCapability}
          onHealthCheck={props.onHealthCheck}
          onRefresh={props.onRefresh}
          onToggleImportMenu={props.onToggleImportMenu}
          onOpenImportFile={props.onOpenImportFile}
          onImportManifest={props.onImportManifest}
          onImportArtifactManifest={props.onImportArtifact}
          onCapabilityChange={props.onCapabilityChange}
          onCloseImportFileDialog={props.onCloseImportFileDialog}
          onChooseImportFile={props.onChooseImportFile}
        />
        <LocalModelCenterCatalogCard
          searchQuery={props.searchQuery}
          catalogCapability={props.catalogCapability}
          filteredInstalledModels={props.filteredInstalledModels}
          filteredInstalledArtifacts={props.filteredInstalledArtifacts}
          loadingCatalog={props.loadingCatalog}
          loadingInstalledArtifacts={props.loadingInstalledArtifacts}
          loadingVerifiedArtifacts={props.loadingVerifiedArtifacts}
          artifactKindFilter={props.artifactKindFilter}
          artifactBusy={props.artifactBusy}
          orphanFiles={props.orphanFiles}
          orphanError={props.orphanError}
          orphanCapabilities={props.orphanCapabilities}
          orphanImportSessionByPath={props.orphanImportSessionByPath}
          scaffoldingOrphan={props.scaffoldingOrphan}
          artifactOrphanFiles={props.artifactOrphanFiles}
          artifactOrphanError={props.artifactOrphanError}
          artifactOrphanKinds={props.artifactOrphanKinds}
          scaffoldingArtifactOrphan={props.scaffoldingArtifactOrphan}
          hasSearchQuery={props.hasSearchQuery}
          verifiedModels={props.verifiedModels}
          catalogItems={props.catalogItems}
          catalogDisplayCount={props.catalogDisplayCount}
          relatedArtifactsByModelTemplate={props.relatedArtifactsByModelTemplate}
          installedArtifactsById={props.installedArtifactsById}
          variantPickerItem={props.variantPickerItem}
          variantList={props.variantList}
          variantError={props.variantError}
          loadingVariants={props.loadingVariants}
          selectedCatalogCapability={props.selectedCatalogCapability}
          selectedCatalogEngine={props.selectedCatalogEngine}
          isArtifactPending={props.isArtifactPending}
          onSearchQueryChange={props.onSearchQueryChange}
          onCatalogCapabilityChange={props.onCatalogCapabilityChange}
          onStartModel={props.onStartModel}
          onStopModel={props.onStopModel}
          onRemoveModel={props.onRemoveModel}
          onArtifactKindFilterChange={props.onArtifactKindFilterChange}
          onRefreshArtifacts={props.onRefreshArtifacts}
          onRemoveArtifact={props.onRemoveArtifact}
          onOrphanCapabilityChange={props.onOrphanCapabilityChange}
          onScaffoldOrphan={props.onScaffoldOrphan}
          onArtifactOrphanKindChange={props.onArtifactOrphanKindChange}
          onScaffoldArtifactOrphan={props.onScaffoldArtifactOrphan}
          onInstallMissingArtifacts={props.onInstallMissingArtifacts}
          onInstallVerifiedModel={props.onInstallVerifiedModel}
          onInstallArtifact={props.onInstallArtifact}
          onToggleVariantPicker={props.onToggleVariantPicker}
          onCloseVariantPicker={props.onCloseVariantPicker}
          onCatalogCapabilityOverrideChange={props.onCatalogCapabilityOverrideChange}
          onCatalogEngineOverrideChange={props.onCatalogEngineOverrideChange}
          onInstallCatalogVariant={props.onInstallCatalogVariant}
          onLoadMoreCatalog={props.onLoadMoreCatalog}
          installing={props.installing}
        />
        <LocalModelCenterVerifiedArtifactsSection
          hasSearchQuery={props.hasSearchQuery}
          loadingVerifiedArtifacts={props.loadingVerifiedArtifacts}
          artifactBusy={props.artifactBusy}
          visibleVerifiedArtifacts={props.visibleVerifiedArtifacts}
          isArtifactPending={props.isArtifactPending}
          onRefresh={props.onRefreshArtifacts}
          onInstallArtifact={props.onInstallArtifact}
        />
        <LocalModelCenterActiveDownloadsSection
          downloads={props.downloads}
          onPause={props.onPauseDownload}
          onResume={props.onResumeDownload}
          onCancel={props.onCancelDownload}
        />
        <LocalModelCenterArtifactTasksSection
          tasks={props.visibleArtifactTasks}
          pendingTemplateIds={props.artifactPendingTemplateIds}
          onRetryTask={props.onInstallArtifact}
        />
        {!props.hasSearchQuery ? (
          <LocalModelCenterQuickPicksSection
            loadingVerifiedModels={props.loadingVerifiedModels}
            installing={props.installing}
            artifactBusy={props.artifactBusy}
            verifiedModels={props.verifiedModels}
            relatedArtifactsByModelTemplate={props.relatedArtifactsByModelTemplate}
            installedArtifactsById={props.installedArtifactsById}
            isArtifactPending={props.isArtifactPending}
            onRefresh={props.onRefreshQuickPicks}
            onInstallVerifiedModel={props.onInstallVerifiedModel}
            onInstallArtifact={props.onInstallArtifact}
            onInstallMissingArtifacts={props.onInstallMissingArtifacts}
          />
        ) : null}
      </ScrollShell>
    </div>
  );
}
