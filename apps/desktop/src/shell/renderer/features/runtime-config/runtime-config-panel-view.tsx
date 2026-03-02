import { useEffect, useMemo, useState } from 'react';
import { ProviderConnectorsPanel } from './panels/provider-connectors-panel';
import { DiagnosticsPanel } from './panels/diagnostics-panel';
import {
  RUNTIME_SECTION_META,
} from './runtime-config-meta-v11';
import { RuntimeSectionSidebar } from './panels/runtime-section-sidebar';
import { StatusBadge } from './panels/primitives';
import { RuntimeSetupTabs } from './panels/setup/runtime-setup-tabs';
import type { RuntimeConfigPanelControllerModel } from './runtime-config-panel-types';
import { useRuntimeConfigPanelController } from './runtime-config-panel-controller';

export function RuntimeConfigPanelBody() {
  const model = useRuntimeConfigPanelController();
  return <RuntimeConfigPanelView model={model} />;
}

export function RuntimeConfigPanelView(props: { model: RuntimeConfigPanelControllerModel }) {
  const { model } = props;
  const { state } = model;
  const [selectedRuntimeDependencyModId, setSelectedRuntimeDependencyModId] = useState('');
  const [activeSidebarTargetId, setActiveSidebarTargetId] = useState('runtime');
  const runtimeDependencyTargets = model.runtimeDependencyTargets;

  useEffect(() => {
    if (runtimeDependencyTargets.length === 0) {
      setSelectedRuntimeDependencyModId('');
      if (activeSidebarTargetId !== 'eaa') {
        setActiveSidebarTargetId('runtime');
      }
      return;
    }
    if (!runtimeDependencyTargets.some((item) => item.modId === selectedRuntimeDependencyModId)) {
      const nextModId = runtimeDependencyTargets[0]?.modId || '';
      setSelectedRuntimeDependencyModId(nextModId);
      if (activeSidebarTargetId !== 'runtime' && activeSidebarTargetId !== 'eaa') {
        setActiveSidebarTargetId(nextModId || 'runtime');
      }
    }
  }, [activeSidebarTargetId, runtimeDependencyTargets, selectedRuntimeDependencyModId]);

  useEffect(() => {
    if (activeSidebarTargetId === 'runtime' || activeSidebarTargetId === 'eaa') return;
    if (!runtimeDependencyTargets.some((item) => item.modId === activeSidebarTargetId)) {
      const nextModId = runtimeDependencyTargets[0]?.modId || '';
      setActiveSidebarTargetId(nextModId || 'runtime');
      if (nextModId) {
        setSelectedRuntimeDependencyModId(nextModId);
      }
    }
  }, [activeSidebarTargetId, runtimeDependencyTargets]);

  const activeConfigScope = activeSidebarTargetId === 'runtime'
    ? 'runtime'
    : activeSidebarTargetId === 'eaa'
      ? 'eaa'
      : 'mod';
  const selectedRuntimeDependencyTarget = useMemo(
    () => runtimeDependencyTargets.find((item) => item.modId === activeSidebarTargetId) || null,
    [activeSidebarTargetId, runtimeDependencyTargets],
  );
  const setupSectionName = activeSidebarTargetId === 'eaa'
    ? 'EAA'
    : selectedRuntimeDependencyTarget
      ? selectedRuntimeDependencyTarget.modName
      : 'Runtime';
  const setupSectionDescription = activeSidebarTargetId === 'eaa'
    ? 'External Agent Access token and scope management.'
    : selectedRuntimeDependencyTarget
      ? `Mod-scoped model dependencies (${selectedRuntimeDependencyTarget.consumeCapabilities.join(', ')})`
      : 'Global AI setup: token connectors, local services, and model lifecycle.';

  useEffect(() => {
    if (!state || state.activeSection === 'setup') return;
    model.updateState((prev) => ({
      ...prev,
      activeSection: 'setup',
    }));
  }, [model, state]);

  if (!state) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="rounded-[10px] border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">Loading runtime config...</div>
      </div>
    );
  }
  const runtimeStatus = model.runtimeStatus || state.localRuntime.status;
  const activeSetupPage = activeConfigScope === 'runtime' ? model.activeSetupPage : 'models';
  const daemonRunning = model.runtimeDaemonStatus?.running === true;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white">
        <div className="flex h-14 shrink-0 items-center px-6">
          <h1 className="text-lg font-semibold text-gray-900">AI Runtime</h1>
        </div>
        <RuntimeSectionSidebar
          dependencyTargets={runtimeDependencyTargets}
          activeTargetId={activeSidebarTargetId}
          onSelectRuntime={() => {
            setActiveSidebarTargetId('runtime');
            model.updateState((prev) => ({
              ...prev,
              activeSection: 'setup',
            }));
            model.setShowTokenApiKey(false);
          }}
          onSelectEaa={() => {
            setActiveSidebarTargetId('eaa');
            model.updateState((prev) => ({
              ...prev,
              activeSection: 'setup',
            }));
            model.setShowTokenApiKey(false);
          }}
          onSelectDependencyMod={(modId) => {
            setSelectedRuntimeDependencyModId(modId);
            setActiveSidebarTargetId(modId);
            model.updateState((prev) => ({
              ...prev,
              activeSection: 'setup',
            }));
            model.setShowTokenApiKey(false);
          }}
        />
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-gray-50">
        <div className="flex h-14 shrink-0 items-center bg-white px-6">
          <div className="flex w-full items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{setupSectionName}</h2>
              <p className="text-xs text-gray-500">{setupSectionDescription}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                daemonRunning ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                daemon {daemonRunning ? 'running' : 'stopped'}
              </span>
              <StatusBadge status={runtimeStatus} />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-4xl space-y-6">
            {state.activeSection === 'setup' && activeConfigScope === 'runtime' ? (
              <RuntimeSetupTabs
                activePage={model.activeSetupPage}
                onChangePage={model.onChangeSetupPage}
              />
            ) : null}
            {state.activeSection === 'setup' ? (
              <ProviderConnectorsPanel
                stateModel={{
                  state,
                  selectedConnector: model.selectedConnector,
                  orderedConnectors: model.orderedConnectors,
                  updateState: model.updateState,
                }}
                viewModel={{
                  activeSetupPage,
                  onChangeSetupPage: model.onChangeSetupPage,
                  showTokenApiKey: model.showTokenApiKey,
                  localRuntimeModelQuery: model.localRuntimeModelQuery,
                  connectorModelQuery: model.connectorModelQuery,
                  filteredLocalRuntimeModels: model.filteredLocalRuntimeModels,
                  filteredConnectorModels: model.filteredConnectorModels,
                  runtimeDependencyTargets,
                  activeConfigScope,
                  activeRuntimeDependencyTarget: selectedRuntimeDependencyTarget,
                  selectedRuntimeDependencyModId,
                  setSelectedRuntimeDependencyModId,
                }}
                commandModel={{
                  checkingHealth: model.checkingHealth,
                  discovering: model.discovering,
                  testingConnector: model.testingConnector,
                  runtimeDaemonStatus: model.runtimeDaemonStatus,
                  runtimeDaemonBusyAction: model.runtimeDaemonBusyAction,
                  runtimeDaemonError: model.runtimeDaemonError,
                  runtimeDaemonUpdatedAt: model.runtimeDaemonUpdatedAt,
                  setShowTokenApiKey: model.setShowTokenApiKey,
                  setLocalRuntimeModelQuery: model.setLocalRuntimeModelQuery,
                  setConnectorModelQuery: model.setConnectorModelQuery,
                  discoverLocalRuntimeModels: model.discoverLocalRuntimeModels,
                  runLocalRuntimeHealthCheck: model.runLocalRuntimeHealthCheck,
                  testSelectedConnector: model.testSelectedConnector,
                  refreshRuntimeDaemonStatus: model.refreshRuntimeDaemonStatus,
                  startRuntimeDaemon: model.startRuntimeDaemon,
                  restartRuntimeDaemon: model.restartRuntimeDaemon,
                  stopRuntimeDaemon: model.stopRuntimeDaemon,
                  resolveRuntimeDependencies: model.resolveRuntimeDependencies,
                  applyRuntimeDependencies: model.applyRuntimeDependencies,
                  installCatalogLocalRuntimeModel: model.installCatalogLocalRuntimeModel,
                  installLocalRuntimeModel: model.installLocalRuntimeModel,
                  installVerifiedLocalRuntimeModel: model.installVerifiedLocalRuntimeModel,
                  importLocalRuntimeModel: model.importLocalRuntimeModel,
                  importLocalRuntimeModelFile: model.importLocalRuntimeModelFile,
                  startLocalRuntimeModel: model.startLocalRuntimeModel,
                  stopLocalRuntimeModel: model.stopLocalRuntimeModel,
                  restartLocalRuntimeModel: model.restartLocalRuntimeModel,
                  removeLocalRuntimeModel: model.removeLocalRuntimeModel,
                  onVaultChanged: model.onVaultChanged,
                  vaultEntryCount: model.vaultEntryCount,
                  onDownloadComplete: model.onDownloadComplete,
                  retryInstall: model.retryInstall,
                  installSessionMeta: model.installSessionMeta,
                }}
              />
            ) : null}

            {activeSetupPage !== 'audit' ? (
              <DiagnosticsPanel
                state={state}
                runtimeSectionMeta={RUNTIME_SECTION_META}
                selectedConnector={model.selectedConnector}
                vaultEntryCount={model.vaultEntryCount}
                updateState={model.updateState}
                compact={activeSetupPage !== 'providers'}
              />
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
