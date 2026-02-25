import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import type { RuntimeFieldMap } from '@renderer/app-shell/providers/app-store';
import {
  DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11,
  normalizeEndpointV11,
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/state/v11/types';
import { getRecommendedChatModelV11, setInitializedByV11 } from '@renderer/features/runtime-config/state/v11/storage';

type RouteInitEffectInput = {
  state: RuntimeConfigStateV11 | null;
  setState: Dispatch<SetStateAction<RuntimeConfigStateV11 | null>>;
  setRuntimeFields: (updates: Partial<RuntimeFieldMap>) => void;
};

export function useRuntimeConfigRouteInitEffect(input: RouteInitEffectInput) {
  useEffect(() => {
    if (!input.state) return;
    if (input.state.initializedByV11) return;
    if (input.state.selectedSource !== 'local-runtime') return;

    const model = getRecommendedChatModelV11(input.state);
    if (!model) return;

    input.setRuntimeFields({
      provider: `local-runtime:localai:openai_compat_adapter:${model}`,
      runtimeModelType: 'chat',
      localProviderEndpoint: normalizeEndpointV11(input.state.localRuntime.endpoint, DEFAULT_LOCAL_RUNTIME_ENDPOINT_V11),
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
        source: 'local-runtime',
        model,
        reason: 'auto-init',
      },
    });
  }, [input.setRuntimeFields, input.setState, input.state]);
}
