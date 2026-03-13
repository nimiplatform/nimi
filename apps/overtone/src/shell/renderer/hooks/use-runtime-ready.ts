import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExecutionMode, ScenarioType } from '@nimiplatform/sdk/runtime';
import { getDaemonStatus, startDaemon } from '@renderer/bridge/runtime-bridge.js';
import { clearRealmInstance, initRealmInstance } from '@renderer/bridge/realm-sdk.js';
import { getRuntimeInstance } from '@renderer/bridge/runtime-sdk.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';

type RuntimeProbeResult = {
  running: boolean;
  realmConfigured: boolean;
  realmAuthenticated: boolean;
  textConnectorId?: string;
  textModelId?: string;
  musicConnectorId?: string;
  musicModelId?: string;
  musicIterationSupported: boolean;
  issues: string[];
  error?: string;
};

async function syncRealmFromEnv(): Promise<{
  realmConfigured: boolean;
  realmAuthenticated: boolean;
  realmIssue?: string;
}> {
  const baseUrl = String(import.meta.env.VITE_NIMI_REALM_BASE_URL || '').trim();
  const accessToken = String(import.meta.env.VITE_NIMI_REALM_ACCESS_TOKEN || '').trim();
  if (!baseUrl || !accessToken) {
    clearRealmInstance();
    return {
      realmConfigured: false,
      realmAuthenticated: false,
    };
  }
  const realm = initRealmInstance(baseUrl, accessToken);

  try {
    await realm.ready({ timeoutMs: 5_000 });
    return {
      realmConfigured: true,
      realmAuthenticated: true,
    };
  } catch {
    return {
      realmConfigured: true,
      realmAuthenticated: false,
      realmIssue: 'Realm authentication probe failed. Check your access token.',
    };
  }
}

async function ensureRuntimeReady(): Promise<RuntimeProbeResult> {
  const realm = await syncRealmFromEnv();
  let status = await getDaemonStatus();

  if (!status.running) {
    try {
      status = await startDaemon();
    } catch (error: unknown) {
      return {
        running: false,
        error: error instanceof Error ? error.message : String(error),
        issues: [],
        musicIterationSupported: false,
        ...realm,
      };
    }
  }

  if (!status.running) {
    return {
      running: false,
      error: status.lastError ?? 'Daemon failed to start',
      issues: [],
      musicIterationSupported: false,
      ...realm,
    };
  }

  const issues: string[] = [];
  if (realm.realmIssue) {
    issues.push(realm.realmIssue);
  }
  let textConnectorId: string | undefined;
  let textModelId: string | undefined;
  let musicConnectorId: string | undefined;
  let musicModelId: string | undefined;
  let musicIterationSupported = false;

  try {
    const runtime = getRuntimeInstance();
    await runtime.ready();

    const profiles = await runtime.ai.listScenarioProfiles({ modelId: '' });
    const textScenarioSupported = profiles.profiles.some((profile) =>
      profile.scenarioType === ScenarioType.TEXT_GENERATE,
    );
    const musicScenarioSupported = profiles.profiles.some((profile) =>
      profile.scenarioType === ScenarioType.MUSIC_GENERATE
      && profile.supportedExecutionModes.includes(ExecutionMode.ASYNC_JOB),
    );

    if (!textScenarioSupported) {
      issues.push('Runtime does not expose a text generation scenario profile.');
    }
    if (!musicScenarioSupported) {
      issues.push('Runtime does not expose an async music generation scenario profile.');
    }

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
        if (!textConnectorId && model.capabilities.includes('text.generate')) {
          textConnectorId = connector.connectorId;
          textModelId = model.modelId;
        }
        if (!musicConnectorId && model.capabilities.includes('music.generate')) {
          musicConnectorId = connector.connectorId;
          musicModelId = model.modelId;
          musicIterationSupported = model.capabilities.includes('music.generate.iteration');
        }
      }
    }

    if (!textConnectorId || !textModelId) {
      issues.push('No text connector/model pair is currently available.');
    }
    if (!musicConnectorId || !musicModelId) {
      issues.push('No music connector/model pair is currently available.');
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    issues.push(`Runtime probe failed: ${errorMessage}`);
  }

  return {
    running: true,
    textConnectorId,
    textModelId,
    musicConnectorId,
    musicModelId,
    musicIterationSupported,
    issues,
    ...realm,
  };
}

export function useRuntimeReady() {
  const setRuntimeStatus = useAppStore((state) => state.setRuntimeStatus);
  const setReadiness = useAppStore((state) => state.setReadiness);
  const setRealmConnection = useAppStore((state) => state.setRealmConnection);

  const query = useQuery({
    queryKey: ['runtime', 'ready'],
    queryFn: ensureRuntimeReady,
    retry: 2,
    retryDelay: 1000,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (query.isLoading) {
      setRuntimeStatus('checking');
      return;
    }
    if (query.data) {
      setRealmConnection(query.data.realmConfigured, query.data.realmAuthenticated);
      setReadiness({
        textConnectorId: query.data.textConnectorId,
        textModelId: query.data.textModelId,
        musicConnectorId: query.data.musicConnectorId,
        musicModelId: query.data.musicModelId,
        musicIterationSupported: query.data.musicIterationSupported,
        issues: query.data.issues,
      });
      if (!query.data.running) {
        setRuntimeStatus('unavailable', query.data.error);
        return;
      }
      setRuntimeStatus(query.data.issues.length === 0 ? 'ready' : 'degraded');
      return;
    }
    if (query.error) {
      setRuntimeStatus(
        'unavailable',
        query.error instanceof Error ? query.error.message : String(query.error),
      );
    }
  }, [query.data, query.error, query.isLoading, setReadiness, setRealmConnection, setRuntimeStatus]);

  return query;
}
