import { createRendererFlowId, logRendererEvent } from '@nimiplatform/kit/telemetry';
import {
  formatNimiRuntimeErrorDetail as formatRuntimeConfigErrorDetail,
} from '@nimiplatform/sdk/runtime';
import type { RuntimeConfigStateV11 } from './runtime-config-state-types';
import type { InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import type { RuntimeConfigStateUpdater } from './runtime-config-types';
import { checkConnectorHealth } from './runtime-config-connector-discovery';
import type { RuntimeConfigConnectorSdkService } from './runtime-config-connector-sdk-service.js';
import { replaceConnectorsInState } from './runtime-config-connector-actions.js';
import type { TFunction } from 'i18next';
import { humanizeConnectorError } from './runtime-config-connector-error-copy.js';

function connectorTestFailureKind(status: string): InlineFeedbackState['kind'] {
  return status === 'degraded' ? 'warning' : 'error';
}

export async function runSelectedConnectorTestCommand(input: {
  t: TFunction;
  state: RuntimeConfigStateV11;
  selectedConnector: RuntimeConfigStateV11['connectors'][number];
  connectorSdk: RuntimeConfigConnectorSdkService;
  now: () => number;
  updateState: RuntimeConfigStateUpdater;
  setControlFeedback: (banner: InlineFeedbackState | null) => void;
}) {
  const flowId = createRendererFlowId('runtime-config-connector');
  const {
    endpoint,
    configurationVersion,
    health,
    normalizedStatus,
  } = await checkConnectorHealth({
    connector: input.selectedConnector,
    connectorSdk: input.connectorSdk,
    now: input.now,
  });

  input.updateState((prev) => ({
    ...prev,
    connectors: prev.connectors.map((connector) => {
      if (connector.id !== input.selectedConnector.id) return connector;
      // A completed check belongs to its captured configuration and observation.
      // A delayed renderer response cannot revive it after an owner update.
      if (connector.configurationVersion !== configurationVersion
        || (connector.lastCheckedAt && Date.parse(connector.lastCheckedAt) > Date.parse(health.checkedAt))) return connector;
      return {
        ...connector,
        endpoint,
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
      health: health.status,
      success: health.status === 'healthy',
    },
  });

  if (health.status !== 'healthy') {
    input.setControlFeedback({
      kind: connectorTestFailureKind(health.status),
      message: humanizeConnectorError(health.detail, input.t, 'check'),
      technicalDetail: health.detail || undefined,
    });
    return;
  }

  input.setControlFeedback({
    kind: 'success',
    message: input.t('runtimeConfig.product.connectionCheckPassed', { name: input.selectedConnector.label }),
  });
}

export async function markSelectedConnectorTestFailedCommand(input: {
  t: TFunction;
  state: RuntimeConfigStateV11;
  selectedConnector: RuntimeConfigStateV11['connectors'][number];
  now: () => number;
  updateState: RuntimeConfigStateUpdater;
  setControlFeedback: (banner: InlineFeedbackState | null) => void;
  error: unknown;
  connectorSdk: RuntimeConfigConnectorSdkService;
}) {
  const flowId = createRendererFlowId('runtime-config-connector');
  const errorText = formatRuntimeConfigErrorDetail(input.error);

  try {
    const connectors = await input.connectorSdk.sdkListConnectors();
    input.updateState(prev => replaceConnectorsInState(prev, [...connectors, ...prev.connectors.filter(connector => connector.isDraft)]));
  } catch {
    // A failed owner read cannot manufacture a new connection observation.
  }

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

  input.setControlFeedback({
    kind: 'error',
    message: humanizeConnectorError(errorText, input.t, 'check'),
    technicalDetail: errorText,
  });
}
