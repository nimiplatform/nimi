import { Button, StatusBadge } from '@nimiplatform/kit/ui';
import {
  getNimiNotificationBadgeKey,
  getNimiNotificationCategory,
} from '@nimiplatform/kit/core/notifications';
import type { SettingsRouteViewProps } from './view';

export function SettingsRealmRows(props: SettingsRouteViewProps) {
  const {
    walletProjection,
    refreshWalletProjection,
    giftTransactionProjection,
    refreshGiftTransactionProjection,
    notificationProjection,
    refreshNotificationProjection,
    notificationListProjection,
    refreshNotificationListProjection,
    resourceUploadProjection,
    accountDataProjection,
    requestAccountDataExportProjection,
    accountSettingsProjection,
    refreshAccountSettingsProjection,
    humanChatProjection,
    refreshHumanChatProjection,
    groupChatProjection,
    refreshGroupChatProjection,
    realmKit: {
      realmMediaUrlProjection,
      realmEndpointProjection,
      realmRealtimeProjection,
      realmFeedScopeProjection,
      realmChatAttachmentProjection,
      avatarVoiceCueProjection,
      avatarFramingProjection,
      runtimeAvatarVoiceProjection,
    },
  } = props;
  const notificationListStatusLabel = (() => {
    if (notificationListProjection.status === 'ready') {
      const firstItem = notificationListProjection.list.items[0];
      if (!firstItem) {
        return '0 items via system filter';
      }
      const itemCount = notificationListProjection.list.items.length;
      const plural = itemCount === 1 ? '' : 's';
      const category = getNimiNotificationCategory(firstItem.type);
      const badgeKey = getNimiNotificationBadgeKey(firstItem);
      return `${itemCount} item${plural}; first ${category}:${badgeKey}`;
    }
    if (notificationListProjection.status === 'error') {
      return notificationListProjection.error;
    }
    return 'not loaded';
  })();

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Realm wallet projection</span>
        <div className="inline-flex items-center gap-2">
          {walletProjection.status === 'ready' ? (
            <>
              <StatusBadge tone="info">Spark {walletProjection.balances.sparkBalance}</StatusBadge>
              <StatusBadge tone="success">Gem {walletProjection.balances.gemBalance}</StatusBadge>
            </>
          ) : (
            <StatusBadge tone={walletProjection.status === 'error' ? 'danger' : 'neutral'}>
              {walletProjection.status === 'error' ? walletProjection.error : 'not loaded'}
            </StatusBadge>
          )}
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={walletProjection.status === 'loading'}
            onClick={() => {
              void refreshWalletProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Realm gift transaction projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={giftTransactionProjection.status === 'error' ? 'danger' : 'info'}>
            {giftTransactionProjection.status === 'ready'
              ? `${giftTransactionProjection.gift.id}: ${giftTransactionProjection.gift.giftStatus}`
              : giftTransactionProjection.status === 'error'
                ? giftTransactionProjection.error
                : 'not loaded'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={giftTransactionProjection.status === 'loading'}
            onClick={() => {
              void refreshGiftTransactionProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Realm notification projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={notificationProjection.status === 'error' ? 'danger' : 'info'}>
            {notificationProjection.status === 'ready'
              ? `Unread ${notificationProjection.unread.total}`
              : notificationProjection.status === 'error'
                ? notificationProjection.error
                : 'not loaded'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={notificationProjection.status === 'loading'}
            onClick={() => {
              void refreshNotificationProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Realm notification list + Kit headless projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={notificationListProjection.status === 'error' ? 'danger' : 'info'}>
            {notificationListStatusLabel}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={notificationListProjection.status === 'loading'}
            onClick={() => {
              void refreshNotificationListProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Realm media URL projection</span>
        <StatusBadge tone="neutral">{realmMediaUrlProjection}</StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Realm resource upload projection</span>
        <StatusBadge tone={resourceUploadProjection.status === 'ready' ? 'success' : resourceUploadProjection.status === 'error' ? 'danger' : 'neutral'}>
          {resourceUploadProjection.status === 'ready'
            ? `${resourceUploadProjection.summary.resourceId}: ${resourceUploadProjection.summary.status}`
            : resourceUploadProjection.status === 'error'
              ? resourceUploadProjection.error
              : 'checking'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Realm account-data export projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={accountDataProjection.status === 'error' ? 'danger' : 'info'}>
            {accountDataProjection.status === 'ready'
              ? `${accountDataProjection.exportRequest.status}${accountDataProjection.exportRequest.taskId ? ` ${accountDataProjection.exportRequest.taskId}` : ''}`
              : accountDataProjection.status === 'error'
                ? accountDataProjection.error
                : 'not requested'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={accountDataProjection.status === 'loading'}
            onClick={() => {
              void requestAccountDataExportProjection();
            }}
          >
            Request
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>SDK Realm account settings projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={accountSettingsProjection.status === 'error' ? 'danger' : 'info'}>
            {accountSettingsProjection.status === 'ready'
              ? `${accountSettingsProjection.eligibility.tier}: ${accountSettingsProjection.eligibility.status}`
              : accountSettingsProjection.status === 'error'
                ? accountSettingsProjection.error
                : 'not loaded'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={accountSettingsProjection.status === 'loading'}
            onClick={() => {
              void refreshAccountSettingsProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Kit Realm human chat projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={humanChatProjection.status === 'error' ? 'danger' : 'info'}>
            {humanChatProjection.status === 'ready'
              ? `${humanChatProjection.chats.items.length} chat${humanChatProjection.chats.items.length === 1 ? '' : 's'}`
              : humanChatProjection.status === 'error'
                ? humanChatProjection.error
                : 'not loaded'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={humanChatProjection.status === 'loading'}
            onClick={() => {
              void refreshHumanChatProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>SDK Realm group chat projection</span>
        <div className="inline-flex items-center gap-2">
          <StatusBadge tone={groupChatProjection.status === 'error' ? 'danger' : 'info'}>
            {groupChatProjection.status === 'ready'
              ? `${groupChatProjection.groups.items.length} group${groupChatProjection.groups.items.length === 1 ? '' : 's'}`
              : groupChatProjection.status === 'error'
                ? groupChatProjection.error
                : 'not loaded'}
          </StatusBadge>
          <Button
            type="button"
            size="sm"
            tone="secondary"
            loading={groupChatProjection.status === 'loading'}
            onClick={() => {
              void refreshGroupChatProjection();
            }}
          >
            Refresh
          </Button>
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Realm endpoint projection</span>
        <StatusBadge tone="neutral">{realmEndpointProjection}</StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Realm realtime projection</span>
        <StatusBadge tone="neutral">{realmRealtimeProjection}</StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Realm feed scope projection</span>
        <StatusBadge tone={realmFeedScopeProjection.agentActivityAdmitted && !realmFeedScopeProjection.localAgentActivityAdmitted ? 'success' : 'warning'}>
          {realmFeedScopeProjection.count} scopes / {realmFeedScopeProjection.agentActivityAdmitted ? 'agent activity' : 'missing'}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Realm chat attachment projection</span>
        <StatusBadge tone="neutral">
          {realmChatAttachmentProjection.targetType} / {realmChatAttachmentProjection.previewText} / {realmChatAttachmentProjection.mediaUrl}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Kit avatar voice cue projection</span>
        <StatusBadge tone="neutral">
          {avatarVoiceCueProjection.visemeId ?? 'silent'} / {avatarVoiceCueProjection.amplitude.toFixed(2)}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Kit avatar framing projection</span>
        <StatusBadge tone="neutral">
          {avatarFramingProjection.vrm} / {avatarFramingProjection.live2d}
        </StatusBadge>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>SDK runtime voice schedule projection</span>
        <StatusBadge tone="neutral">
          {runtimeAvatarVoiceProjection.kind} / {runtimeAvatarVoiceProjection.source} / {runtimeAvatarVoiceProjection.cueCount}
        </StatusBadge>
      </div>
    </>
  );
}
