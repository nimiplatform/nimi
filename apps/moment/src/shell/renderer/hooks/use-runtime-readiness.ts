import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPlatformClient } from '@nimiplatform/sdk';
import { getDaemonStatus, startDaemon } from '@renderer/bridge/runtime-daemon.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { loadRuntimeTargetCatalog, pickDefaultRuntimeTargetOption } from '@renderer/features/moment/runtime-targets.js';

type RuntimeProbeResult = {
  running: boolean;
  issues: string[];
  realmConfigured: boolean;
  realmAuthenticated: boolean;
  textDefaultTargetKey?: string;
  textConnectorId?: string;
  textModelId?: string;
  visionDefaultTargetKey?: string;
  visionConnectorId?: string;
  visionModelId?: string;
  textTargets: ReturnType<typeof useAppStore.getState>['runtimeProbe']['textTargets'];
  visionTargets: ReturnType<typeof useAppStore.getState>['runtimeProbe']['visionTargets'];
  error?: string;
};

async function ensureRuntimeReady(): Promise<RuntimeProbeResult> {
  const runtimeDefaults = useAppStore.getState().runtimeDefaults;
  let realmConfigured = false;
  let realmAuthenticated = false;

  try {
    await getPlatformClient().realm.ready({ timeoutMs: 4_000 });
    realmConfigured = true;
    realmAuthenticated = true;
  } catch {
    const baseUrl = useAppStore.getState().runtimeDefaults?.realm.realmBaseUrl || '';
    realmConfigured = Boolean(baseUrl);
  }

  let daemon = await getDaemonStatus();
  if (!daemon.running) {
    try {
      daemon = await startDaemon();
    } catch (error) {
      return {
        running: false,
        realmConfigured,
        realmAuthenticated,
        textTargets: [],
        visionTargets: [],
        issues: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (!daemon.running) {
    return {
      running: false,
      realmConfigured,
      realmAuthenticated,
      textTargets: [],
      visionTargets: [],
      issues: [],
      error: daemon.lastError || 'Runtime daemon is unavailable.',
    };
  }

  const issues: string[] = [];
  let textTargets: RuntimeProbeResult['textTargets'] = [];
  let visionTargets: RuntimeProbeResult['visionTargets'] = [];
  let textDefaultTargetKey = '';
  let textConnectorId = '';
  let textModelId = '';
  let visionDefaultTargetKey = '';
  let visionConnectorId = '';
  let visionModelId = '';

  try {
    const runtime = getPlatformClient().runtime;
    await runtime.ready();
    const [textCatalog, visionCatalog] = await Promise.all([
      loadRuntimeTargetCatalog(runtime, 'text.generate'),
      loadRuntimeTargetCatalog(runtime, 'text.generate.vision'),
    ]);

    textTargets = textCatalog.options;
    visionTargets = visionCatalog.options;
    issues.push(
      ...textCatalog.issues.map((issue) => issue.message),
      ...visionCatalog.issues.map((issue) => issue.message),
    );

    const targetPreference = {
      connectorId: runtimeDefaults?.runtime.connectorId,
      provider: runtimeDefaults?.runtime.provider,
      modelId: undefined,
      localModelId: runtimeDefaults?.runtime.localProviderModel,
    };
    const defaultTextTarget = pickDefaultRuntimeTargetOption(textTargets, targetPreference);
    const defaultVisionTarget = pickDefaultRuntimeTargetOption(visionTargets, targetPreference);

    textDefaultTargetKey = defaultTextTarget?.key || '';
    textConnectorId = defaultTextTarget?.connectorId || '';
    textModelId = defaultTextTarget?.modelId || '';
    visionDefaultTargetKey = defaultVisionTarget?.key || '';
    visionConnectorId = defaultVisionTarget?.connectorId || '';
    visionModelId = defaultVisionTarget?.modelId || '';
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  if (!textModelId) {
    issues.push('No text.generate target is currently available.');
  }

  return {
    running: true,
    issues,
    realmConfigured,
    realmAuthenticated,
    textDefaultTargetKey: textDefaultTargetKey || undefined,
    textConnectorId: textConnectorId || undefined,
    textModelId: textModelId || undefined,
    visionDefaultTargetKey: visionDefaultTargetKey || undefined,
    visionConnectorId: visionConnectorId || undefined,
    visionModelId: visionModelId || undefined,
    textTargets,
    visionTargets,
  };
}

export function useRuntimeReadiness() {
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const authStatus = useAppStore((state) => state.auth.status);
  const authUserId = useAppStore((state) => state.auth.user?.id || '');
  const setRuntimeStatus = useAppStore((state) => state.setRuntimeStatus);
  const setRuntimeProbe = useAppStore((state) => state.setRuntimeProbe);

  const query = useQuery({
    queryKey: ['moment', 'runtime-ready', bootstrapReady, authStatus, authUserId],
    queryFn: ensureRuntimeReady,
    enabled: bootstrapReady,
    retry: 2,
    retryDelay: 1_000,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!bootstrapReady) {
      setRuntimeStatus('checking');
      return;
    }
    if (query.isLoading) {
      setRuntimeStatus('checking');
      return;
    }
    if (query.data) {
      setRuntimeProbe({
        realmConfigured: query.data.realmConfigured,
        realmAuthenticated: query.data.realmAuthenticated,
        textDefaultTargetKey: query.data.textDefaultTargetKey,
        textConnectorId: query.data.textConnectorId,
        textModelId: query.data.textModelId,
        visionDefaultTargetKey: query.data.visionDefaultTargetKey,
        visionConnectorId: query.data.visionConnectorId,
        visionModelId: query.data.visionModelId,
        textTargets: query.data.textTargets,
        visionTargets: query.data.visionTargets,
        issues: query.data.issues,
      });
      if (!query.data.running) {
        setRuntimeStatus('unavailable', query.data.error);
      } else if (query.data.issues.length > 0) {
        setRuntimeStatus('degraded');
      } else {
        setRuntimeStatus('ready');
      }
      return;
    }
    if (query.error) {
      setRuntimeStatus('unavailable', query.error instanceof Error ? query.error.message : String(query.error));
    }
  }, [bootstrapReady, query.data, query.error, query.isLoading, setRuntimeProbe, setRuntimeStatus]);

  return query;
}
