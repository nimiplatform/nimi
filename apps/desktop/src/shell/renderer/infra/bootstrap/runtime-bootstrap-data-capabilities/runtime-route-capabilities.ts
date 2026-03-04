import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { asNimiError, createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import {
  normalizeCapabilityV11,
  normalizeSourceV11,
} from '@renderer/features/runtime-config/state/types';
import { localAiRuntime } from '@runtime/local-ai-runtime';
import { logRendererEvent } from '@nimiplatform/sdk/mod/logging';
import {
  WORLD_DATA_API_CAPABILITIES,
  toRecord,
} from '../runtime-bootstrap-utils';
import { registerCoreDataCapability } from './shared';

function safeLogRuntimeRouteOptionsQuery(payload: Parameters<typeof logRendererEvent>[0]): void {
  try {
    logRendererEvent(payload);
  } catch {
    // Diagnostics logging must not affect runtime-route options response.
  }
}

function normalizeCapability(value: unknown): 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' | null {
  const normalized = String(value || '').trim();
  if (
    normalized === 'chat'
    || normalized === 'image'
    || normalized === 'video'
    || normalized === 'tts'
    || normalized === 'stt'
    || normalized === 'embedding'
  ) {
    return normalized;
  }
  return null;
}

function inferSource(provider: string): 'local-runtime' | 'token-api' {
  const lower = String(provider || '').trim().toLowerCase();
  if (lower.startsWith('local-runtime') || lower === 'localai' || lower === 'nexa') {
    return 'local-runtime';
  }
  return 'token-api';
}

const LOCAL_RUNTIME_SNAPSHOT_TIMEOUT_MS = 1200;

async function pollLocalRuntimeSnapshotWithTimeout(): Promise<{
  models: Array<{
    localModelId: string;
    engine: string;
    modelId: string;
    endpoint: string;
    capabilities: string[];
    status: 'installed' | 'active' | 'unhealthy' | 'removed';
  }>;
  health: Array<unknown>;
  generatedAt: string;
}> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      localAiRuntime.pollSnapshot().catch((error) => {
        throw asNimiError(error, {
          reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
          actionHint: 'check_runtime_daemon_health',
          source: 'runtime',
        });
      }),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(createNimiError({
            message: `local runtime snapshot timed out after ${LOCAL_RUNTIME_SNAPSHOT_TIMEOUT_MS}ms`,
            reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
            actionHint: 'check_runtime_daemon_health',
            source: 'runtime',
          }));
        }, LOCAL_RUNTIME_SNAPSHOT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function registerRuntimeRouteDataCapabilities(): Promise<void> {
  await registerCoreDataCapability(WORLD_DATA_API_CAPABILITIES.runtimeRouteOptions, async (query) => {
    const payload = toRecord(query);
    const capability = normalizeCapabilityV11(payload.capability);
    const modId = String(payload.modId || '').trim();
    const runtime = useAppStore.getState().runtimeFields;
    const source = inferSource(runtime.provider);

    safeLogRuntimeRouteOptionsQuery({
      level: 'debug',
      area: 'renderer-bootstrap',
      message: 'action:runtime-route-options:query:start',
      details: {
        capability,
        modId: modId || null,
        selectedSource: source,
        selectedConnectorId: runtime.connectorId || null,
      },
    });

    try {
      const selected = {
        source: normalizeSourceV11(source),
        connectorId: String(runtime.connectorId || ''),
        model: String(runtime.localProviderModel || ''),
        localModelId: source === 'local-runtime' ? String(runtime.localProviderModel || '') : '',
        engine: source === 'local-runtime' ? 'localai' : '',
      };
      const resolvedDefault = { ...selected };

      // Load connectors from SDK
      const { sdkListConnectors } = await import(
        '@renderer/features/runtime-config/domain/provider-connectors/connector-sdk-service'
      );
      const sdkConnectors = await sdkListConnectors();
      const connectors = await Promise.all(sdkConnectors.map(async (connector) => {
        let sdkModels: string[] = [];
        let modelCapabilities: Record<string, string[]> = {};
        try {
          const { sdkListConnectorModelDescriptors } = await import(
            '@renderer/features/runtime-config/domain/provider-connectors/connector-sdk-service'
          );
          const descriptors = await sdkListConnectorModelDescriptors(
            connector.id,
            true,
          );
          sdkModels = descriptors.map((item) => item.modelId);
          modelCapabilities = descriptors.reduce<Record<string, string[]>>((accumulator, item) => {
            if (item.capabilities.length > 0) {
              accumulator[item.modelId] = item.capabilities;
            }
            return accumulator;
          }, {});
        } catch (error) {
          const normalized = asNimiError(error, {
            reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
            actionHint: 'check_connector_config',
            source: 'runtime',
          });
          safeLogRuntimeRouteOptionsQuery({
            level: 'warn',
            area: 'mods-test-diag',
            message: '[MODS-TEST-DIAG] runtime-route-options connector-models failed',
            details: {
              connectorId: connector.id,
              isSystemOwned: connector.isSystemOwned,
              reasonCode: normalized.reasonCode,
              actionHint: normalized.actionHint,
              traceId: normalized.traceId || null,
              retryable: normalized.retryable,
              message: normalized.message,
            },
          });
        }
        return {
          id: connector.id,
          label: connector.label || '',
          vendor: connector.vendor || '',
          endpoint: connector.endpoint || '',
          models: sdkModels,
          modelCapabilities,
          modelProfiles: [],
          status: connector.status || 'idle',
        };
      }));

      let snapshotModels: Array<{
        localModelId: string;
        engine: string;
        model: string;
        endpoint: string;
        capabilities: Array<'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding'>;
        status: 'installed' | 'active' | 'unhealthy' | 'removed';
      }> = [];
      try {
        const localSnapshot = await pollLocalRuntimeSnapshotWithTimeout();
        snapshotModels = localSnapshot.models
          .filter((item) => item.status !== 'removed')
          .map((item) => ({
            localModelId: item.localModelId,
            engine: item.engine,
            model: item.modelId,
            endpoint: item.endpoint,
            capabilities: item.capabilities
              .map((c) => normalizeCapability(c))
              .filter((c): c is 'chat' | 'image' | 'video' | 'tts' | 'stt' | 'embedding' => Boolean(c)),
            status: item.status,
          }));
      } catch (error) {
        const localRuntimeError = asNimiError(error, {
          reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
          actionHint: 'check_runtime_daemon_health',
          source: 'runtime',
        });
        if (selected.source === 'local-runtime') {
          throw localRuntimeError;
        }
        safeLogRuntimeRouteOptionsQuery({
          level: 'warn',
          area: 'renderer-bootstrap',
          message: 'action:runtime-route-options:local-runtime-snapshot:degraded',
          details: {
            capability,
            modId: modId || null,
            selectedSource: selected.source,
            reasonCode: localRuntimeError.reasonCode,
            actionHint: localRuntimeError.actionHint,
            traceId: localRuntimeError.traceId || null,
            retryable: localRuntimeError.retryable,
            message: localRuntimeError.message,
          },
        });
      }

      const response = {
        capability,
        modId: modId || null,
        selected,
        resolvedDefault,
        localRuntime: {
          endpoint: runtime.localProviderEndpoint || 'http://127.0.0.1:1234/v1',
          models: snapshotModels.map((item) => ({
            ...item,
            modelProfiles: [],
          })),
        },
        connectors,
      };

      safeLogRuntimeRouteOptionsQuery({
        level: 'debug',
        area: 'renderer-bootstrap',
        message: 'action:runtime-route-options:query:done',
        details: {
          capability,
          modId: modId || null,
          selectedSource: selected.source,
          connectorsCount: connectors.length,
        },
      });

      return response;
    } catch (error) {
      const normalized = asNimiError(error, {
        reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
        actionHint: 'check_runtime_config_connector_and_daemon',
        source: 'runtime',
      });
      safeLogRuntimeRouteOptionsQuery({
        level: 'error',
        area: 'renderer-bootstrap',
        message: 'action:runtime-route-options:query:failed',
        details: {
          capability,
          modId: modId || null,
          reasonCode: normalized.reasonCode,
          actionHint: normalized.actionHint,
          traceId: normalized.traceId || null,
          retryable: normalized.retryable,
          message: normalized.message,
        },
      });
      throw normalized;
    }
  });
}
