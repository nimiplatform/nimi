import { MediaImage } from '@nimiplatform/kit/features/media';
import { Button, ScrollArea } from '@nimiplatform/kit/ui';
import { Copy, Pencil, Shield, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '../../components/entity-avatar.js';
import { E2E_IDS } from '../../testability/e2e-ids';
import { formatProfileDate } from '../profile/profile-model';
import { useDesktopI18nResource } from '../../i18n/i18n-context.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { ArrowUpIcon, CalendarIcon, InlineMeta, LocationIcon } from './profile-detail-view-parts.js';
import type { ProfileDetailViewController, ProfileDetailViewProps } from './profile-detail-view-controller.js';
import { ProfileDetailActionButtons } from './profile-detail-view-content-shell.js';
import { FollowedWorldsTab } from '../profile/followed-worlds-tab.js';

export function ProfileDetailViewContent(input: { controller: ProfileDetailViewController } & ProfileDetailViewProps) {
  const bindings = useDesktopRendererBindings();
  const i18n = useDesktopI18nResource();
  const { t } = useTranslation();
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
  const { profile, controller } = input;
  const restricted = !input.isOwnProfile && (input.isRestrictedProfile || profile.accessState === 'restricted');
  const blocked = !input.isOwnProfile && input.isBlockedProfile;
  const location = [profile.city, profile.countryCode?.toUpperCase()].filter(Boolean).join(', ');
  const joined = formatProfileDate(profile.createdAt, i18n.formatDate);
  const handle = '@' + profile.handle.replace(/^@+/, '');
  const copyHandle = async () => {
    try { await bindings.app.commands.writeClipboardText(handle); setCopyFeedback(t('Profile.usernameCopied')); }
    catch { setCopyFeedback(t('Profile.usernameCopyFailed')); }
  };
  const closeMenu = (action?: () => void) => action ? () => { controller.setShowMenu(false); action(); } : undefined;
  const body = (
    <section className="relative">
      <div className="relative h-28 overflow-hidden bg-[linear-gradient(135deg,var(--nimi-ambient-mesh-base-start),var(--nimi-ambient-mesh-base-end))]">
        {profile.coverMedia || profile.coverUrl ? <MediaImage delivery={profile.coverMedia} externalUrl={profile.coverUrl} purpose="hero" sizes="auto, 960px" loading="eager" alt="" className="absolute inset-0 h-full w-full object-cover" /> : null}
        {!input.isOwnProfile && !input.hideBackButton ? <div className="absolute left-5 top-5"><Button tone="secondary" onClick={input.onClose}>{t('Common.back')}</Button></div> : null}
      </div>
      <div className="relative space-y-6 px-5 pb-6 sm:px-8">
        <div className="-mt-8 rounded-[var(--nimi-radius-xl)] bg-[var(--nimi-surface-card)] p-5 shadow-[var(--nimi-elevation-raised)] sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <EntityAvatar imageUrl={profile.avatarUrl} media={profile.avatarMedia} refreshMedia={async () => {
              const updated = input.isOwnProfile ? await bindings.sdk.realm().account.getMe({ path: {} })
                : await bindings.sdk.realm().social.getUser({ path: { id: profile.id } });
              return updated.avatarMedia ?? null;
            }} name={profile.displayName} kind="human" sizeClassName="h-24 w-24 shrink-0" textClassName="text-3xl font-semibold" />
            <div className="min-w-0 flex-1">
              <h1 className="break-words text-2xl font-semibold text-[var(--nimi-text-primary)]">{profile.displayName}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="text-sm text-[var(--nimi-text-secondary)]">{handle}</span>
                {input.isOwnProfile && profile.handle ? <Button tone="ghost" size="sm" leadingIcon={<Copy size={14} />} onClick={() => { void copyHandle(); }}>{t('Profile.copyUsername')}</Button> : null}
              </div>
              {copyFeedback ? <p role="status" className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{copyFeedback}</p> : null}
              {!input.isOwnProfile ? <p className="mt-3 text-sm font-medium text-[var(--nimi-text-secondary)]">{blocked ? t('Profile.relationshipBlocked') : profile.isFriend ? t('Profile.relationshipFriend') : profile.isPendingFriendRequest ? t('Profile.relationshipPending') : profile.relationship?.state === 'pending_incoming' ? t('Profile.relationshipReceived') : t('Profile.relationshipNone')}</p> : null}
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--nimi-text-secondary)]">{restricted ? t('Profile.privateProfileDescription') : profile.bio || t('Profile.noDescription')}</p>
              {!restricted && !blocked ? <>
                <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                  {joined ? <InlineMeta value={t('Profile.joinedOn', { date: joined })} icon={<CalendarIcon className="h-4 w-4" />} /> : null}
                  {location ? <InlineMeta value={location} icon={<LocationIcon className="h-4 w-4" />} /> : null}
                </div>
                {profile.languages.length ? <p className="mt-3 text-sm text-[var(--nimi-text-secondary)]">{t('Profile.languages')}: {profile.languages.join('、')}</p> : null}
                {profile.tags.length ? <ul className="mt-3 flex flex-wrap gap-2" aria-label={t('Relationship.tags')}>{profile.tags.map(tag => <li key={tag} className="rounded-full bg-[var(--nimi-surface-active)] px-3 py-1 text-sm text-[var(--nimi-text-secondary)]">{tag}</li>)}</ul> : null}
              </> : null}
            </div>
          </div>
          <fieldset disabled={input.actionsPending} className="mt-5 flex flex-wrap items-center gap-2">
            {input.isOwnProfile ? <>
              {input.onEditProfile ? <Button tone="primary" leadingIcon={<Pencil size={16} />} onClick={input.onEditProfile}>{t('Relationship.editProfile')}</Button> : null}
              {input.onOpenFriends ? <Button tone="secondary" leadingIcon={<Users size={16} />} onClick={input.onOpenFriends}>{t('Profile.viewFriends')}{profile.stats?.friendsCount != null ? ' (' + profile.stats.friendsCount + ')' : ''}</Button> : null}
              {input.onOpenPrivacy ? <Button tone="ghost" leadingIcon={<Shield size={16} />} onClick={input.onOpenPrivacy}>{t('Profile.managePrivacy')}</Button> : null}
            </> : <ProfileDetailActionButtons onMessage={input.onMessage} onAddFriend={input.onAddFriend}
              showAddFriendButton={!blocked && !profile.isFriend && !profile.isPendingFriendRequest && Boolean(input.onAddFriend)}
              canAddFriend={input.canAddFriend} addFriendLabel={input.addFriendLabel} addFriendHint={input.addFriendHint}
              showMessageButton={input.showMessageButton !== false && !blocked}
              showMoreButton={Boolean(input.onBlock || input.onUnblock || input.onRemove || input.onReport)} showMenu={controller.showMenu}
              onShowMenuChange={controller.setShowMenu} onBlock={closeMenu(input.onBlock)} onUnblock={closeMenu(input.onUnblock)} onRemove={closeMenu(input.onRemove)} onReport={closeMenu(input.onReport)} />}
            {input.onAcceptRequest ? <Button tone="primary" onClick={input.onAcceptRequest}>{t('Relationship.accept')}</Button> : null}
            {input.onRejectRequest ? <Button tone="secondary" onClick={input.onRejectRequest}>{t('Relationship.reject')}</Button> : null}
            {input.onCancelRequest ? <Button tone="secondary" onClick={input.onCancelRequest}>{t('Relationship.contacts.cancelRequest')}</Button> : null}
          </fieldset>
          {!input.isOwnProfile && profile.relationship?.canMessage === false ? <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{t('Profile.cannotMessage')}</p> : null}
          {input.canAddFriend === false && input.addFriendHint ? <p className="mt-2 text-sm text-[var(--nimi-text-secondary)]">{input.addFriendHint}</p> : null}
        </div>
        {input.isOwnProfile ? <section aria-label={t('Profile.tabFollowedWorlds')} className="space-y-3">
          <div><h2 className="text-base font-semibold text-[var(--nimi-text-primary)]">{t('Profile.tabFollowedWorlds')}</h2><p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{t('Profile.followedWorldsDeviceScope')}</p></div>
          <FollowedWorldsTab />
        </section> : null}
      </div>
    </section>
  );
  return <div data-testid={E2E_IDS.profileDetailSurface} className="flex min-h-0 flex-1 flex-col">
    {controller.usesExternalScrollContainer ? body : <ScrollArea className="flex-1" viewportRef={controller.scrollContainerRef}>{body}</ScrollArea>}
    {controller.showScrollTop ? <button type="button" onClick={controller.scrollToTop} aria-label={t('Common.backToTop')} className="fixed bottom-8 right-8 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--nimi-surface-card)] text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-floating)]"><ArrowUpIcon className="h-5 w-5" /></button> : null}
  </div>;
}
