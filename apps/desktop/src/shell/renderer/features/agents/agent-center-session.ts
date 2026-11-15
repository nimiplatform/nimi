import { useEffect, useState } from 'react';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import { createAppAgentCenterSession, type AgentCenterResourcePackPlacementAdapter, type AgentCenterSession } from '@nimiplatform/kit/features/agent-center';
import { createAgentCenterShellBridge, hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { useAppStoreApi, type AppStoreState } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { createDesktopAgentCenterHostMechanics } from '../chat/chat-agent-center-host-mechanics.js';

// @nimi-authority: rule.nimi.desktop.agent-projection.r205
export function useDesktopAgentCenterSession(
  input: { agentHandle?: string | null; conversationAnchorId?: string | null },
): AgentCenterSession | null {
  const bindings = useDesktopRendererBindings();
  const store = useAppStoreApi();
  const agentHandle = input.agentHandle?.trim() ?? '';
  const conversationAnchorId = input.conversationAnchorId?.trim() ?? '';
  const [boundSession, setBoundSession] = useState<{
    agentHandle: string;
    conversationAnchorId: string;
    bindings: typeof bindings;
    session: AgentCenterSession;
  } | null>(null);
  useEffect(() => {
    let current: { scope: AgentCenterAccountScope; session: AgentCenterSession } | null = null;
    const createSession = () => {
      const shellBridge = hasElectronInvoke() ? createAgentCenterShellBridge() : null;
      const resourcePackPlacement = conversationAnchorId && shellBridge
        ? {
            availability: {
              state: 'available',
              reasonCode: null,
              actionHint: null,
            },
            open: () => shellBridge.openResourcePackInZhiyu(conversationAnchorId),
          } as const satisfies AgentCenterResourcePackPlacementAdapter
        : {
            availability: {
              state: 'unavailable',
              reasonCode: 'selection-required',
              actionHint: 'open_current_conversation',
            },
            open: async () => ({
              status: 'unavailable',
              reasonCode: 'operation-unavailable',
              actionHint: 'retry_zhiyu_resource_pack_placement',
            }),
          } as const satisfies AgentCenterResourcePackPlacementAdapter;
      const appClient = bindings.sdk.appProduct();
      return createAppAgentCenterSession({
        handle: agentHandle as NimiLocalAppAgentHandle,
        client: appClient.agentConfigure,
        referenceVoiceClient: appClient,
        ...(conversationAnchorId
          ? { conversationAnchorId }
          : {}),
        hostMechanics: shellBridge
          ? createDesktopAgentCenterHostMechanics({
            conversationAnchorId,
            shell: shellBridge,
            avatarHandoff: bindings.app.commands.avatarHandoff,
          })
          : null,
        resourcePackPlacement,
      });
    };
    const update = () => {
      const auth = store.getState().auth;
      const scope = agentCenterAccountScope(auth);
      if (current && scope && sameAgentCenterAccountScope(current.scope, scope)) return;
      current?.session.dispose();
      current = null;
      // Refresh-pending may retain this exact established Session, but never
      // opens one. Owner calls still enforce formal App access independently.
      if (auth.status === 'authenticated' && scope && agentHandle) {
        current = { scope, session: createSession() };
      }
      setBoundSession(current ? { agentHandle, conversationAnchorId, bindings, session: current.session } : null);
    };
    // Observe every account transition, including sign-out/sign-in batched into
    // one React render, so an old Session can never be revived by equal fields.
    const unsubscribe = store.subscribe(update);
    update();
    return () => { unsubscribe(); current?.session.dispose(); current = null; };
  }, [agentHandle, conversationAnchorId, bindings, store]);

  const runtimeAgentCenterAdapter = boundSession?.agentHandle === agentHandle
    && boundSession.conversationAnchorId === conversationAnchorId && boundSession.bindings === bindings
    ? boundSession.session : null;
  return runtimeAgentCenterAdapter;
}

type AgentCenterAccountScope = Readonly<{
  accountId: string;
  realmEnvironmentId: string;
  authorizationRevision: string;
}>;

// @nimi-authority: rule.nimi.runtime.protected-session.r031
function agentCenterAccountScope(auth: AppStoreState['auth']): AgentCenterAccountScope | null {
  const accountId = auth.user?.id;
  const realmEnvironmentId = auth.user?.realmEnvironmentId;
  if ((auth.status !== 'authenticated' && auth.status !== 'refresh-pending')
    || typeof accountId !== 'string' || !accountId
    || typeof realmEnvironmentId !== 'string' || !realmEnvironmentId
    || !auth.authorizationRevision) return null;
  return { accountId, realmEnvironmentId, authorizationRevision: auth.authorizationRevision };
}

function sameAgentCenterAccountScope(left: AgentCenterAccountScope, right: AgentCenterAccountScope): boolean {
  return left.accountId === right.accountId && left.realmEnvironmentId === right.realmEnvironmentId
    && left.authorizationRevision === right.authorizationRevision;
}
