import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import type { RuntimeConfigStateV11 } from '@renderer/features/runtime-config/state/v11/types';
import type { StatusBanner } from '@renderer/app-shell/providers/app-store';
import type { RuntimeConfigStateUpdater } from '../../runtime-config-types';
import { discoverConnectorModelsAndHealth } from './discovery';

export async function runSelectedConnectorTestCommand(input: {
  state: RuntimeConfigStateV11;
  selectedConnector: RuntimeConfigStateV11['connectors'][number];
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (banner: StatusBanner | null) => void;
}) {
  const flowId = createRendererFlowId('runtime-config-connector');
  const {
    endpoint,
    discovered,
    health,
    normalizedStatus,
  } = await discoverConnectorModelsAndHealth({
    state: input.state,
    connector: input.selectedConnector,
  });

  input.updateState((prev) => ({
    ...prev,
    connectors: prev.connectors.map((connector) => {
      if (connector.id !== input.selectedConnector.id) return connector;
      return {
        ...connector,
        endpoint,
        models: discovered,
        status: normalizedStatus,
        lastCheckedAt: health.checkedAt,
        lastDetail: health.detail,
      };
    }),
  }));

  logRendererEvent({
    area: 'renderer-bootstrap',
    message: 'runtime-config:connector-test',
    flowId,
    details: {
      connectorId: input.selectedConnector.id,
      vendor: input.selectedConnector.vendor,
      modelCount: discovered.length,
      health: health.status,
      success: health.status === 'healthy',
      discoveryOk: true,
    },
  });

  if (health.status === 'healthy') {
    input.setStatusBanner({
      kind: 'success',
      message: `${input.selectedConnector.label} test passed (${discovered.length} models)`,
    });
    return;
  }

  input.setStatusBanner({
    kind: 'warning',
    message: `${input.selectedConnector.label} models discovered (${discovered.length}) but health is ${health.status}`,
  });
}

export function markSelectedConnectorTestFailedCommand(input: {
  state: RuntimeConfigStateV11;
  selectedConnector: RuntimeConfigStateV11['connectors'][number];
  updateState: RuntimeConfigStateUpdater;
  setStatusBanner: (banner: StatusBanner | null) => void;
  error: unknown;
}) {
  const flowId = createRendererFlowId('runtime-config-connector');
  const errorText = input.error instanceof Error ? input.error.message : String(input.error || '');

  input.updateState((prev) => ({
    ...prev,
    connectors: prev.connectors.map((connector) => {
      if (connector.id !== input.selectedConnector.id) return connector;
      return {
        ...connector,
        status: 'unreachable',
        lastCheckedAt: new Date().toISOString(),
        lastDetail: errorText,
      };
    }),
  }));

  logRendererEvent({
    level: 'warn',
    area: 'renderer-bootstrap',
    message: 'runtime-config:connector-test',
    flowId,
    details: {
      connectorId: input.selectedConnector.id,
      vendor: input.selectedConnector.vendor,
      success: false,
      error: errorText,
    },
  });

  input.setStatusBanner({ kind: 'error', message: `Connector test failed: ${errorText}` });
}
