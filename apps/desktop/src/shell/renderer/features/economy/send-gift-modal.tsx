import { SendGiftDialog } from '@nimiplatform/nimi-kit/features/commerce/ui';
import {
  useRealmSendGiftDialog,
} from '@nimiplatform/nimi-kit/features/commerce/realm';
import { useTranslation } from 'react-i18next';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

type SendGiftModalProps = {
  open: boolean;
  receiverId: string;
  receiverName: string;
  receiverHandle?: string;
  receiverIsAgent?: boolean;
  receiverAvatarUrl?: string | null;
  onClose: () => void;
  onSent?: () => void;
};

export function SendGiftModal(props: SendGiftModalProps) {
  const { t } = useTranslation();
  const state = useRealmSendGiftDialog({
    open: props.open,
    receiverId: props.receiverId,
    onSent: props.onSent,
  });

  return (
    <SendGiftDialog
      open={props.open}
      state={state}
      onClose={props.onClose}
      dataTestId={E2E_IDS.sendGiftDialog}
      recipient={{
        id: props.receiverId,
        name: props.receiverName,
        handle: props.receiverHandle,
        avatarUrl: props.receiverAvatarUrl,
        isAgent: props.receiverIsAgent,
      }}
      renderRecipientAvatar={(
        <EntityAvatar
          imageUrl={props.receiverAvatarUrl}
          name={props.receiverName}
          kind={props.receiverIsAgent === true ? 'agent' : 'human'}
          sizeClassName="h-20 w-20"
          className={props.receiverIsAgent === true ? undefined : 'ring-4 ring-[#E0F7F4]'}
          textClassName="text-2xl font-bold"
          fallbackClassName={props.receiverIsAgent === true ? undefined : 'bg-gradient-to-br from-[#E0F7F4] to-[#C5F0E8] text-[#4ECCA3]'}
        />
      )}
      title={t('GiftSend.sendGift', { defaultValue: 'Send Gift' })}
      closeLabel={t('Common.close', { defaultValue: 'Close' })}
      selectGiftLabel={t('GiftSend.selectGift', { defaultValue: 'Select Gift' })}
      sparkCostLabel={t('GiftSend.sparkCost', { defaultValue: 'Spark Cost' })}
      sparkUnitLabel={t('GiftSend.sparkUnit', { defaultValue: 'SPARK' })}
      loadingCatalogLabel={t('GiftSend.loadingCatalog', { defaultValue: 'Loading gifts...' })}
      loadCatalogFailedLabel={t('GiftSend.loadCatalogFailed', { defaultValue: 'Failed to load gifts.' })}
      retryLoadCatalogLabel={t('GiftSend.retryLoadCatalog', { defaultValue: 'Retry' })}
      emptyCatalogLabel={t('GiftSend.emptyCatalog', { defaultValue: 'No gifts available' })}
      emptyCatalogDescription={t('GiftSend.emptyCatalogDescription', { defaultValue: 'Gift catalog is currently unavailable.' })}
      messageLabel={t('GiftSend.messageOptional', { defaultValue: 'Message (Optional)' })}
      messagePlaceholder={t('GiftSend.addNiceMessage', { defaultValue: 'Add a nice message...' })}
      recipientOnlyLabel={t('GiftSend.onlyRecipientCanSee', { defaultValue: 'Only recipient can see' })}
      sendGiftLabel={t('GiftSend.sendGift', { defaultValue: 'Send Gift' })}
      sendingLabel={t('GiftSend.sending', { defaultValue: 'Sending...' })}
    />
  );
}
