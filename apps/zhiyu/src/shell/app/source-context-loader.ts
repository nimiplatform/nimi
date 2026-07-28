import {
  createNimiRuntimeAgentConsumeClient,
} from '@nimiplatform/sdk/runtime';
import {
  withZhiyuRuntimeAgentAccessRequired,
} from '../agent-chat/runtime-agent-access';
import { projectZhiyuRuntimeSourceProjection } from '../agent/source-projection';
import { getZhiyuRuntime } from '../auth/runtime-platform';
import type { ZhiyuEvidence } from './evidence';

export async function loadZhiyuSourceContextProjection(identity: {
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly localAgentRef: string;
  readonly conversationAnchorId: string;
}): Promise<ZhiyuEvidence['source']> {
  const runtime = getZhiyuRuntime();
  const consume = createNimiRuntimeAgentConsumeClient({
    runtime: { agents: runtime.agents, appMessages: runtime.appMessages },
    runtimeAppId: 'nimi.zhiyu',
  });
  const snapshot = await withZhiyuRuntimeAgentAccessRequired(
    ['runtime.agent.turn.read'],
    (callOptions) => (
      consume.anchors.getSnapshot({
        ...identity,
        subjectUserId: identity.ownerUserId,
      }, callOptions)
    ),
  );
  return projectZhiyuRuntimeSourceProjection({
    ownerUserId: identity.ownerUserId,
    runtimeSourceRef: identity.runtimeSourceRef,
    localAgentRef: identity.localAgentRef,
    sourceContextStatus: snapshot.sourceContextStatus ?? null,
    turnContextSummary: snapshot.turnContextSummary ?? null,
  });
}
