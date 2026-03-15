import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import type { ProfileData, ProfileTab } from './profile-model';
import { AlertIcon, ProfileHeroSection, ProfileLoadingSkeleton, ProfileTabPanel } from './profile-view-parts';
import { dataSync } from '@runtime/data-sync';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';

type ProfileViewProps = {
  profile: ProfileData;
  isOwnProfile: boolean;
  loading: boolean;
  error: boolean;
  onBack: () => void;
  onMessage: () => void;
  onAddFriend: () => void;
  canAddFriend?: boolean;
  addFriendHint?: string | null;
  onSendGift: () => void;
  showMessageButton?: boolean;
  sidebarStyleVariant?: 'default' | 'agent';
};

export function ProfileView(props: ProfileViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ProfileTab>('Posts');
  const [showMenu, setShowMenu] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return;
    
    const handleClickOutside = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        menuButtonRef.current &&
        !menuButtonRef.current.contains(event.target as Node)
      ) {
        setShowMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const handleBlock = () => {
    setShowMenu(false);
    setShowBlockModal(true);
  };

  const confirmBlock = async () => {
    setIsBlocking(true);
    try {
      await dataSync.blockUser({
        id: props.profile.id,
        displayName: props.profile.displayName,
        handle: props.profile.handle,
        avatarUrl: props.profile.avatarUrl,
      });
      
      // Optimistically update the contacts cache to show the blocked user immediately
      queryClient.setQueriesData({ queryKey: ['contacts'], exact: false }, (oldData: unknown) => {
        if (!oldData || typeof oldData !== 'object') return oldData;
        const data = oldData as Record<string, unknown>;
        const currentBlocked = Array.isArray(data.blocked) ? data.blocked : [];
        
        // Check if user is already in blocked list
        const alreadyBlocked = currentBlocked.some((u: Record<string, unknown>) => u.id === props.profile.id);
        if (alreadyBlocked) return oldData;
        
        // Add the blocked user to the list
        return {
          ...data,
          blocked: [
            ...currentBlocked,
            {
              id: props.profile.id,
              displayName: props.profile.displayName,
              handle: props.profile.handle,
              avatarUrl: props.profile.avatarUrl,
              isAgent: false,
            },
          ],
        };
      });
      
      // Also refetch to ensure data is in sync with backend
      await queryClient.refetchQueries({ queryKey: ['contacts'], exact: false, type: 'all' });
      
      setShowBlockModal(false);
      // Navigate back after blocking
      props.onBack();
    } catch (error) {
      logRendererEvent({
        level: 'error',
        area: 'profile',
        message: 'action:block-user:failed',
        details: { userId: props.profile.id, error: String(error) },
      });
    } finally {
      setIsBlocking(false);
    }
  };

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = () => {
    setShowMenu(false);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    setIsDeleting(true);
    try {
      await dataSync.removeFriend(props.profile.id);
      await queryClient.refetchQueries({ queryKey: ['contacts'], exact: false, type: 'all' });
      setShowDeleteModal(false);
      props.onBack();
    } catch (error) {
      logRendererEvent({
        level: 'error',
        area: 'profile',
        message: 'action:delete-friend:failed',
        details: { userId: props.profile.id, error: String(error) },
      });
    } finally {
      setIsDeleting(false);
    }
  };

  if (props.loading) {
    return <ProfileLoadingSkeleton />;
  }

  if (props.error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
          <AlertIcon className="h-6 w-6" />
        </div>
        <p className="text-sm text-red-600">{t('ProfileView.error')}</p>
        <button
          type="button"
          onClick={props.onBack}
          className="rounded-2xl bg-white/80 px-4 py-2 text-sm font-medium text-gray-700 backdrop-blur-sm transition hover:bg-white"
        >
          {t('Common.back')}
        </button>
      </div>
    );
  }

  const { profile } = props;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#F0F4F8]">
      <ScrollShell className="flex-1" contentClassName="mx-auto max-w-7xl px-5 py-5">
        <div className="overflow-hidden rounded-[28px] border border-[#dbe3ea] bg-white shadow-[0_24px_70px_rgba(15,23,42,0.08)]">
          <ProfileHeroSection
            profile={profile}
            isOwnProfile={props.isOwnProfile}
            onBack={props.onBack}
            onMessage={props.onMessage}
            onSendGift={props.onSendGift}
            addFriendHint={props.addFriendHint}
            showMessageButton={props.showMessageButton}
            t={t}
            menuSlot={(
              <>
                <button
                  ref={menuButtonRef}
                  type="button"
                  onClick={() => setShowMenu(!showMenu)}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/35 bg-white/16 text-white backdrop-blur-md transition hover:bg-white/24"
                  title={t('Common.moreOptions', { defaultValue: 'More options' })}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="6" cy="12" r="2" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="18" cy="12" r="2" />
                  </svg>
                </button>
                {showMenu && (
                  <div
                    ref={menuRef}
                    className="absolute right-0 top-full mt-2 w-44 rounded-2xl border border-gray-100 bg-white py-1.5 shadow-[0_18px_50px_rgba(15,23,42,0.16)]"
                  >
                    <button
                      type="button"
                      onClick={handleBlock}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-gray-700 transition hover:bg-gray-50"
                    >
                      <AlertIcon className="h-4 w-4 text-gray-400" />
                      {t('Common.block', { defaultValue: 'Block' })}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 transition hover:bg-red-50"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                      {t('Profile.deleteFriend', { defaultValue: 'Delete Friend' })}
                    </button>
                  </div>
                )}
              </>
            )}
          />
          <ProfileTabPanel
            profile={profile}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            isOwnProfile={props.isOwnProfile}
            t={t}
          />
        </div>
      </ScrollShell>

      {/* Delete Friend Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="relative mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <svg className="h-6 w-6 text-red-600" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">
              {t('Profile.removeFriend', { defaultValue: 'Remove Friend' })}
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              Are you sure you want to remove <span className="font-medium text-gray-900">{props.profile.displayName}</span> from your friends?
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                disabled={isDeleting}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
              >
                {t('Common.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={isDeleting}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {isDeleting
                  ? t('Profile.removing', { defaultValue: 'Removing...' })
                  : t('Common.remove', { defaultValue: 'Remove' })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Block Confirmation Modal */}
      {showBlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="relative mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
              <svg className="h-6 w-6 text-red-600" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">
              {t('Profile.blockUser', { defaultValue: 'Block User' })}
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              {t('Profile.blockContactMessagePrefix', { defaultValue: 'Are you sure you want to block' })}{' '}
              <span className="font-medium text-gray-900">{props.profile.displayName}</span>
              ? {t('Profile.blockContactMessageSuffix', { defaultValue: 'They will be moved to your Blocked list and won\'t be able to contact you.' })}
            </p>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setShowBlockModal(false)}
                disabled={isBlocking}
                className="flex-1 rounded-xl px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-100 disabled:opacity-50"
              >
                {t('Common.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                type="button"
                onClick={confirmBlock}
                disabled={isBlocking}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {isBlocking
                  ? t('Profile.blocking', { defaultValue: 'Blocking...' })
                  : t('Common.block', { defaultValue: 'Block' })}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
