import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import {
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import { setInitializedByV11 } from '@renderer/features/runtime-config/runtime-config-storage-persist';

type RouteInitEffectInput = {
  state: RuntimeConfigStateV11 | null;
  setState: Dispatch<SetStateAction<RuntimeConfigStateV11 | null>>;
};

export function useRuntimeConfigRouteInitEffect(input: RouteInitEffectInput) {
  useEffect(() => {
    if (!input.state) return;
    if (input.state.initializedByV11) return;
    input.setState((prev) => (prev ? setInitializedByV11(prev) : prev));

    const flowId = createRendererFlowId('runtime-config');
    logRendererEvent({
      area: 'renderer-bootstrap',
      message: 'runtime-config:capability-binding:applied',
      flowId,
      details: {
        capability: 'chat',
        source: input.state.selectedSource,
        reason: 'v11-init-marker-only',
      },
    });
  }, [input.setState, input.state]);
}
