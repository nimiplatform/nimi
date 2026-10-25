import { useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useHomeChatPosition } from '../../app-shell/providers/home-chat-position.js';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AgentCenter, type AgentCenterI18n, type AgentCenterPlacementActions } from '@nimiplatform/kit/features/agent-center';

import { useDesktopRendererCommands, useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { getRuntimeSetupTaskStore } from '../runtime-config/runtime-setup-task-store.js';
import { agentCenterSetupReturnFocus, openRuntimeSetupTaskFromEntry } from '../runtime-config/runtime-setup-task-open.js';
import { currentDesktopAccountIdForSetup } from '../runtime-config/runtime-setup-task-ports.js';
import type { UseAgentConversationPresentationInput } from './chat-agent-shell-presentation-types';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';

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

// @nimi-authority: rule.nimi.platform.ui-design-system.p-agent-center-001c
export function AgentConversationSettingsContent({ input }: AgentConversationSettingsContentProps) {
  const navigation = useHomeNavigation();
  const { i18n } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const homeChat = useHomeChatPosition();
  const activeSection = homeChat.agentCenterSection ?? 'overview';

  const runtimeConfigNavigation = useDesktopRendererCommands().runtimeConfigNavigation;
  const agentCenterI18n = useMemo<AgentCenterI18n>(() => ({
    language: i18n.resolvedLanguage || i18n.language,
    exists: (key) => i18n.exists(key),
    t: (key, values) => input.t(key, values) as string,
  }), [i18n, input.t]);
  useEffect(() => {
    const session = input.runtimeAgentCenterAdapter;
    // The canonical subscription owns the first read. Reopening an already
    // loaded center still revalidates settings changed in another surface.
    if (session && session.getSnapshot().phase !== 'loading') void session.refresh();
  }, [input.runtimeAgentCenterAdapter]);
  const observedContext = useRef<{
    session: typeof input.runtimeAgentCenterAdapter;
    anchor: typeof input.activeConversationAnchorId;
    messageCount: number;
  } | null>(null);
  useEffect(() => {
    const current = { session: input.runtimeAgentCenterAdapter,
      anchor: input.activeConversationAnchorId, messageCount: input.messages.length };
    const previous = observedContext.current;
    observedContext.current = current;
    // A later committed turn may change Manager context. Keep that fresh read
    // even while another read is pending; only the redundant mount is omitted.
    if (previous && previous.session === current.session
      && (previous.anchor !== current.anchor || previous.messageCount !== current.messageCount)) {
      void current.session?.refresh();
    }
  }, [input.activeConversationAnchorId, input.messages.length, input.runtimeAgentCenterAdapter]);
  const placementActions = useMemo<AgentCenterPlacementActions>(() => {
    const openSetup = (capabilityContract: string, creation = false) => {
      void openRuntimeSetupTaskFromEntry(getRuntimeSetupTaskStore(), {
        navigation, capabilityContract,
        loadSource: async origin => ({
          kind: creation ? 'app' : 'local-agent',
          accountId: await currentDesktopAccountIdForSetup(),
          ...(creation ? { ownerAppId: sdk.appId() } : {}),
          returnFocus: agentCenterSetupReturnFocus(origin.chat),
        }),
        openTask: taskId => runtimeConfigNavigation.openSetupTask(taskId),
      }).catch(error => emitFeedbackToast({ kind: 'error', message: error instanceof Error ? error.message : String(error) }));
    };
    return {
      close: input.onCloseAgentCenter,
      openRuntimeSettings: () => runtimeConfigNavigation.openPage('aiSettings'),
      openReferenceVoiceSetup: scope => openSetup(scope === 'creation' ? 'voice.create' : 'audio.synthesize', scope === 'creation'),
      openMachineLoadout: capabilityContract => openSetup(capabilityContract),
    };
  }, [input.onCloseAgentCenter, runtimeConfigNavigation, navigation, sdk]);
  if (!input.runtimeAgentCenterAdapter) return null;
  return (
    <AgentCenter
      key={`${input.activeTarget?.agentHandle}:${input.activeConversationAnchorId}`}
      activeSection={activeSection}
      chrome="standalone"
      identity={input.activeTarget ? {
        displayName: input.activeTarget.displayName,
        avatarUrl: input.activeTarget.avatarUrl,
        avatarFallback: input.activeTarget.displayName.charAt(0).toUpperCase(),
        badgeLabel: resolveAgentCenterIdentityBadge(input.activeTarget),
      } : null}
      i18n={agentCenterI18n}
      onSectionChange={homeChat.setAgentCenterSection}
      placementActions={placementActions}
      session={input.runtimeAgentCenterAdapter}
    />
  );
}
