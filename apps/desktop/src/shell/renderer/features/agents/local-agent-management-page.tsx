import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AppAgentCenterEntry, type AgentCenterPlacementActions, type AgentCenterResourcePackPlacementAdapter } from '@nimiplatform/kit/features/agent-center';
import { Button } from '@nimiplatform/kit/ui';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import { createAgentCenterShellBridge, hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useAppStore, useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { createDesktopAgentCenterHostMechanics } from '../chat/chat-agent-center-host-mechanics.js';
import { getRuntimeSetupTaskStore } from '../runtime-config/runtime-setup-task-store.js';
import { openRuntimeSetupTaskFromEntry } from '../runtime-config/runtime-setup-task-open.js';
import { currentDesktopAccountIdForSetup } from '../runtime-config/runtime-setup-task-ports.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';

// A secondary Home page. Selecting a management reference never opens a chat.
export function LocalAgentManagementPage() {
  const bindings = useDesktopRendererBindings();
  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const targets = useAppStore(state => state.agentConversationTargetByHandle);
  const { t, i18n } = useTranslation();
  const client = useMemo(() => bindings.sdk.appProduct(), [bindings.sdk]);
  const onSelectedAgentChange = useCallback((handle: NimiLocalAppAgentHandle) => {
    if (destination.chat?.agentHandle === handle) return;
    const anchor = targets[handle]?.conversationAnchorId;
    navigation.replace({ id: 'agent-center', chat: { mode: 'agent', agentHandle: handle, ...(anchor ? { conversationAnchorId: anchor } : {}) } });
  }, [destination.chat?.agentHandle, navigation, targets]);
  const resourcePackPlacementForAgent = useCallback((handle: NimiLocalAppAgentHandle): AgentCenterResourcePackPlacementAdapter | null => {
    if (!hasElectronInvoke()) return null;
    return {
      availability: { state: 'available', reasonCode: null, actionHint: null },
      open: async () => {
        const conversation = await client.conversation.open({ agentHandle: handle });
        return createAgentCenterShellBridge().openResourcePackInZhiyu(conversation.conversationAnchorId);
      },
    };
  }, [client]);
  const hostMechanics = useMemo(() => hasElectronInvoke()
    ? createDesktopAgentCenterHostMechanics({ shell: createAgentCenterShellBridge(), avatarHandoff: bindings.app.commands.avatarHandoff })
    : null, [bindings]);
  const placementActions = useMemo<AgentCenterPlacementActions>(() => {
    const openSetup = (capabilityContract: string, creation = false) => {
      void openRuntimeSetupTaskFromEntry(getRuntimeSetupTaskStore(), {
        navigation, capabilityContract,
        loadSource: async origin => {
          const [accountId, references] = await Promise.all([currentDesktopAccountIdForSetup(), client.agents.listReferences()]);
          const reference = references.find(item => item.agentHandle === origin.chat?.agentHandle);
          // Persist correlation only. Session handles are never restored from a task.
          const returnDestination = { id: 'agent-center', chat: { mode: 'agent',
            ...(reference ? { agentBinding: reference.agentBinding,
              ...(origin.chat?.conversationAnchorId ? { conversationAnchorId: origin.chat.conversationAnchorId } : {}) } : {}) } };
          return { kind: creation ? 'app' : 'local-agent', accountId,
            ...(creation ? { ownerAppId: bindings.sdk.appId() } : {}), returnFocus: 'home:' + encodeURIComponent(JSON.stringify(returnDestination)) };
        },
        openTask: taskId => bindings.app.commands.runtimeConfigNavigation.openSetupTask(taskId),
      }).catch(error => emitFeedbackToast({ kind: 'error', message: error instanceof Error ? error.message : String(error) }));
    };
    return {
      close: () => { navigation.back(); },
      openRuntimeSettings: () => bindings.app.commands.runtimeConfigNavigation.openPage('aiSettings'),
      openMachineLoadout: capability => openSetup(capability),
      openReferenceVoiceSetup: scope => openSetup(scope === 'creation' ? 'voice.create' : 'audio.synthesize', scope === 'creation'),
    };
  }, [bindings, navigation, destination, client]);
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col">
    <header className="flex shrink-0 items-center gap-3 border-b border-[var(--nimi-border-subtle)] px-4 py-3">
      <Button tone="ghost" size="sm" onClick={() => navigation.back()}>{t('Common.back', { defaultValue: 'Back' })}</Button>
      <h1 className="text-lg font-semibold">{t('Chat.managePartners')}</h1>
    </header>
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <AppAgentCenterEntry client={client} language={i18n.language}
        initialAgentHandle={destination.chat?.agentHandle as NimiLocalAppAgentHandle | undefined}
        conversationAnchorId={destination.chat?.conversationAnchorId}
        onSelectedAgentChange={onSelectedAgentChange}
        resourcePackPlacementForAgent={resourcePackPlacementForAgent}
        hostMechanics={hostMechanics} placementActions={placementActions} />
    </div>
  </section>;
}
