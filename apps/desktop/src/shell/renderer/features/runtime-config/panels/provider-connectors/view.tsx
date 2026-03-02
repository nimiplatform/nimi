import type { RuntimeSetupPageIdV11 } from '@renderer/features/runtime-config/state/types';
import type { ProviderConnectorsPanelViewProps } from './types';
import { LocalRuntimeModelCenter } from '../setup/local-runtime-model-center';
import { RuntimeOverviewPage } from '../setup/runtime-overview-page';
import { ExternalAgentAccessPanel } from '../setup/external-agent-access';
import { TokenApiConnectorsPage } from '../setup/token-api-connectors-page';
import { ProvidersPage } from '../setup/providers-page';
import { AuditPage } from '../setup/audit-page';

export function ProviderConnectorsPanelView({
  stateModel,
  viewModel,
  commandModel,
  onAddConnector,
  onRemoveSelectedConnector,
  onSelectConnector,
  onChangeLocalRuntimeEndpoint,
  onRenameSelectedConnector,
  onChangeConnectorEndpoint,
  onChangeConnectorToken,
  onChangeConnectorVendor,
}: ProviderConnectorsPanelViewProps) {
  const { state, selectedConnector, orderedConnectors } = stateModel;
  const {
    activeSetupPage,
    onChangeSetupPage,
    showTokenApiKey,
    localRuntimeModelQuery,
    connectorModelQuery,
    filteredLocalRuntimeModels,
    filteredConnectorModels,
    runtimeDependencyTargets,
    activeConfigScope,
    activeRuntimeDependencyTarget,
    selectedRuntimeDependencyModId,
    setSelectedRuntimeDependencyModId,
  } = viewModel;
  const handleNavigate = (pageId: RuntimeSetupPageIdV11) => onChangeSetupPage(pageId);
  const {
    checkingHealth,
    discovering,
    testingConnector,
    setShowTokenApiKey,
    setLocalRuntimeModelQuery,
    setConnectorModelQuery,
    discoverLocalRuntimeModels,
    runLocalRuntimeHealthCheck,
    testSelectedConnector,
    runtimeDaemonStatus,
    runtimeDaemonBusyAction,
    runtimeDaemonError,
    runtimeDaemonUpdatedAt,
    refreshRuntimeDaemonStatus,
    startRuntimeDaemon,
    restartRuntimeDaemon,
    stopRuntimeDaemon,
    resolveRuntimeDependencies,
    applyRuntimeDependencies,
    installCatalogLocalRuntimeModel,
    installLocalRuntimeModel,
    installVerifiedLocalRuntimeModel,
    importLocalRuntimeModel,
    importLocalRuntimeModelFile,
    startLocalRuntimeModel,
    stopLocalRuntimeModel,
    restartLocalRuntimeModel,
    removeLocalRuntimeModel,
    onDownloadComplete,
    retryInstall,
    installSessionMeta,
  } = commandModel;
  const isRuntimeScope = activeConfigScope === 'runtime';
  const isEaaScope = activeConfigScope === 'eaa';
  const isModScope = activeConfigScope === 'mod';
  const lockedDependencyModId = activeRuntimeDependencyTarget?.modId || selectedRuntimeDependencyModId;
  const effectiveSetupPage = isRuntimeScope ? activeSetupPage : 'models';

  return (
    <div className="space-y-5">
      {isEaaScope ? <ExternalAgentAccessPanel /> : (
        <>
          {isRuntimeScope && effectiveSetupPage === 'overview' ? (
            <RuntimeOverviewPage
              state={state}
              runtimeDependencyTargets={runtimeDependencyTargets}
              registeredRuntimeModIds={runtimeDependencyTargets.map((target) => target.modId)}
              vaultEntryCount={commandModel.vaultEntryCount}
              discovering={discovering}
              checkingHealth={checkingHealth}
              runtimeDaemonStatus={runtimeDaemonStatus}
              runtimeDaemonBusyAction={runtimeDaemonBusyAction}
              runtimeDaemonError={runtimeDaemonError}
              runtimeDaemonUpdatedAt={runtimeDaemonUpdatedAt}
              onDiscover={discoverLocalRuntimeModels}
              onHealthCheck={runLocalRuntimeHealthCheck}
              onRefreshRuntimeDaemon={refreshRuntimeDaemonStatus}
              onStartRuntimeDaemon={startRuntimeDaemon}
              onRestartRuntimeDaemon={restartRuntimeDaemon}
              onStopRuntimeDaemon={stopRuntimeDaemon}
              onNavigate={handleNavigate}
            />
          ) : null}
          {effectiveSetupPage === 'models' ? (
            <LocalRuntimeModelCenter
              state={state}
              discovering={discovering}
              checkingHealth={checkingHealth}
              displayMode={isRuntimeScope ? 'runtime' : 'mod'}
              lockedDependencyModId={isModScope ? lockedDependencyModId : undefined}
              runtimeDependencyTargets={runtimeDependencyTargets}
              selectedDependencyModId={selectedRuntimeDependencyModId}
              onSelectDependencyModId={setSelectedRuntimeDependencyModId}
              localRuntimeModelQuery={localRuntimeModelQuery}
              filteredLocalRuntimeModels={filteredLocalRuntimeModels}
              onDiscover={discoverLocalRuntimeModels}
              onHealthCheck={runLocalRuntimeHealthCheck}
              onResolveDependencies={resolveRuntimeDependencies}
              onApplyDependencies={applyRuntimeDependencies}
              onInstallCatalogItem={installCatalogLocalRuntimeModel}
              onInstall={installLocalRuntimeModel}
              onInstallVerified={installVerifiedLocalRuntimeModel}
              onImport={importLocalRuntimeModel}
              onImportFile={importLocalRuntimeModelFile}
              onStart={startLocalRuntimeModel}
              onStop={stopLocalRuntimeModel}
              onRestart={restartLocalRuntimeModel}
              onRemove={removeLocalRuntimeModel}
              onSetLocalRuntimeModelQuery={setLocalRuntimeModelQuery}
              onChangeLocalRuntimeEndpoint={onChangeLocalRuntimeEndpoint}
              onNavigateToSetup={handleNavigate}
              onDownloadComplete={onDownloadComplete}
              onRetryInstall={retryInstall}
              installSessionMeta={installSessionMeta}
            />
          ) : null}
          {isRuntimeScope && effectiveSetupPage === 'cloud-api' ? (
            <TokenApiConnectorsPage
              state={state}
              selectedConnector={selectedConnector}
              orderedConnectors={orderedConnectors}
              showTokenApiKey={showTokenApiKey}
              connectorModelQuery={connectorModelQuery}
              filteredConnectorModels={filteredConnectorModels}
              testingConnector={testingConnector}
              onSetShowTokenApiKey={setShowTokenApiKey}
              onSetConnectorModelQuery={setConnectorModelQuery}
              onAddConnector={onAddConnector}
              onRemoveSelectedConnector={onRemoveSelectedConnector}
              onSelectConnector={onSelectConnector}
              onRenameSelectedConnector={onRenameSelectedConnector}
              onChangeConnectorEndpoint={onChangeConnectorEndpoint}
              onChangeConnectorToken={onChangeConnectorToken}
              onChangeConnectorVendor={onChangeConnectorVendor}
              onTestSelectedConnector={testSelectedConnector}
            />
          ) : null}
          {isRuntimeScope && effectiveSetupPage === 'providers' ? (
            <ProvidersPage state={state} onNavigate={handleNavigate} />
          ) : null}
          {isRuntimeScope && effectiveSetupPage === 'audit' ? (
            <AuditPage />
          ) : null}
        </>
      )}
    </div>
  );
}
