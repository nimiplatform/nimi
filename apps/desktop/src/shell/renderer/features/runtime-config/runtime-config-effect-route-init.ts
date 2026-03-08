import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/app-store';
import {
  DEFAULT_LOCAL_ENDPOINT_V11,
  normalizeEndpointV11,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import { setInitializedByV11 } from '@renderer/features/runtime-config/runtime-config-storage-persist';
import { getRecommendedChatModelV11 } from '@renderer/features/runtime-config/runtime-config-storage-summary';

type RouteInitEffectInput = {
  state: RuntimeConfigStateV11 | null;
  setState: Dispatch<SetStateAction<RuntimeConfigStateV11 | null>>;
  setRuntimeFields: (updates: Partial<RuntimeFieldMap>) => void;
};

export function useRuntimeConfigRouteInitEffect(input: RouteInitEffectInput) {
  useEffect(() => {
    if (!input.state) return;
    if (input.state.initializedByV11) return;
    if (input.state.selectedSource !== 'local') return;

    const model = getRecommendedChatModelV11(input.state);
    if (!model) return;
    const matchedModel = input.state.local.models.find((item) => item.model === model) || null;
    const provider = String(matchedModel?.engine || 'localai').trim() || 'localai';

    input.setRuntimeFields({
      provider,
      runtimeModelType: 'chat',
      localProviderEndpoint: normalizeEndpointV11(input.state.local.endpoint, DEFAULT_LOCAL_ENDPOINT_V11),
      localProviderModel: model,
    });

    input.setState((prev) => (prev ? setInitializedByV11(prev) : prev));

    const flowId = createRendererFlowId('runtime-config');
    logRendererEvent({
      area: 'renderer-bootstrap',
      message: 'runtime-config:capability-binding:applied',
      flowId,
      details: {
        capability: 'chat',
        source: 'local',
        model,
        reason: 'auto-init',
      },
    });
  }, [input.setRuntimeFields, input.setState, input.state]);
}
