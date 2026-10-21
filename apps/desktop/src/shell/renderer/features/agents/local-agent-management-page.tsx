import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AppAgentCenterEntry, type AgentCenterPlacementActions } from '@nimiplatform/kit/features/agent-center';
import { Button } from '@nimiplatform/kit/ui';
import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import { createAgentCenterShellBridge, hasElectronInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { createDesktopAgentCenterHostMechanics } from '../chat/chat-agent-center-host-mechanics.js';
import { getRuntimeSetupTaskStore } from '../runtime-config/runtime-setup-task-store.js';
import { openOrCreateRuntimeSetupTask } from '../runtime-config/runtime-setup-task-open.js';
import { currentDesktopAccountIdForSetup } from '../runtime-config/runtime-setup-task-ports.js';

// A secondary Home page. Selecting a management reference never opens a chat.
export function LocalAgentManagementPage() {
  const bindings = useDesktopRendererBindings();
  const navigation = useHomeNavigation();
  const destination = useHomeDestination();
  const { t, i18n } = useTranslation();
  const client = useMemo(() => bindings.sdk.appProduct(), [bindings.sdk]);
  const hostMechanics = useMemo(() => hasElectronInvoke()
    ? createDesktopAgentCenterHostMechanics({ shell: createAgentCenterShellBridge(), avatarHandoff: bindings.app.commands.avatarHandoff })
    : null, [bindings]);
  const placementActions = useMemo<AgentCenterPlacementActions>(() => {
    const openSetup = (capabilityContract: string, creation = false) => {
      void currentDesktopAccountIdForSetup().then(accountId => {
        openOrCreateRuntimeSetupTask(getRuntimeSetupTaskStore(), {
          capabilityContract,
          source: { kind: creation ? 'app' : 'local-agent', accountId,
            ...(creation ? { ownerAppId: bindings.sdk.appId() } : {}), returnFocus: 'chat:agent' },
          openTask: taskId => bindings.app.commands.runtimeConfigNavigation.openSetupTask(taskId),
        });
      });
    };
    return {
      close: () => { navigation.back(); },
      openRuntimeSettings: () => bindings.app.commands.runtimeConfigNavigation.openPage('aiSettings'),
      openMachineLoadout: capability => openSetup(capability),
      openReferenceVoiceSetup: scope => openSetup(scope === 'creation' ? 'voice.create' : 'audio.synthesize', scope === 'creation'),
    };
  }, [bindings, navigation]);
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col">
    <header className="flex shrink-0 items-center gap-3 border-b border-[var(--nimi-border-subtle)] px-4 py-3">
      <Button tone="ghost" size="sm" onClick={() => navigation.back()}>{t('Common.back', { defaultValue: 'Back' })}</Button>
      <h1 className="text-lg font-semibold">{t('Chat.managePartners')}</h1>
    </header>
    <div className="min-h-0 flex-1 overflow-auto p-4">
      <AppAgentCenterEntry client={client} language={i18n.language}
        initialAgentHandle={destination.chat?.agentHandle as NimiLocalAppAgentHandle | undefined}
        conversationAnchorId={destination.chat?.conversationAnchorId}
        hostMechanics={hostMechanics} placementActions={placementActions} />
    </div>
  </section>;
}
