import {
  createNimiRuntimeAgentConsumeClient,
  Runtime,
} from '@nimiplatform/sdk/runtime';
import {
  resolveZhiyuRuntimeAgentBindingDecisionFromHost,
  scopedBindingForRuntimeAgentRequest,
  withZhiyuRuntimeAgentBindingRequired,
} from '../agent-chat/runtime-agent-binding';
import { projectZhiyuRuntimeSourceProjection } from '../agent/source-projection';
import type { ZhiyuEvidence } from './evidence';

export async function loadZhiyuSourceContextProjection(identity: {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId: string;
}): Promise<ZhiyuEvidence['source']> {
  const runtime = new Runtime({
    appId: 'nimi.zhiyu',
    transport: { type: 'electron-ipc' },
  });
  const consume = createNimiRuntimeAgentConsumeClient({
    runtime: { agents: runtime.agents, appMessages: runtime.appMessages },
    runtimeAppId: 'nimi.zhiyu',
  });
  const snapshot = await withZhiyuRuntimeAgentBindingRequired(
    ['runtime.agent.turn.read'],
    async (callOptions) => {
      const binding = resolveZhiyuRuntimeAgentBindingDecisionFromHost(['runtime.agent.turn.read']);
      return consume.anchors.getSnapshot({
        ...identity,
        subjectUserId: identity.ownerUserId,
        scopedBinding: scopedBindingForRuntimeAgentRequest(binding),
      }, callOptions);
    },
  );
  return projectZhiyuRuntimeSourceProjection({
    ownerUserId: identity.ownerUserId,
    runtimeSourceRef: identity.runtimeSourceRef,
    localAgentRef: identity.localAgentRef,
    sourceContextStatus: snapshot.sourceContextStatus ?? null,
    turnContextSummary: snapshot.turnContextSummary ?? null,
  });
}
