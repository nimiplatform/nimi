import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPlatformClient } from '@nimiplatform/sdk';
import { getDaemonStatus, startDaemon } from '@renderer/bridge/runtime-daemon.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';

type RuntimeProbeResult = {
  running: boolean;
  issues: string[];
  realmConfigured: boolean;
  realmAuthenticated: boolean;
  imageConnectorId?: string;
  imageModelId?: string;
  visionConnectorId?: string;
  visionModelId?: string;
  error?: string;
};

async function ensureRuntimeReady(): Promise<RuntimeProbeResult> {
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
      issues: [],
      error: daemon.lastError || 'Runtime daemon is unavailable.',
    };
  }

  const issues: string[] = [];
  let imageConnectorId = '';
  let imageModelId = '';
  let visionConnectorId = '';
  let visionModelId = '';

  try {
    const runtime = getPlatformClient().runtime;
    await runtime.ready();
    const connectors = await runtime.connector.listConnectors({
      pageSize: 100,
      pageToken: '',
      kindFilter: 0,
      statusFilter: 0,
      providerFilter: '',
    });

    for (const connector of connectors.connectors) {
      const models = await runtime.connector.listConnectorModels({
        connectorId: connector.connectorId,
        forceRefresh: false,
        pageSize: 100,
        pageToken: '',
      }).catch(() => null);
      if (!models) {
        continue;
      }
      for (const model of models.models) {
        if (!model.available) {
          continue;
        }
        if (!imageModelId && model.capabilities.includes('image.generate')) {
          imageConnectorId = connector.connectorId;
          imageModelId = model.modelId;
        }
        if (!visionModelId && model.capabilities.includes('text.generate.vision')) {
          visionConnectorId = connector.connectorId;
          visionModelId = model.modelId;
        }
      }
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  if (!imageModelId) {
    issues.push('No image.generate target is currently available.');
  }
  if (!visionModelId) {
    issues.push('No text.generate.vision target is currently available.');
  }

  return {
    running: true,
    issues,
    realmConfigured,
    realmAuthenticated,
    imageConnectorId: imageConnectorId || undefined,
    imageModelId: imageModelId || undefined,
    visionConnectorId: visionConnectorId || undefined,
    visionModelId: visionModelId || undefined,
  };
}

export function useRuntimeReadiness() {
  const setRuntimeStatus = useAppStore((state) => state.setRuntimeStatus);
  const setRuntimeProbe = useAppStore((state) => state.setRuntimeProbe);

  const query = useQuery({
    queryKey: ['lookdev', 'runtime-ready'],
    queryFn: ensureRuntimeReady,
    retry: 2,
    retryDelay: 1_000,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (query.isLoading) {
      setRuntimeStatus('checking');
      return;
    }
    if (query.data) {
      setRuntimeProbe({
        realmConfigured: query.data.realmConfigured,
        realmAuthenticated: query.data.realmAuthenticated,
        imageConnectorId: query.data.imageConnectorId,
        imageModelId: query.data.imageModelId,
        visionConnectorId: query.data.visionConnectorId,
        visionModelId: query.data.visionModelId,
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
  }, [query.data, query.error, query.isLoading, setRuntimeProbe, setRuntimeStatus]);

  return query;
}
