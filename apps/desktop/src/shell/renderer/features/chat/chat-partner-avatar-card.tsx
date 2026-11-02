import { PartnerCardContent } from './chat-partner-card-content.js';
import { useState, type ReactElement } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChatAvatarPopover } from './chat-avatar-popover.js';
import { useAppStore, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { resolvePartnerForHandle } from '../agents/partner-directory-model.js';
import { resolveCurrentPartnerSource } from '../source-detail/data/realm-source-detail-data.js';

type Props = {
  agentHandle: string;
  name: string;
  avatarUrl?: string | null;
  placement: 'composer' | 'rail';
  onSelect?: () => void;
  children: ReactElement;
};

// @nimi-authority: rule.nimi.desktop.product-surfaces.partners
export function ChatPartnerAvatarCard(props: Props) {
  const auth = useAppStore(state => state.auth);
  const realm = useAppStore(state => state.runtimeDefaults?.realm.realmBaseUrl ?? '');
  // Account/session/target changes retire the whole transient preview.
  return <PartnerAvatarCard key={`${auth.user?.id}:${auth.authorizationRevision}:${realm}:${props.agentHandle}`} {...props}
    accountId={String(auth.user?.id ?? '')} scopeKey={`${realm}:${auth.authorizationRevision}`} authenticated={auth.status === 'authenticated'} />;
}

function PartnerAvatarCard({ accountId, scopeKey, authenticated, ...props }: Props & {
  accountId: string; scopeKey: string; authenticated: boolean;
}) {
  const bindings = useDesktopRendererBindings();
  const navigation = useHomeNavigation();
  const [open, setOpen] = useState(false);
  const partnerQuery = useQuery({
    queryKey: ['chat-partner-preview', accountId, scopeKey, props.agentHandle],
    queryFn: () => resolvePartnerForHandle(bindings.sdk, accountId, props.agentHandle),
    enabled: open && authenticated && Boolean(accountId && props.agentHandle), staleTime: 15_000, retry: false,
  });
  const partner = authenticated && !partnerQuery.isError ? partnerQuery.data?.partner : undefined;
  const source = useQuery({
    queryKey: ['partner-current-source', accountId, scopeKey, partner?.localAgentRef, partner?.sourceRef],
    queryFn: () => resolveCurrentPartnerSource(bindings.sdk.realm(), partner!.sourceRef!),
    enabled: open && Boolean(partner?.sourceRef), staleTime: 60_000, retry: false,
  });
  const profile = !source.isError ? source.data : undefined;
  const go = (section?: 'cognition' | 'overview') => {
    if (!partner) return;
    setOpen(false);
    void navigation.push({ id: 'explore', exploreSection: 'partners', partner: {
      localAgentRef: partner.localAgentRef, ...(section ? { settingsSection: section } : {}),
    } });
  };
  return <ChatAvatarPopover open={open} onOpenChange={setOpen} placement={props.placement} onSelect={props.onSelect}
    label={partner?.displayName || props.name} testId="chat-partner-card" className="partner-preview-popover" trigger={props.children}>
        <PartnerCardContent name={partner?.displayName || props.name} avatarUrl={partnerQuery.data?.avatarUrl || props.avatarUrl}
          profile={profile} active={open && authenticated} available={Boolean(partner)}
          loading={partnerQuery.isPending && authenticated} failed={partnerQuery.isError || source.isError}
          onRetry={() => { void (partnerQuery.isError ? partnerQuery.refetch() : source.refetch()); }}
          onOpen={go} onWorld={() => { if (!profile) return; setOpen(false); void navigation.push({ id: 'world-detail', worldId: profile.sourceRef.worldId }); }} />
  </ChatAvatarPopover>;
}
