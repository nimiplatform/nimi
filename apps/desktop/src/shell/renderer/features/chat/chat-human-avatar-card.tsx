import { useState, type ReactElement } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowRight, MapPin, Languages, MoreHorizontal } from 'lucide-react';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { useAppStore, useAppStoreApi, useHomeNavigation } from '../../app-shell/providers/app-store.js';
import { captureAccountActionScope } from '../../app-shell/providers/account-action-scope.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { useRealmSocialData } from '../social/data/realm-social-data-context.js';
import { loadContextualHumanProfile } from '../profile/profile-loader.js';
import { useHumanProfileActions } from '../relationship/use-human-profile-actions.js';
import { useHumanContactAdmission } from './chat-human-contact-admission.js';
import { ChatAvatarPopover } from './chat-avatar-popover.js';

export type ChatHumanIdentity = { id: string; name: string; handle?: string | null; avatarUrl?: string | null; deleted?: boolean };
type Props = { person: ChatHumanIdentity; placement: 'composer' | 'rail' | 'message'; onSelect?: () => void; children: ReactElement };

// @nimi-authority: rule.nimi.desktop.product-surfaces.r030
export function ChatHumanAvatarCard(props: Props) {
  const auth = useAppStore(state => state.auth);
  const realm = useAppStore(state => state.runtimeDefaults?.realm.realmBaseUrl ?? '');
  return <HumanAvatarCard key={JSON.stringify([realm, auth.user?.realmEnvironmentId, auth.user?.id, auth.authorizationRevision, props.person.id])} {...props} />;
}

function HumanAvatarCard({ person, placement, onSelect, children }: Props) {
  const { t, i18n } = useTranslation();
  const store = useAppStoreApi();
  const auth = useAppStore(state => state.auth);
  const realm = useAppStore(state => state.runtimeDefaults?.realm.realmBaseUrl ?? '');
  const viewerId = String(auth.user?.id ?? '');
  const environment = String(auth.user?.realmEnvironmentId ?? '');
  const authenticated = auth.status === 'authenticated';
  const self = person.id === viewerId;
  const sdk = useDesktopRendererBindings().sdk;
  const social = useRealmSocialData();
  const navigation = useHomeNavigation();
  const cache = useQueryClient();
  const [open, setOpen] = useState(false);
  const admission = useHumanContactAdmission(open && !self ? person.id : null, person.deleted);
  const profileQuery = useQuery({
    queryKey: ['human-profile-preview', realm, environment, viewerId, auth.authorizationRevision, person.id],
    queryFn: async () => {
      const scope = captureAccountActionScope(store);
      if (!scope) throw new Error("No active account to load this profile.");
      try {
        const profile = await loadContextualHumanProfile(person.id, {
          loadUserProfile: id => social.loadUserProfile(id),
          loadRelationship: id => sdk.realm().social.getMyRelationshipWithUser({ path: { id } }),
        }, { id: person.id, displayName: person.name, handle: person.handle ?? '', avatarUrl: person.avatarUrl });
        if (!scope.isCurrent()) throw new Error("Signed-in account changed while loading this profile.");
        return profile;
      } finally { scope.dispose(); }
    },
    enabled: open && authenticated && !person.deleted, staleTime: 0, retry: false,
  });
  const profile = authenticated && !profileQuery.isError && !profileQuery.isFetching ? profileQuery.data : undefined;
  const name = person.deleted ? t('Relationship.contacts.deletedUser') : profile?.displayName || person.name;
  const handle = profile?.handle || person.handle;
  const actions = useHumanProfileActions(authenticated && !self && !person.deleted ? {
    id: person.id, displayName: name, relationshipId: admission.relationship?.relationshipId, relationship: admission.relationship,
  } : null);
  const act = (action: (() => void) | undefined) => { if (action) { action(); setOpen(false); } };
  const menu = [
    { id: 'cancel', label: t('Chat.humanCard.cancelRequest'), action: actions.props.onCancelRequest },
    { id: 'reject', label: t('Chat.humanCard.reject'), action: actions.props.onRejectRequest },
    { id: 'remove', label: t('Profile.removeFriend'), action: actions.props.onRemove },
    { id: 'block', label: t('Profile.blockUser'), action: actions.props.onBlock },
    { id: 'unblock', label: t('Profile.unblock'), action: actions.props.onUnblock },
    { id: 'report', label: t('Relationship.report.action'), action: actions.props.onReport },
  ].filter(item => item.action);
  const regionNames = new Intl.DisplayNames([i18n.resolvedLanguage || 'en'], { type: 'region' });
  const languageNames = new Intl.DisplayNames([i18n.resolvedLanguage || 'en'], { type: 'language' });
  const readable = (names: Intl.DisplayNames, value: string) => { try { return names.of(value) || value; } catch { return value; } };
  const location = [profile?.city, profile?.countryCode ? readable(regionNames, profile.countryCode.toUpperCase()) : null].filter(Boolean).join(' · ');
  const openProfile = () => {
    if (!authenticated || person.deleted) return;
    if (!self) cache.setQueryData(['chat-peer-identity', environment, viewerId, person.id], { id: person.id, displayName: name, handle: handle || '', avatarUrl: profile?.avatarUrl || person.avatarUrl || null });
    setOpen(false); void navigation.push({ id: 'profile', profileId: person.id });
  };
  return <>
    <ChatAvatarPopover open={open && !person.deleted} onOpenChange={setOpen} placement={placement} onSelect={onSelect}
      label={name} testId="chat-human-profile-card" className="human-profile-preview" trigger={children}>
      <div className="human-profile-preview-body">
        <div className="human-profile-preview-identity">
          <EntityAvatar name={name} imageUrl={profile?.avatarUrl || person.avatarUrl} media={profile?.avatarMedia} kind="human" sizeClassName="h-16 w-16 shrink-0" textClassName="text-xl font-semibold" />
          <div className="min-w-0 flex-1"><h3>{name}</h3>{handle ? <p>@{handle.replace(/^@+/, '')}</p> : null}</div>
          {menu.length ? <details className="human-profile-preview-more"><summary aria-label={t('Chat.humanCard.more')}><MoreHorizontal aria-hidden size={19} /></summary>
            <div role="group" aria-label={t('Relationship.contacts.personActions', { name })}>{menu.map(item => <button key={item.id} type="button" disabled={actions.props.actionsPending} onClick={() => act(item.action)}>{item.label}</button>)}</div>
          </details> : null}
        </div>
        {profile?.accessState === 'restricted' ? <p className="human-profile-preview-note">{t('Chat.humanCard.restricted')}</p> : <>
          {profile?.bio ? <p className="human-profile-preview-bio">{profile.bio}</p> : null}
          {profile?.tags.length ? <p className="human-profile-preview-tags">{profile.tags.slice(0, 2).join(' · ')}</p> : null}
          {location ? <p className="human-profile-preview-meta"><MapPin aria-hidden size={14} />{location}</p> : null}
          {profile?.languages.length ? <p className="human-profile-preview-meta"><Languages aria-hidden size={14} />{profile.languages.map(value => readable(languageNames, value)).join(' · ')}</p> : null}
        </>}
        {profileQuery.isError ? <p className="human-profile-preview-note" role="status">{t('Chat.humanCard.unavailable')} <button type="button" onClick={() => { void profileQuery.refetch(); }}>{t('Common.retry')}</button></p> : null}
        {admission.blockedByMe ? <p className="human-profile-preview-note">{t('Chat.humanCard.blocked')}</p> : admission.relationship?.state === 'pending_outgoing' ? <p className="human-profile-preview-note">{t('Chat.humanCard.requestSent')}</p> : null}
        {admission.relationship?.state === 'pending_incoming' ? <p className="human-profile-preview-note">{t('Chat.humanCard.requestReceived')}</p> : null}
        <div className="human-profile-preview-actions">
          <button type="button" disabled={!authenticated || person.deleted} onClick={openProfile}>{t('Chat.humanCard.viewProfile')}<ArrowRight aria-hidden size={16} /></button>
          {actions.props.onAddFriend ? <button type="button" disabled={actions.props.actionsPending} onClick={() => act(actions.props.onAddFriend)}>{t('ProfileView.addFriend')}</button> : null}
          {actions.props.onAcceptRequest ? <button type="button" disabled={actions.props.actionsPending} onClick={() => act(actions.props.onAcceptRequest)}>{t('Chat.humanCard.accept')}</button> : null}
        </div>
      </div>
    </ChatAvatarPopover>
    {actions.dialog}
  </>;
}
