import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dataSync } from '@runtime/data-sync';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '@renderer/components/action.js';
import { EntityAvatar } from '@renderer/components/entity-avatar.js';
import { formatLocaleNumber } from '@renderer/i18n';
import { OverlayShell } from '@renderer/components/overlay.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import {
  normalizeGiftCatalog,
  resolveSelectedGiftId,
} from './send-gift-modal-model';

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

function formatSparkCost(value: number): string {
  return formatLocaleNumber(value, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  });
}

export function SendGiftModal(props: SendGiftModalProps) {
  const { t } = useTranslation();
  const [selectedGiftId, setSelectedGiftId] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const catalogQuery = useQuery({
    queryKey: ['gift-catalog'],
    queryFn: async () => normalizeGiftCatalog(await dataSync.loadGiftCatalog()),
    enabled: props.open,
  });
  const giftOptions = catalogQuery.data || [];
  const selectedGift = giftOptions.find((item) => item.id === selectedGiftId) || null;

  useEffect(() => {
    if (!props.open) {
      setSelectedGiftId('');
      setMessage('');
      setSending(false);
      sendingRef.current = false;
      setError(null);
    }
  }, [props.open]);

  useEffect(() => {
    if (!props.open) {
      return;
    }
    setSelectedGiftId((currentId) => resolveSelectedGiftId(giftOptions, currentId));
  }, [giftOptions, props.open]);

  const handleSend = async () => {
    if (sendingRef.current || !selectedGiftId || !props.receiverId) {
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      await dataSync.sendGift({
        receiverId: props.receiverId,
        giftId: selectedGiftId,
        message: message.trim() || undefined,
      });
      props.onSent?.();
      props.onClose();
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : t('GiftSend.sendGiftFailed', { defaultValue: 'Failed to send gift' }));
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  if (!props.open) {
    return null;
  }

  const isCatalogLoading = catalogQuery.isPending && giftOptions.length === 0;
  const isCatalogLoadError = catalogQuery.isError && giftOptions.length === 0;
  const isCatalogEmpty = !isCatalogLoading && !isCatalogLoadError && giftOptions.length === 0;
  const sparkCostLabel = selectedGift ? formatSparkCost(selectedGift.sparkCost) : '--';

  return (
    <OverlayShell
      open={props.open}
      kind="dialog"
      onClose={props.onClose}
      dataTestId={E2E_IDS.sendGiftDialog}
      panelClassName="max-w-sm rounded-3xl"
      contentClassName="px-6 pb-6 pt-0"
      title={(
        <div className="flex items-center justify-between px-1">
          <h2 className="text-lg font-semibold text-gray-900">{t('GiftSend.sendGift') || 'Send Gift'}</h2>
          <IconButton
            icon={<CloseIcon className="h-5 w-5" />}
            onClick={props.onClose}
            aria-label={t('Common.close', { defaultValue: 'Close' })}
            className="h-8 w-8 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          />
        </div>
      )}
    >
          <div className="flex flex-col items-center pb-6">
            <div className="relative">
              <EntityAvatar
                imageUrl={props.receiverAvatarUrl}
                name={props.receiverName}
                kind={props.receiverIsAgent === true ? 'agent' : 'human'}
                sizeClassName="h-20 w-20"
                className={props.receiverIsAgent === true ? undefined : 'ring-4 ring-[#E0F7F4]'}
                textClassName="text-2xl font-bold"
                fallbackClassName={props.receiverIsAgent === true ? undefined : 'bg-gradient-to-br from-[#E0F7F4] to-[#C5F0E8] text-[#4ECCA3]'}
              />
            </div>
            <h3 className="mt-3 text-lg font-semibold text-gray-900">{props.receiverName}</h3>
            <p className="text-sm text-gray-500">{props.receiverHandle || ''}</p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-[#F8FCFB] p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">{t('GiftSend.selectGift') || 'Select Gift'}</p>
                <p className="text-xs text-gray-500">{t('GiftSend.sparkCost') || 'Spark Cost'}</p>
              </div>
              <div className="inline-flex items-center gap-1 rounded-full bg-[#E8F8F3] px-3 py-1 text-xs font-semibold text-[#2A9D8F]">
                <SparkIcon className="h-3.5 w-3.5" />
                <span>{t('GiftSend.sparkUnit') || 'SPARK'}</span>
              </div>
            </div>

            {isCatalogLoading ? (
              <div className="flex items-center justify-center gap-3 rounded-2xl border border-dashed border-[#B8E9DC] bg-white px-4 py-8 text-sm text-gray-500">
                <LoadingSpinner className="h-4 w-4 text-[#4ECCA3]" />
                <span>{t('GiftSend.loadingCatalog') || 'Loading gifts...'}</span>
              </div>
            ) : null}

            {isCatalogLoadError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                <p className="text-sm font-medium text-red-700">
                  {catalogQuery.error?.message || t('GiftSend.loadCatalogFailed', { defaultValue: 'Failed to load gifts.' })}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    void catalogQuery.refetch();
                  }}
                  className="mt-3 inline-flex rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                >
                  {t('GiftSend.retryLoadCatalog') || 'Retry'}
                </button>
              </div>
            ) : null}

            {isCatalogEmpty ? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-white px-4 py-8 text-center">
                <p className="text-sm font-semibold text-gray-800">{t('GiftSend.emptyCatalog') || 'No gifts available'}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {t('GiftSend.emptyCatalogDescription') || 'Gift catalog is currently unavailable.'}
                </p>
              </div>
            ) : null}

            {!isCatalogLoading && !isCatalogLoadError && !isCatalogEmpty ? (
              <div className="grid grid-cols-3 gap-3">
                {giftOptions.map((gift) => (
                  <button
                    key={gift.id}
                    type="button"
                    onClick={() => {
                      setSelectedGiftId(gift.id);
                      setError(null);
                    }}
                    className={`rounded-2xl border-2 bg-white px-3 py-4 text-left transition ${
                      gift.id === selectedGiftId
                        ? 'border-[#4ECCA3] shadow-[0_0_0_4px_rgba(78,204,163,0.12)]'
                        : 'border-transparent hover:border-[#B8E9DC]'
                    }`}
                  >
                    <div className="flex justify-center">
                      {gift.iconUrl ? (
                        <img src={gift.iconUrl} alt={gift.name} className="h-10 w-10 rounded-xl object-cover" />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E8F8F3] text-2xl">
                          {gift.emoji}
                        </div>
                      )}
                    </div>
                    <p className="mt-3 truncate text-center text-sm font-semibold text-gray-900">{gift.name}</p>
                    <p className="mt-1 text-center text-xs font-medium text-[#2A9D8F]">
                      {formatSparkCost(gift.sparkCost)} {t('GiftSend.sparkUnit') || 'SPARK'}
                    </p>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mt-6">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-gray-400">
              {t('GiftSend.messageOptional') || 'Message (Optional)'}
            </label>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value.slice(0, 200))}
              rows={3}
              placeholder={t('GiftSend.addNiceMessage') || 'Add a nice message...'}
              className="w-full resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-[#4ECCA3] focus:bg-white focus:ring-2 focus:ring-[#4ECCA3]/20"
            />
            <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-400">
              <LockIcon className="h-3.5 w-3.5" />
              <span>{t('GiftSend.onlyRecipientCanSee') || 'Only recipient can see'}</span>
            </div>
          </div>

          {error ? (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          ) : null}

          <Button
            tone="primary"
            onClick={() => { void handleSend(); }}
            disabled={!selectedGift || isCatalogLoading || isCatalogLoadError || isCatalogEmpty || sending}
            className={`mt-6 flex w-full items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-semibold ${
              selectedGift && !isCatalogLoading && !isCatalogLoadError && !isCatalogEmpty && !sending
                ? 'bg-[#4ECCA3] text-white hover:bg-[#3DBA92] hover:shadow-lg hover:shadow-[#4ECCA3]/25'
                : 'bg-[#E8EAED] text-gray-400'
            }`}
          >
            {sending ? (
              <>
                <LoadingSpinner className="h-4 w-4" />
                {t('GiftSend.sending') || 'Sending...'}
              </>
            ) : selectedGift ? (
              <>
                <span>{t('GiftSend.sendGift') || 'Send Gift'}</span>
                <span className="opacity-60">|</span>
                <span>{sparkCostLabel} {t('GiftSend.sparkUnit') || 'SPARK'}</span>
                <SendIcon className="h-4 w-4" />
              </>
            ) : (
              <>
                {t('GiftSend.sendGift') || 'Send Gift'}
                <SendIcon className="h-4 w-4" />
              </>
            )}
          </Button>
    </OverlayShell>
  );
}

function SparkIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
}

function CloseIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function LockIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function SendIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function LoadingSpinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}
