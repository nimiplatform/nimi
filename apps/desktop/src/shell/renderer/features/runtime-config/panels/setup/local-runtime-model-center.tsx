import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  localAiRuntime,
  type LocalAiDependencyResolutionPlan,
} from '@runtime/local-ai-runtime';
import { Button, Card, Input, StatusBadge, renderModelChips } from '../primitives';
import { ModelCenterCatalogSection } from './model-center-catalog-section';
import { ModelCenterDependencySection } from './model-center-dependency-section';
import { ModelCenterInstalledList } from './model-center-installed-list';
import {
  CAPABILITY_OPTIONS,
  HIGHLIGHT_CLEAR_MS,
  PROGRESS_SESSION_LIMIT,
  type CapabilityOption,
  type LocalRuntimeModelCenterProps,
  type ProgressSessionState,
  formatBytes,
  formatEta,
  formatSpeed,
  parseTimestamp,
  pruneProgressSessions,
} from './model-center-utils';

export function LocalRuntimeModelCenter(props: LocalRuntimeModelCenterProps) {
  const [installing, setInstalling] = useState(false);
  const [importing, setImporting] = useState(false);
  const [modelId, setModelId] = useState('');
  const [repo, setRepo] = useState('');
  const [revision, setRevision] = useState('main');
  const [engine, setEngine] = useState('localai');
  const [entry, setEntry] = useState('');
  const [license, setLicense] = useState('');
  const [selectedCapabilities, setSelectedCapabilities] = useState<CapabilityOption[]>(['chat']);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pendingHighlightModel, setPendingHighlightModel] = useState('');
  const [highlightLocalModelId, setHighlightLocalModelId] = useState('');
  const [progressBySessionId, setProgressBySessionId] = useState<Record<string, ProgressSessionState>>({});
  const [internalSelectedDependencyModId, setInternalSelectedDependencyModId] = useState('');
  const [selectedDependencyCapability, setSelectedDependencyCapability] = useState<'auto' | CapabilityOption>('auto');
  const [dependencyPlanPreview, setDependencyPlanPreview] = useState<LocalAiDependencyResolutionPlan | null>(null);
  const [loadingDependencyPlan, setLoadingDependencyPlan] = useState(false);
  const displayMode: 'runtime' | 'mod' = props.displayMode === 'mod' ? 'mod' : 'runtime';
  const isModMode = displayMode === 'mod';
  const lockedDependencyModId = String(props.lockedDependencyModId || '').trim();
  const dependencySelectionLocked = isModMode && Boolean(lockedDependencyModId);
  const selectedDependencyModId = useMemo(
    () => (
      lockedDependencyModId
      || String(props.selectedDependencyModId || '').trim()
      || internalSelectedDependencyModId
    ),
    [internalSelectedDependencyModId, lockedDependencyModId, props.selectedDependencyModId],
  );
  const setSelectedDependencyModId = useCallback((modId: string) => {
    const normalized = String(modId || '').trim();
    if (dependencySelectionLocked) return;
    setInternalSelectedDependencyModId(normalized);
    props.onSelectDependencyModId?.(normalized);
  }, [dependencySelectionLocked, props.onSelectDependencyModId]);

  const resolveDependencyPlanPreview = useCallback(async (input?: {
    modId?: string;
    capability?: 'auto' | CapabilityOption;
  }) => {
    const modId = String(input?.modId ?? selectedDependencyModId).trim();
    const capability = input?.capability ?? selectedDependencyCapability;
    if (!modId) {
      setDependencyPlanPreview(null);
      return;
    }
    setLoadingDependencyPlan(true);
    try {
      const plan = await props.onResolveDependencies(
        modId,
        capability === 'auto' ? undefined : capability,
      );
      setDependencyPlanPreview(plan);
    } catch {
      setDependencyPlanPreview(null);
    } finally {
      setLoadingDependencyPlan(false);
    }
  }, [props.onResolveDependencies, selectedDependencyCapability, selectedDependencyModId]);

  useEffect(() => {
    if (isModMode) {
      return undefined;
    }
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    void localAiRuntime.subscribeDownloadProgress((event) => {
      if (disposed) return;
      const nowMs = Date.now();
      setProgressBySessionId((prev) => {
        const next = pruneProgressSessions(prev, nowMs);
        return {
          ...next,
          [event.installSessionId]: {
            event,
            updatedAtMs: nowMs,
          },
        };
      });
    }).then((off) => {
      if (disposed) {
        off();
        return;
      }
      unsubscribe = off;
    });
    return () => {
      disposed = true;
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [isModMode]);

  useEffect(() => {
    if (props.runtimeDependencyTargets.length === 0) {
      setSelectedDependencyModId('');
      setDependencyPlanPreview(null);
      return;
    }
    if (!props.runtimeDependencyTargets.some((item) => item.modId === selectedDependencyModId)) {
      setSelectedDependencyModId(props.runtimeDependencyTargets[0]?.modId || '');
    }
  }, [props.runtimeDependencyTargets, selectedDependencyModId, setSelectedDependencyModId]);

  useEffect(() => {
    if (!selectedDependencyModId) {
      setDependencyPlanPreview(null);
      return;
    }
    const timer = setTimeout(() => {
      void resolveDependencyPlanPreview();
    }, 140);
    return () => {
      clearTimeout(timer);
    };
  }, [resolveDependencyPlanPreview, selectedDependencyCapability, selectedDependencyModId]);

  useEffect(() => {
    if (isModMode) {
      return undefined;
    }
    const timer = setInterval(() => {
      const nowMs = Date.now();
      setProgressBySessionId((prev) => pruneProgressSessions(prev, nowMs));
    }, 60_000);
    return () => {
      clearInterval(timer);
    };
  }, [isModMode]);

  useEffect(() => {
    if (isModMode) {
      return;
    }
    if (!pendingHighlightModel) return;
    const targetModel = pendingHighlightModel.toLowerCase();
    const matched = props.state.localRuntime.models.find((model) => {
      const modelName = String(model.model || '').trim().toLowerCase();
      const localModelId = String(model.localModelId || '').trim().toLowerCase();
      return modelName === targetModel || localModelId.includes(targetModel);
    });
    if (!matched) return;
    setHighlightLocalModelId(matched.localModelId);
    setPendingHighlightModel('');
  }, [isModMode, pendingHighlightModel, props.state.localRuntime.models]);

  useEffect(() => {
    if (isModMode) {
      return undefined;
    }
    if (!highlightLocalModelId) return;
    const timer = setTimeout(() => {
      setHighlightLocalModelId('');
    }, HIGHLIGHT_CLEAR_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [highlightLocalModelId, isModMode]);

  const sortedModels = useMemo(
    () => [...props.state.localRuntime.models].sort((left, right) => {
      const leftRank = parseTimestamp(left.installedAt) || parseTimestamp(left.updatedAt);
      const rightRank = parseTimestamp(right.installedAt) || parseTimestamp(right.updatedAt);
      if (leftRank !== rightRank) {
        return rightRank - leftRank;
      }
      return String(right.localModelId || '').localeCompare(String(left.localModelId || ''));
    }),
    [props.state.localRuntime.models],
  );

  const selectedDependencyTarget = useMemo(
    () => props.runtimeDependencyTargets.find((item) => item.modId === selectedDependencyModId) || null,
    [props.runtimeDependencyTargets, selectedDependencyModId],
  );

  const progressEvents = useMemo(
    () => Object.values(progressBySessionId)
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs)
      .slice(0, PROGRESS_SESSION_LIMIT)
      .map((item) => item.event),
    [progressBySessionId],
  );

  const activeFormModelProgress = useMemo(() => {
    const key = String(modelId || '').trim();
    if (!key) return null;
    return progressEvents.find((event) => event.modelId === key) || null;
  }, [modelId, progressEvents]);

  const toggleCapability = (capability: CapabilityOption) => {
    setSelectedCapabilities((prev) => {
      if (prev.includes(capability)) {
        if (prev.length === 1) return prev;
        return prev.filter((item) => item !== capability);
      }
      return [...prev, capability];
    });
  };

  const currentCapabilities = selectedCapabilities.length > 0 ? selectedCapabilities : ['chat'];

  const dependencySection = (
    <ModelCenterDependencySection
      isModMode={isModMode}
      loadingDependencyPlan={loadingDependencyPlan}
      selectedDependencyModId={selectedDependencyModId}
      dependencySelectionLocked={dependencySelectionLocked}
      selectedDependencyTarget={selectedDependencyTarget}
      selectedDependencyCapability={selectedDependencyCapability}
      dependencyPlanPreview={dependencyPlanPreview}
      runtimeDependencyTargets={props.runtimeDependencyTargets}
      onSetSelectedDependencyModId={setSelectedDependencyModId}
      onSetSelectedDependencyCapability={setSelectedDependencyCapability}
      onResolveDependencyPlanPreview={() => void resolveDependencyPlanPreview()}
      onApplyDependencies={props.onApplyDependencies}
    />
  );

  if (isModMode) {
    const modCapabilities = selectedDependencyTarget?.consumeCapabilities || [];
    const capabilityStatuses = modCapabilities.map((cap) => {
      const localNode = props.state.localRuntime.nodeMatrix.find(
        (node) => node.capability === cap && node.available,
      );
      const hasLocalModel = props.state.localRuntime.models.some(
        (model) => model.status === 'active' && model.capabilities.includes(cap),
      );
      const localAvailable = Boolean(localNode) || hasLocalModel;
      return { capability: cap, localAvailable };
    });
    const hasUnavailable = capabilityStatuses.some((item) => !item.localAvailable);
    return (
      <div className="space-y-4">
        <Card className="space-y-4 p-5">
          <div>
            <h4 className="text-sm font-semibold text-gray-900">
              {selectedDependencyTarget?.modName || selectedDependencyModId || 'Runtime Mod'}
            </h4>
            <p className="text-xs text-gray-500">Configure only this mod&apos;s declared model dependencies.</p>
          </div>
          {modCapabilities.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-700">AI Capability Status</p>
              <div className="flex flex-wrap gap-2">
                {capabilityStatuses.map((item) => (
                  <span
                    key={`mod-cap-status-${item.capability}`}
                    className={`rounded-md border px-2.5 py-1 text-[11px] font-medium ${
                      item.localAvailable
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                    }`}
                  >
                    {item.capability}: {item.localAvailable ? 'local-runtime' : 'needs setup'}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {dependencySection}
        </Card>
        {hasUnavailable ? (
          <Card className="space-y-2 border-amber-200 bg-amber-50 p-4">
            <p className="text-xs font-semibold text-amber-900">Setup Required</p>
            <p className="text-[11px] text-amber-800">
              Some capabilities are not available locally. Install a local model or configure a cloud API connector to enable them.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => props.onNavigateToSetup?.('models')}>
                Install Models
              </Button>
              <Button variant="ghost" size="sm" onClick={() => props.onNavigateToSetup?.('cloud-api')}>
                Configure Cloud API
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">Search & Install Models</h4>
          <p className="text-xs text-gray-500">Search the catalog or pick a verified model to install.</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={props.state.localRuntime.status} />
          <Button variant="secondary" size="sm" disabled={props.checkingHealth} onClick={() => void props.onHealthCheck()}>
            {props.checkingHealth ? 'Checking...' : 'Health'}
          </Button>
          <Button variant="secondary" size="sm" disabled={props.discovering} onClick={() => void props.onDiscover()}>
            {props.discovering ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>
      </div>

      <ModelCenterCatalogSection
        onInstallCatalogItem={props.onInstallCatalogItem}
        onInstallVerified={props.onInstallVerified}
        onPendingHighlightModel={setPendingHighlightModel}
      />

    </Card>

      {activeFormModelProgress ? (
        <div className="space-y-2 rounded-[10px] border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-700">
              Install Progress · {activeFormModelProgress.modelId} ({activeFormModelProgress.phase})
            </p>
            <p className={`text-[11px] ${activeFormModelProgress.done ? (activeFormModelProgress.success ? 'text-emerald-700' : 'text-rose-700') : 'text-gray-500'}`}>
              {activeFormModelProgress.done
                ? (activeFormModelProgress.success ? 'Completed' : 'Failed')
                : 'Running'}
            </p>
          </div>
          {typeof activeFormModelProgress.bytesTotal === 'number' && activeFormModelProgress.bytesTotal > 0 ? (
            <>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-full ${activeFormModelProgress.done && !activeFormModelProgress.success ? 'bg-rose-500' : 'bg-blue-500'}`}
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(100, Math.round((activeFormModelProgress.bytesReceived / activeFormModelProgress.bytesTotal) * 100)),
                    )}%`,
                  }}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-600">
                <span>{formatBytes(activeFormModelProgress.bytesReceived)} / {formatBytes(activeFormModelProgress.bytesTotal)}</span>
                <span>{formatSpeed(activeFormModelProgress.speedBytesPerSec)}</span>
                <span>ETA {formatEta(activeFormModelProgress.etaSeconds)}</span>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-gray-600">{formatBytes(activeFormModelProgress.bytesReceived)} downloaded</p>
          )}
          {activeFormModelProgress.message ? (
            <p className={`text-[11px] ${activeFormModelProgress.done && !activeFormModelProgress.success ? 'text-rose-700' : 'text-gray-500'}`}>
              {activeFormModelProgress.message}
            </p>
          ) : null}
        </div>
      ) : null}

      {progressEvents.length > 0 ? (
        <div className="space-y-1 rounded-[10px] border border-gray-200 bg-white p-3">
          <p className="text-xs font-semibold text-gray-700">Recent Install Sessions</p>
          <div className="space-y-1">
            {progressEvents.map((event) => (
              <p key={`install-session-${event.installSessionId}`} className="text-[11px] text-gray-500">
                {event.modelId} · {event.phase} · {event.done ? (event.success ? 'done' : 'failed') : 'running'}
              </p>
            ))}
          </div>
        </div>
      ) : null}

      <ModelCenterInstalledList
        sortedModels={sortedModels}
        highlightLocalModelId={highlightLocalModelId}
        onStart={props.onStart}
        onStop={props.onStop}
        onRestart={props.onRestart}
        onRemove={props.onRemove}
      />

      <Card className="p-3">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setAdvancedOpen((prev) => !prev)}
        >
          <p className="text-sm font-semibold text-gray-900">Advanced</p>
          <p className="text-xs text-gray-500">{advancedOpen ? 'Hide' : 'Show'}</p>
        </button>
        {advancedOpen ? (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Input label="Model ID" value={modelId} onChange={setModelId} placeholder="qwen2.5-7b-instruct" />
              <Input label="HF Repo" value={repo} onChange={setRepo} placeholder="org/model" />
              <Input label="Revision" value={revision} onChange={setRevision} placeholder="main" />
              <Input label="Engine" value={engine} onChange={setEngine} placeholder="localai" />
              <Input label="Entry (optional)" value={entry} onChange={setEntry} placeholder="model.gguf" />
              <Input label="License (optional)" value={license} onChange={setLicense} placeholder="apache-2.0" />
            </div>
            <div className="space-y-2 rounded-[10px] border border-gray-200 bg-gray-50 p-3">
              <p className="text-xs font-semibold text-gray-700">Capabilities</p>
              <div className="flex flex-wrap gap-2">
                {CAPABILITY_OPTIONS.map((capability) => (
                  <label
                    key={`capability-${capability}`}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700"
                  >
                    <input
                      type="checkbox"
                      checked={currentCapabilities.includes(capability)}
                      onChange={() => toggleCapability(capability)}
                      className="h-3.5 w-3.5"
                    />
                    <span>{capability}</span>
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-gray-500">Choose at least one capability. Install is blocked when none is selected.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                disabled={installing || !modelId.trim() || !repo.trim() || currentCapabilities.length === 0}
                onClick={() => {
                  void (async () => {
                    setInstalling(true);
                    try {
                      const installedModel = modelId.trim();
                      await props.onInstall({
                        modelId: installedModel,
                        repo: repo.trim(),
                        revision: revision.trim() || undefined,
                        engine: engine.trim() || undefined,
                        entry: entry.trim() || undefined,
                        license: license.trim() || undefined,
                        capabilities: currentCapabilities,
                      });
                      setPendingHighlightModel(installedModel);
                    } finally {
                      setInstalling(false);
                    }
                  })();
                }}
              >
                {installing ? 'Installing...' : 'Install from Hugging Face'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={importing}
                onClick={() => {
                  void (async () => {
                    setImporting(true);
                    try {
                      await props.onImport();
                    } finally {
                      setImporting(false);
                    }
                  })();
                }}
              >
                {importing ? 'Importing...' : 'Import from Local Manifest'}
              </Button>
            </div>
            <Input
              label="Local Runtime Endpoint"
              value={props.state.localRuntime.endpoint}
              onChange={props.onChangeLocalRuntimeEndpoint}
              placeholder="http://127.0.0.1:1234/v1"
            />
            <Input
              label="Search Discovered Models"
              value={props.localRuntimeModelQuery}
              onChange={props.onSetLocalRuntimeModelQuery}
              placeholder="Search by model name..."
            />
            <div>
              <p className="mb-1 text-xs font-semibold text-gray-700">Discovered Models</p>
              {renderModelChips(props.filteredLocalRuntimeModels, 'local-runtime-v11-advanced')}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
