import { useEffect, useRef, useState } from 'react';
import { AgentLifecycleStatus } from '@nimiplatform/sdk/runtime/wire-types';
import { useAppStoreApi, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { captureHomeNavigationScope } from '../../app-shell/providers/home-navigation.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { launchAgentConversationFromDisplay } from '../chat/agent-conversation-launcher.js';
import type { PartnerDirectoryItem } from './partner-directory-model.js';
import { openPartnerConversation } from './partner-navigation.js';

export function usePartnerChat(accountId: string) {
  const bindings = useDesktopRendererBindings();
  const store = useAppStoreApi();
  const navigation = useHomeNavigation();
  const [openingRef, setOpeningRef] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const openChat = async (partner: PartnerDirectoryItem) => {
    if (partner.lifecycle !== AgentLifecycleStatus.ACTIVE || pending.current) return;
    const scope = captureAccountActionScope(store);
    if (!scope || scope.accountId !== accountId) { scope?.dispose(); return; }
    const position = captureHomeNavigationScope(navigation);
    const isCurrent = () => scope.isCurrent() && position.isCurrent() && mounted.current;
    pending.current = true;
    setOpeningRef(partner.localAgentRef); setFailed(false);
    try {
      const target = await openPartnerConversation({ sdk: bindings.sdk, accountId, localAgentRef: partner.localAgentRef, isCurrent });
      if (target && isCurrent()) await launchAgentConversationFromDisplay({ navigation,
        setAgentConversationTargetSnapshot: store.getState().setAgentConversationTargetSnapshot, target });
    } catch { if (isCurrent()) setFailed(true); }
    finally {
      scope.dispose(); position.dispose(); pending.current = false;
      if (mounted.current) setOpeningRef(null);
    }
  };
  return { openChat, openingRef, failed };
}
