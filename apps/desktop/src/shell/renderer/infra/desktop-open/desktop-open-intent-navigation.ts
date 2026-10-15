import type { NimiDesktopOpenIntent } from '@nimiplatform/kit/core/desktop-open';
import type { HomeNavigation } from '../../app-shell/providers/home-navigation.js';
import type { RuntimePageIdV11 } from '../../features/runtime-config/runtime-config-state-types';
import type { DesktopRendererRuntimeConfigNavigationPort } from '../../renderer/runtime-config-navigation-port.js';
import { asNimiError } from '@nimiplatform/sdk';
import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import type { AgentLocalTargetSnapshot } from '../../bridge/runtime-bridge/types.js';

export type DesktopOpenIntentStore = HomeNavigation;

// @nimi-authority: rule.nimi.desktop.shell-ui.r039
// The incoming anchor is a correlation, never a transferred App handle or
// authority. Every candidate is checked by Home's current manager client.
export async function resolveDesktopOpenAgentCenterTarget(
  client: Pick<NimiLocalAppClient, 'agents' | 'agentConfigure'>,
  conversationAnchorId: string,
  isCurrent: () => boolean,
): Promise<AgentLocalTargetSnapshot & { agentHandle: string; conversationAnchorId: string }> {
  const references = await client.agents.listReferences();
  for (const reference of references) {
    if (!isCurrent()) throw new Error('Agent Center navigation was superseded.');
    try {
      // Each handle reads its own current Conversation. Do not probe another
      // Agent with the requested anchor: that is an invalid owner pairing.
      const snapshot = await client.agentConfigure.manager.snapshot({ agentHandle: reference.agentHandle });
      if (!isCurrent()) throw new Error('Agent Center navigation was superseded.');
      if (snapshot.conversationContext?.conversationAnchorId === conversationAnchorId) {
        // Build the target from this successful owner read. Sidebar cache may
        // still contain an earlier failed query and cannot complete this handoff.
        return { agentHandle: reference.agentHandle, conversationAnchorId, displayName: reference.displayName,
          avatarUrl: reference.avatarUrl, handle: '', worldId: null, worldName: null,
          bio: null, ownershipType: null, greeting: null, builtinDocsContext: null };
      }
    } catch (error) {
      if (!['LOCAL_APP_ACCESS_DENIED', 'local-app-access-denied', 'access-denied', 'runtime-permission-denied', 'NOT_FOUND', 'not-found', 'LOCAL_APP_OWNER_UNAVAILABLE', 'local-app-owner-unavailable', 'owner-unavailable'].includes(asNimiError(error).reasonCode)) throw error;
    }
  }
  throw new Error('This conversation is not available to the current Agent manager.');
}

// @nimi-authority: rule.nimi.platform.core-protocol.p-dopen-003
export function applyDesktopOpenIntentToAppStore(
  intent: NimiDesktopOpenIntent,
  input: {
    readonly store: DesktopOpenIntentStore;
    readonly runtimeConfigNavigation: DesktopRendererRuntimeConfigNavigationPort;
  },
): void {
  const { runtimeConfigNavigation, store } = input;
  switch (intent.kind) {
    case 'open-agent-center': {
      void store.push({ id: 'chat', chat: { mode: 'agent', managerAnchorId: intent.conversationAnchorId } });
      return;
    }
    case 'open-explore': {
      void store.push({ id: 'explore', exploreSection: intent.section, search: intent.query ?? '' });
      return;
    }
    case 'open-runtime-config': {
      const actionFocus = runtimeConfigActionFocusForIntent(intent);
      const page = resolveRuntimePageForIntent(intent);
      if (actionFocus) {
        runtimeConfigNavigation.focusAction(actionFocus);
      } else runtimeConfigNavigation.openPage(page);
      return;
    }
    case 'open-apps': {
      void store.push({ id: 'apps', ...(intent.appId ? { appId: intent.appId, appSection: intent.section } : {}) });
      return;
    }
    case 'open-settings': {
      void store.push({ id: 'settings', settingsSection: intent.section });
      return;
    }
    case 'open-integrations': {
      void store.push({ id: 'home', homeSection: 'integrations' });
      return;
    }
  }
}

function resolveRuntimePageForIntent(
  intent: Extract<NimiDesktopOpenIntent, { kind: 'open-runtime-config' }>,
): RuntimePageIdV11 {
  // Model discovery and acquisition live in the Model Library destination.
  if (intent.page === 'models') {
    return 'modelLibrary';
  }
  return 'cloudServices';
}

function runtimeConfigActionFocusForIntent(
  intent: Extract<NimiDesktopOpenIntent, { kind: 'open-runtime-config' }>,
) {
  if (intent.page === 'cloud' && intent.action === 'add-connector') {
    return {
      page: 'cloudServices',
      action: 'add-connector',
      focus: 'runtime-config-action-focus.cloud-connector-draft',
    } as const;
  }
  // The install-model intent focuses the Model Library discovery surface, the
  // single acquisition entry.
  if (intent.page === 'models' && intent.action === 'install-model') {
    return {
      page: 'modelLibrary',
      action: 'install-model',
      focus: 'runtime-config-action-focus.model-library-install',
    } as const;
  }
  return null;
}
