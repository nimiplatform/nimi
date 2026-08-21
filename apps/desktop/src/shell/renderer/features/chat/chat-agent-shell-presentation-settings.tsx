import { useEffect, useMemo, useState } from 'react';
import {
  AgentCenter,
  type AgentCenterI18n,
  type AgentCenterPlacementActions,
  type AgentCenterSectionId,
} from '@nimiplatform/kit/features/agent-center';
import { useAppStore } from '../../app-shell/providers/app-store';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';

type AgentConversationSettingsContentProps = {
  input: UseAgentConversationPresentationInput;
};

export function resolveAgentCenterIdentityBadge(input: {
  readonly displayName: string;
  readonly handle: string;
  readonly worldName: string | null;
}): string | null {
  const displayName = input.displayName.trim();
  const worldName = input.worldName?.trim() || '';
  if (worldName && worldName !== displayName) return worldName;
  const handle = input.handle.trim().replace(/^[@~]/u, '');
  if (!handle || /^(?:world|persona)-character-/u.test(handle)) return null;
  return `~${handle}`;
}

export function AgentConversationSettingsContent({ input }: AgentConversationSettingsContentProps) {
  const [activeSection, setActiveSection] = useState<AgentCenterSectionId>('overview');
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const runtimeConfigNavigation = useDesktopRendererCommands().runtimeConfigNavigation;
  const agentCenterI18n = useMemo<AgentCenterI18n>(() => ({
    t: (key, values) => input.t(key, values) as string,
  }), [input.t]);
  useEffect(() => {
    void input.messages.length;
    void input.runtimeAgentCenterAdapter?.refresh();
  }, [input.activeConversationAnchorId, input.messages.length, input.runtimeAgentCenterAdapter]);
  const placementActions = useMemo<AgentCenterPlacementActions>(() => ({
    close: input.onCloseAgentCenter,
    openRuntimeSettings: () => {
      setActiveTab('runtime');
      runtimeConfigNavigation.openPage('localModels');
    },
    openMachineLoadout: () => {
      setActiveTab('runtime');
      runtimeConfigNavigation.focusAction({
        page: 'loadouts',
        action: 'open-loadouts',
        focus: 'runtime-config-action-focus.loadouts',
      });
    },
    openCloudConnectorConfiguration: () => {
      setActiveTab('runtime');
      runtimeConfigNavigation.focusAction({
        page: 'cloud',
        action: 'add-connector',
        focus: 'runtime-config-action-focus.cloud-connector-draft',
      });
    },
  }), [input.onCloseAgentCenter, runtimeConfigNavigation, setActiveTab]);
  if (!input.runtimeAgentCenterAdapter) return null;
  return (
    <AgentCenter
      activeSection={activeSection}
      chrome="standalone"
      identity={input.activeTarget ? {
        displayName: input.activeTarget.displayName,
        avatarUrl: input.activeTarget.avatarUrl,
        avatarFallback: input.activeTarget.displayName.charAt(0).toUpperCase(),
        badgeLabel: resolveAgentCenterIdentityBadge(input.activeTarget),
      } : null}
      i18n={agentCenterI18n}
      onSectionChange={setActiveSection}
      placementActions={placementActions}
      session={input.runtimeAgentCenterAdapter}
    />
  );
}
