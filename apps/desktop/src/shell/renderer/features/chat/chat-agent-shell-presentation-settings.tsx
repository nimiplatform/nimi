import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AgentCenter, type AgentCenterI18n, type AgentCenterPlacementActions, type AgentCenterSectionId } from '@nimiplatform/kit/features/agent-center';

import { useDesktopRendererCommands, useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { getRuntimeSetupTaskStore } from '../runtime-config/runtime-setup-task-store.js';
import { openOrCreateRuntimeSetupTask } from '../runtime-config/runtime-setup-task-open.js';
import { currentDesktopAccountIdForSetup } from '../runtime-config/runtime-setup-task-ports.js';
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
  const navigation = useHomeNavigation();
  const { i18n } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const [activeSection, setActiveSection] = useState<AgentCenterSectionId>('overview');

  const runtimeConfigNavigation = useDesktopRendererCommands().runtimeConfigNavigation;
  const agentCenterI18n = useMemo<AgentCenterI18n>(() => ({
    language: i18n.resolvedLanguage || i18n.language,
    exists: (key) => i18n.exists(key),
    t: (key, values) => input.t(key, values) as string,
  }), [i18n, input.t]);
  useEffect(() => {
    void input.messages.length;
    void input.runtimeAgentCenterAdapter?.refresh();
  }, [input.activeConversationAnchorId, input.messages.length, input.runtimeAgentCenterAdapter]);
  const placementActions = useMemo<AgentCenterPlacementActions>(() => ({
    close: input.onCloseAgentCenter,
    openRuntimeSettings: () => {

      runtimeConfigNavigation.openPage('aiSettings');
    },
    openReferenceVoiceSetup: (scope) => {
      void currentDesktopAccountIdForSetup().then((accountId) => {
        openOrCreateRuntimeSetupTask(getRuntimeSetupTaskStore(), {
          capabilityContract: scope === 'creation' ? 'voice.create' : 'audio.synthesize',
          source: { kind: scope === 'creation' ? 'app' : 'local-agent', accountId,
            ...(scope === 'creation' ? { ownerAppId: sdk.appId() } : {}), returnFocus: 'chat:agent' },
          openTask: (taskId) => {  runtimeConfigNavigation.openSetupTask(taskId); },
        });
      });
    },
    openMachineLoadout: (capabilityContract) => {
      // Preserve the capability requested by the shared Manager.
      void currentDesktopAccountIdForSetup().then((accountId) => {
        openOrCreateRuntimeSetupTask(getRuntimeSetupTaskStore(), {
          capabilityContract,
          source: {
            kind: 'local-agent',
            accountId,
            returnFocus: 'chat:agent',
          },
          openTask: (taskId) => {

            runtimeConfigNavigation.openSetupTask(taskId);
          },
        });
      });
    },
  }), [input.onCloseAgentCenter, runtimeConfigNavigation, navigation, sdk]);
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
