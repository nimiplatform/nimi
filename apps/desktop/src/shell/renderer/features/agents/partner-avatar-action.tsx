import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/kit/ui';
import { UserRound } from 'lucide-react';
import type { AgentCenterSession } from '@nimiplatform/kit/features/agent-center';
import { useAppStoreApi, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { captureHomeNavigationScope } from '../../app-shell/providers/home-navigation.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { buildDesktopAvatarInstanceId } from '../../bridge/runtime-bridge/chat-agent-avatar-launcher.js';
import { emitFeedbackToast } from '../../ui/feedback/emit-feedback-toast.js';
import { openPartnerConversation } from './partner-navigation.js';

const P = 'runtimeConfig.partners.avatar';

// @nimi-authority: rule.nimi.desktop.product-surfaces.partner-activity-and-use
export function PartnerAvatarAction({ session, accountId, localAgentRef, onConfigure }: {
  session: AgentCenterSession; accountId: string; localAgentRef: string; onConfigure(): void;
}) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const store = useAppStoreApi();
  const navigation = useHomeNavigation();
  const snapshot = useSyncExternalStore(useCallback(listener => session.subscribe(listener), [session]), useCallback(() => session.getSnapshot(), [session]));
  const appearance = snapshot.state.appearance;
  const loading = snapshot.reads.presentation === 'pending';
  const unavailable = snapshot.reads.presentation === 'failed';
  const configured = Boolean(appearance.avatarAssetRef && appearance.status === 'ready' && (appearance.backendKind === 'live2d' || appearance.backendKind === 'vrm'));
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const launch = async () => {
    if (busy.current) return;
    if (unavailable) { await session.refresh(); return; }
    if (!configured) { onConfigure(); return; }
    const account = captureAccountActionScope(store);
    if (!account || account.accountId !== accountId) { account?.dispose(); return; }
    const position = captureHomeNavigationScope(navigation);
    const isCurrent = () => account.isCurrent() && position.isCurrent();
    busy.current = true; setPending(true);
    try {
      const target = await openPartnerConversation({ sdk: bindings.sdk, accountId, localAgentRef, isCurrent });
      if (!target || !isCurrent()) return;
      const result = await bindings.app.commands.avatarHandoff.launch({ agentHandle: target.agentHandle!, conversationAnchorId: target.conversationAnchorId,
        avatarInstanceId: buildDesktopAvatarInstanceId({ agentHandle: target.agentHandle! }), launchSource: 'home-partners' });
      if (isCurrent()) emitFeedbackToast({ kind: result.opened ? 'success' : 'info', message: t(result.opened ? `${P}.opened` : `${P}.notOpened`) });
    } catch { if (isCurrent()) emitFeedbackToast({ kind: 'error', message: t(`${P}.failed`) }); }
    finally { account.dispose(); position.dispose(); busy.current = false; setPending(false); }
  };
  return <Button tone="secondary" loading={pending} disabled={loading || !bindings.app.commands.avatarHandoff.available()} onClick={() => { void launch(); }}>
    <UserRound size={16} />{t(loading ? 'Common.loading' : unavailable ? `${P}.retry` : configured ? `${P}.open` : `${P}.configure`)}
  </Button>;
}
