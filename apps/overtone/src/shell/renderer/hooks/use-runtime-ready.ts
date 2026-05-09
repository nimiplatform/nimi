import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPlatformClient } from '@nimiplatform/sdk';
import { ExecutionMode, ScenarioType } from '@nimiplatform/sdk/runtime';
import { getDaemonStatus, startDaemon } from '@renderer/bridge/runtime-bridge';
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

// Realm connection / authentication state is owned by the Overtone bootstrap
// (see apps/overtone/src/shell/renderer/infra/bootstrap/overtone-bootstrap.ts).
// The bootstrap calls setRealmConnection(...) and setAuthSession(...) based
// on `runtime.account.getAccountSessionStatus`. This hook is read-only with
// respect to realm auth state; it only contributes runtime daemon + AI
// capability probe results.
function snapshotRealmStateFromStore(): {
  realmConfigured: boolean;
  realmAuthenticated: boolean;
} {
  const state = useAppStore.getState();
  return {
    realmConfigured: state.realmConfigured,
    realmAuthenticated: state.realmAuthenticated,
  };
}

async function ensureRuntimeReady(): Promise<RuntimeProbeResult> {
  const realm = snapshotRealmStateFromStore();
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
  if (realm.realmConfigured && !realm.realmAuthenticated) {
    issues.push('Realm session not yet established. Sign in to continue.');
  }
  if (!realm.realmConfigured) {
    issues.push('Realm is not configured. Set VITE_NIMI_REALM_BASE_URL.');
  }
  let textConnectorId: string | undefined;
  let textModelId: string | undefined;
  let musicConnectorId: string | undefined;
  let musicModelId: string | undefined;
  let musicIterationSupported = false;

  try {
    const runtime = getPlatformClient().runtime;
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
  const realmConfigured = useAppStore((state) => state.realmConfigured);
  const realmAuthenticated = useAppStore((state) => state.realmAuthenticated);

  const query = useQuery({
    // Re-probe when realm auth state flips so the runtime probe reflects
    // post-login readiness.
    queryKey: ['runtime', 'ready', realmConfigured, realmAuthenticated],
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
  }, [query.data, query.error, query.isLoading, setReadiness, setRuntimeStatus]);

  return query;
}
