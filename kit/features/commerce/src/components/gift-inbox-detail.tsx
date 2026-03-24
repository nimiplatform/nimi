import type { ReactNode } from 'react';
import { GiftStatusBadge } from './gift-status-badge.js';
import type {
  CommerceGiftParty,
  CommerceGiftStatus,
  CommerceGiftTransaction,
} from '../types.js';

export type GiftInboxDetailProps = {
  gift: CommerceGiftTransaction;
  status: CommerceGiftStatus;
  isReceiver: boolean;
  rejectReason: string;
  pendingAction: 'accept' | 'reject' | null;
  onRejectReasonChange: (value: string) => void;
  onAccept: () => void;
  onReject: () => void;
  onOpenWallet: () => void;
  renderPartyAvatar?: (party: CommerceGiftParty | null | undefined, role: 'sender' | 'receiver') => ReactNode;
  formatDate: (value: string | null | undefined) => string;
  getPartyDisplayName: (party: CommerceGiftParty | null | undefined) => string;
  getStatusLabel: (status: CommerceGiftStatus) => string;
  sparkAmountLabel: (amount: number) => string;
  gemAmountLabel: (amount: number) => string;
  unknownGiftLabel?: string;
  transactionLabel?: string;
  senderLabel?: string;
  receiverLabel?: string;
  senderMessageLabel?: string;
  rejectReasonLabel?: string;
  expiresAtLabel?: string;
  acceptedAtLabel?: string;
  rejectedAtLabel?: string;
  pendingTitle?: string;
  pendingDescription?: string;
  rejectReasonOptionalLabel?: string;
  rejectReasonPlaceholder?: string;
  acceptLabel?: string;
  acceptingLabel?: string;
  rejectLabel?: string;
  rejectingLabel?: string;
  withdrawTitle?: string;
  withdrawDescription?: string;
  openWalletLabel?: string;
  senderReadonlyLabel?: string;
};

function PartyCard({
  label,
  party,
  renderAvatar,
  getPartyDisplayName,
}: {
  label: string;
  party: CommerceGiftParty | null | undefined;
  renderAvatar?: ReactNode;
  getPartyDisplayName: (party: CommerceGiftParty | null | undefined) => string;
}) {
  const name = getPartyDisplayName(party);
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-400">{label}</div>
      <div className="mt-3 flex items-center gap-3">
        {renderAvatar ? (
          renderAvatar
        ) : (
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-200 text-sm font-semibold text-gray-600">
            {name[0]?.toUpperCase() || '?'}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">{name}</p>
          <p className="truncate text-xs text-gray-500">{party?.handle || ''}</p>
        </div>
      </div>
    </div>
  );
}

export function GiftInboxDetail({
  gift,
  status,
  isReceiver,
  rejectReason,
  pendingAction,
  onRejectReasonChange,
  onAccept,
  onReject,
  onOpenWallet,
  renderPartyAvatar,
  formatDate,
  getPartyDisplayName,
  getStatusLabel,
  sparkAmountLabel,
  gemAmountLabel,
  unknownGiftLabel = 'Gift',
  transactionLabel = 'Transaction',
  senderLabel = 'Sender',
  receiverLabel = 'Receiver',
  senderMessageLabel = 'Sender message',
  rejectReasonLabel = 'Reject reason',
  expiresAtLabel = 'Expires',
  acceptedAtLabel = 'Accepted',
  rejectedAtLabel = 'Rejected',
  pendingTitle = 'Respond to this gift',
  pendingDescription = 'Accepting credits Gem to your internal wallet. Withdrawal stays in Wallet.',
  rejectReasonOptionalLabel = 'Reject reason (optional)',
  rejectReasonPlaceholder = 'Tell the sender why you rejected this gift',
  acceptLabel = 'Accept',
  acceptingLabel = 'Accepting...',
  rejectLabel = 'Reject',
  rejectingLabel = 'Rejecting...',
  withdrawTitle = 'Accepted gifts are now in your wallet',
  withdrawDescription = 'Use Wallet to review your Gem balance and withdraw when eligible.',
  openWalletLabel = 'Open Wallet',
  senderReadonlyLabel = 'You are viewing this gift as the sender. Status changes happen on the receiver side.',
}: GiftInboxDetailProps) {
  return (
    <section className="rounded-[28px] bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-amber-50 text-3xl">
            {gift.gift?.emoji || '🎁'}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold text-gray-900">
                {gift.gift?.name || unknownGiftLabel}
              </h2>
              <GiftStatusBadge status={status} label={getStatusLabel(status)} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
              <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-700">
                {sparkAmountLabel(gift.sparkCost)}
              </span>
              <span>{gemAmountLabel(gift.gemToReceiver || 0)}</span>
              <span>{formatDate(gift.createdAt)}</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl bg-gray-50 px-4 py-3 text-sm text-gray-600">
          <div className="font-medium text-gray-900">{transactionLabel}</div>
          <div className="mt-1 break-all text-xs text-gray-500">{gift.id}</div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <PartyCard
          label={senderLabel}
          party={gift.sender}
          renderAvatar={renderPartyAvatar?.(gift.sender, 'sender')}
          getPartyDisplayName={getPartyDisplayName}
        />
        <PartyCard
          label={receiverLabel}
          party={gift.receiver}
          renderAvatar={renderPartyAvatar?.(gift.receiver, 'receiver')}
          getPartyDisplayName={getPartyDisplayName}
        />
      </div>

      {gift.message ? (
        <div className="mt-5 rounded-2xl bg-mint-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-mint-700">{senderMessageLabel}</div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-mint-950">{gift.message}</p>
        </div>
      ) : null}

      {gift.rejectReason ? (
        <div className="mt-4 rounded-2xl bg-rose-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-rose-700">{rejectReasonLabel}</div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-rose-950">{gift.rejectReason}</p>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 text-sm text-gray-600 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-100 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-400">{expiresAtLabel}</div>
          <div className="mt-2 font-medium text-gray-900">{formatDate(gift.expiresAt)}</div>
        </div>
        <div className="rounded-2xl border border-gray-100 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-400">{acceptedAtLabel}</div>
          <div className="mt-2 font-medium text-gray-900">{formatDate(gift.acceptedAt || null)}</div>
        </div>
        <div className="rounded-2xl border border-gray-100 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-400">{rejectedAtLabel}</div>
          <div className="mt-2 font-medium text-gray-900">{formatDate(gift.rejectedAt || null)}</div>
        </div>
      </div>

      {status === 'PENDING' && isReceiver ? (
        <div className="mt-6 rounded-2xl border border-gray-100 bg-gray-50 p-4">
          <div className="text-sm font-semibold text-gray-900">{pendingTitle}</div>
          <p className="mt-1 text-sm text-gray-500">{pendingDescription}</p>
          <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.08em] text-gray-400" htmlFor="gift-inbox-reject-reason">
            {rejectReasonOptionalLabel}
          </label>
          <textarea
            id="gift-inbox-reject-reason"
            value={rejectReason}
            onChange={(event) => onRejectReasonChange(event.target.value)}
            rows={3}
            maxLength={160}
            placeholder={rejectReasonPlaceholder}
            className="mt-2 w-full resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 outline-none focus:border-mint-300 focus:ring-2 focus:ring-mint-100"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={onAccept}
              className="rounded-2xl bg-mint-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-mint-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pendingAction === 'accept' ? acceptingLabel : acceptLabel}
            </button>
            <button
              type="button"
              disabled={pendingAction !== null}
              onClick={onReject}
              className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pendingAction === 'reject' ? rejectingLabel : rejectLabel}
            </button>
          </div>
        </div>
      ) : null}

      {status === 'ACCEPTED' && isReceiver ? (
        <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
          <div className="text-sm font-semibold text-emerald-900">{withdrawTitle}</div>
          <p className="mt-1 text-sm text-emerald-800">{withdrawDescription}</p>
          <button
            type="button"
            onClick={onOpenWallet}
            className="mt-4 rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-700"
          >
            {openWalletLabel}
          </button>
        </div>
      ) : null}

      {!isReceiver ? (
        <div className="mt-6 rounded-2xl border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
          {senderReadonlyLabel}
        </div>
      ) : null}
    </section>
  );
}
