import {
  createNimiCanonicalRendererHostBindings,
  type NimiRendererHostFacadeV1,
  type NimiRendererHostMethodMap,
} from '@nimiplatform/kit/shell/renderer/host';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppConversationClient,
} from '@nimiplatform/sdk/app';
import type { AvatarHostHandoffPort } from '@nimiplatform/kit/features/avatar/headless';

import type { ZhiyuCanonicalRendererBindings, ZhiyuHomeProjection } from '../renderer/contract.js';
import {
  probeZhiyuRuntimeAgentInventory,
} from '../shell/agent/agent-inventory.js';
import { probeZhiyuRuntimeCompanionState } from '../shell/agent/companion-state.js';
import { probeZhiyuRuntimeConversationHome } from '../shell/agent/conversation-home.js';
import { remintZhiyuConversationSelection } from '../shell/agent/conversation-selection-remint.js';
import { probeZhiyuRuntimeDelegationUx } from '../shell/agent/delegation-ux.js';
import { resolveZhiyuRuntimeLocalAgentSelection } from '../shell/agent/local-agent-selection.js';
import type { ZhiyuLocalAgentStatus } from '../shell/agent/local-agent-status.js';
import { projectZhiyuProposalIntakeStatus } from '../shell/agent/proposal-intake.js';
import { projectZhiyuRuntimeSourceProjection } from '../shell/agent/source-projection.js';
import { probeZhiyuAgentTurnReadiness } from '../shell/agent-chat/agent-turn-readiness.js';
import { runZhiyuAgentChatTurn, zhiyuArtifactDataUrl } from '../shell/agent-chat/runtime-agent-turn-adapter.js';
import { probeZhiyuAvatarPresence } from '../shell/avatar/avatar-presence.js';
import { createZhiyuAvatarHostHandoffPort } from '../shell/avatar/avatar-host-handoff-port.js';
import { launchZhiyuAvatar } from '../shell/avatar/avatar-launch-handoff.js';
import { probeZhiyuRuntimeAccountStatus } from '../shell/auth/runtime-account-status.js';
import { getZhiyuLocalAppClient } from '../shell/auth/runtime-platform.js';
import {
  requestZhiyuDesktopOpenRuntimeSettings,
  requestZhiyuDesktopOpenSelectPartner,
} from '../shell/desktop-open/desktop-open-action.js';
import { probeZhiyuRuntimeStatus } from '../shell/runtime/runtime-status.js';
import { createZhiyuProductionTurnRequestId } from './turn-request-id.js';
import { createZhiyuProductionAgentCenterSession } from './agent-center-adapters.js';
import { hydrateZhiyuProductionConversation } from './conversation-hydration.js';
import { subscribeZhiyuAmbientConversation } from '../shell/agent-chat/ambient-conversation-subscription.js';

function productionRoutePort(): ZhiyuCanonicalRendererBindings['route'] {
  return Object.freeze({
    get: () => ({ pathname: window.location.pathname }),
    subscribe(listener: () => void) {
      window.addEventListener('popstate', listener);
      return () => window.removeEventListener('popstate', listener);
    },
  });
}

async function resolveCurrentAgentHandle(input: {
  readonly selectedAgentHandle: NimiLocalAppAgentHandle | null;
  readonly previousConversationAnchorId: string | null;
  readonly isCurrent: () => boolean;
  readonly inventory: ZhiyuHomeProjection['inventory'];
  readonly conversation: Pick<NimiLocalAppConversationClient, 'snapshot'>;
}): Promise<NimiLocalAppAgentHandle | null> {
  const selectedAgentHandle = input.selectedAgentHandle;
  if (!selectedAgentHandle
    || !input.inventory.ready
    || !input.previousConversationAnchorId
    || input.inventory.localAgents.some((reference) => reference.agentHandle === selectedAgentHandle)) {
    return selectedAgentHandle;
  }
  const reminted = await remintZhiyuConversationSelection({
    previousConversationAnchorId: input.previousConversationAnchorId,
    currentReferences: input.inventory.localAgents,
    conversation: input.conversation,
    isCurrent: input.isCurrent,
  });
  return reminted.outcome === 'reminted' ? reminted.agentHandle : selectedAgentHandle;
}

function localAgentFromRemintError(error: unknown): ZhiyuLocalAgentStatus {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  return {
    transport: 'electron-ipc',
    ready: false,
    reasonCode: typeof record.reasonCode === 'string'
      ? record.reasonCode
      : typeof record.code === 'string'
        ? record.code
        : 'zhiyu-conversation-selection-remint-failed',
    actionHint: typeof record.actionHint === 'string'
      ? record.actionHint
      : 'refresh_runtime_local_agent_inventory',
    source: typeof record.source === 'string' ? record.source : 'sdk',
    message: error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Zhiyu could not rebind the previous Conversation to a current-session Agent.',
    agentHandle: null,
  };
}

async function loadHome(
  input: Parameters<ZhiyuCanonicalRendererBindings['app']['projection']['loadHome']>[0],
  avatarHostPort: AvatarHostHandoffPort,
): Promise<ZhiyuHomeProjection> {
  const [runtime, auth] = await Promise.all([
    probeZhiyuRuntimeStatus(),
    probeZhiyuRuntimeAccountStatus(),
  ]);
  const inventory = await probeZhiyuRuntimeAgentInventory();
  const client = getZhiyuLocalAppClient();
  let localAgent: ZhiyuLocalAgentStatus;
  try {
    const selectedAgentHandle = await resolveCurrentAgentHandle({
      ...input,
      inventory,
      conversation: client.conversation,
    });
    localAgent = resolveZhiyuRuntimeLocalAgentSelection({ inventory, selectedAgentHandle });
  } catch (error) {
    localAgent = localAgentFromRemintError(error);
  }
  let source: ZhiyuHomeProjection['source'];
  if (!localAgent.agentHandle) {
    source = projectZhiyuRuntimeSourceProjection({ manager: null });
  } else {
    try {
      const manager = await client.agentConfigure.manager.snapshot({
        agentHandle: localAgent.agentHandle,
      });
      source = projectZhiyuRuntimeSourceProjection({ manager });
    } catch (error) {
      source = projectZhiyuRuntimeSourceProjection({ error });
    }
  }
  const conversation = await probeZhiyuRuntimeConversationHome(localAgent);
  const [companion, avatar] = await Promise.all([
    probeZhiyuRuntimeCompanionState(conversation, {
      readEmbodiment: (target) => client.embodiment.snapshot(target),
    }),
    probeZhiyuAvatarPresence(conversation, { hostPort: avatarHostPort }),
  ]);
  const delegation = await probeZhiyuRuntimeDelegationUx(conversation);
  return {
    runtime,
    auth,
    source,
    inventory,
    localAgent,
    conversation,
    companion,
    delegation,
    proposal: projectZhiyuProposalIntakeStatus({ conversation }),
    avatar,
  };
}

async function hydrateConversation(input: Parameters<ZhiyuCanonicalRendererBindings['app']['projection']['hydrateConversation']>[0]) {
  const client = getZhiyuLocalAppClient();
  return hydrateZhiyuProductionConversation(input, client.conversation);
}

export function createZhiyuProductionBindings(
  kit: NimiRendererHostFacadeV1<NimiRendererHostMethodMap>,
  options: { readonly avatarHostPort?: AvatarHostHandoffPort } = {},
): ZhiyuCanonicalRendererBindings {
  const avatarHostPort = options.avatarHostPort ?? createZhiyuAvatarHostHandoffPort();
  return createNimiCanonicalRendererHostBindings({
    scope: kit.scope,
    capabilities: kit.capabilities,
    localization: kit.localization,
    kit,
    sdk: Object.freeze({}),
    app: {
      projection: Object.freeze({
        agentCenterSession: createZhiyuProductionAgentCenterSession,
        loadHome: (
          input: Parameters<ZhiyuCanonicalRendererBindings['app']['projection']['loadHome']>[0],
        ) => loadHome(input, avatarHostPort),
        loadAgentInventory: probeZhiyuRuntimeAgentInventory,
        projectTurnReadiness: probeZhiyuAgentTurnReadiness,
        hydrateConversation,
      }),
      commands: Object.freeze({
        async allocateTurnRequestId() {
          return createZhiyuProductionTurnRequestId();
        },
        runTurn: runZhiyuAgentChatTurn,
        async transcribeVoice(input: Parameters<ZhiyuCanonicalRendererBindings['app']['commands']['transcribeVoice']>[0], options?: Parameters<ZhiyuCanonicalRendererBindings['app']['commands']['transcribeVoice']>[1]) {
          return getZhiyuLocalAppClient().conversation.transcribeVoice(input, options);
        },
        async openDesktopRuntimeSettings() {
          await requestZhiyuDesktopOpenRuntimeSettings();
        },
        openDesktopSelectPartner: requestZhiyuDesktopOpenSelectPartner,
        launchAvatar: ({ evidence, action }: Parameters<ZhiyuCanonicalRendererBindings['app']['commands']['launchAvatar']>[0]) => launchZhiyuAvatar({ evidence, action, hostPort: avatarHostPort }),
      }),
      events: Object.freeze({
        subscribeConversation(input: Parameters<ZhiyuCanonicalRendererBindings['app']['events']['subscribeConversation']>[0]) {
			const conversation = getZhiyuLocalAppClient().conversation;
          return subscribeZhiyuAmbientConversation({
			conversation,
            identity: {
              agentHandle: input.agentHandle as NimiLocalAppAgentHandle,
              conversationAnchorId: input.conversationAnchorId,
            },
			hydrate: async () => (await hydrateZhiyuProductionConversation({
				agentHandle: input.agentHandle,
				conversationAnchorId: input.conversationAnchorId,
				currentSource: input.currentSource,
				currentChat: input.currentChat,
			}, conversation)).chat,
			resolveArtifactUrl: async (artifactId) => {
				const artifact = await conversation.readArtifact({
					agentHandle: input.agentHandle,
					conversationAnchorId: input.conversationAnchorId,
					artifactId,
				});
				return zhiyuArtifactDataUrl(artifact.bytes, artifact.mimeType);
			},
            onChat: input.onChat,
          });
        },
      }),
    },
    route: productionRoutePort(),
    clock: Object.freeze({ now: () => Date.now() }),
    surfaceLifecycle: kit.surfaceLifecycle,
  });
}
