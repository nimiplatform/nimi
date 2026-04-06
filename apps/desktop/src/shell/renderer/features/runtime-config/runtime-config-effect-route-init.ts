import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import {
  type RuntimeConfigStateV11,
} from '@renderer/features/runtime-config/runtime-config-state-types';
import { setInitializedByV11 } from '@renderer/features/runtime-config/runtime-config-storage-persist';
import { getRecommendedChatModelV11 } from '@renderer/features/runtime-config/runtime-config-storage-summary';
import type { ConversationCapability } from '@renderer/features/chat/conversation-capability';
import type { RuntimeRouteBinding } from '@nimiplatform/sdk/mod';

type RouteInitEffectInput = {
  state: RuntimeConfigStateV11 | null;
  setState: Dispatch<SetStateAction<RuntimeConfigStateV11 | null>>;
  setConversationCapabilityBinding: (
    capability: ConversationCapability,
    binding: RuntimeRouteBinding | null | undefined,
  ) => void;
};

export function useRuntimeConfigRouteInitEffect(input: RouteInitEffectInput) {
  useEffect(() => {
    if (!input.state) return;
    if (input.state.initializedByV11) return;
    if (input.state.selectedSource !== 'local') return;

    const model = getRecommendedChatModelV11(input.state);
    if (!model) return;
    input.setConversationCapabilityBinding('text.generate', {
      source: 'local',
      connectorId: '',
      model,
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
  }, [input.setConversationCapabilityBinding, input.setState, input.state]);
}
