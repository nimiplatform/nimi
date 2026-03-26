import type { ReactNode } from 'react';
import {
  Button,
  StatusBadge,
  Surface,
  TextareaField,
} from '@nimiplatform/nimi-kit/ui';
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
    <Surface tone="card" className="rounded-2xl bg-[var(--nimi-surface-panel)] p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--nimi-text-muted)]">{label}</div>
      <div className="mt-3 flex items-center gap-3">
        {renderAvatar ? (
          renderAvatar
        ) : (
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[var(--nimi-surface-card)] text-sm font-semibold text-[var(--nimi-text-secondary)]">
            {name[0]?.toUpperCase() || '?'}
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--nimi-text-primary)]">{name}</p>
          <p className="truncate text-xs text-[var(--nimi-text-muted)]">{party?.handle || ''}</p>
        </div>
      </div>
    </Surface>
  );
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <Surface tone="card" className="rounded-2xl p-4">
      <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--nimi-text-muted)]">{label}</div>
      <div className="mt-2 font-medium text-[var(--nimi-text-primary)]">{value}</div>
    </Surface>
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
    <Surface tone="card" className="rounded-[28px] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-[color-mix(in_srgb,var(--nimi-status-warning)_15%,transparent)] text-3xl">
            {gift.gift?.emoji || '🎁'}
          </div>
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold text-[var(--nimi-text-primary)]">
                {gift.gift?.name || unknownGiftLabel}
              </h2>
              <GiftStatusBadge status={status} label={getStatusLabel(status)} />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--nimi-text-muted)]">
              <StatusBadge tone="warning">{sparkAmountLabel(gift.sparkCost)}</StatusBadge>
              <span>{gemAmountLabel(gift.gemToReceiver || 0)}</span>
              <span>{formatDate(gift.createdAt)}</span>
            </div>
          </div>
        </div>

        <Surface tone="card" className="rounded-2xl bg-[var(--nimi-surface-panel)] px-4 py-3 text-sm text-[var(--nimi-text-secondary)]">
          <div className="font-medium text-[var(--nimi-text-primary)]">{transactionLabel}</div>
          <div className="mt-1 break-all text-xs text-[var(--nimi-text-muted)]">{gift.id}</div>
        </Surface>
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
        <div className="mt-5 rounded-2xl bg-[color-mix(in_srgb,var(--nimi-status-success)_10%,var(--nimi-surface-card))] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--nimi-status-success)]">{senderMessageLabel}</div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--nimi-text-primary)]">{gift.message}</p>
        </div>
      ) : null}

      {gift.rejectReason ? (
        <div className="mt-4 rounded-2xl bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,var(--nimi-surface-card))] p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--nimi-status-danger)]">{rejectReasonLabel}</div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--nimi-text-primary)]">{gift.rejectReason}</p>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 text-sm text-[var(--nimi-text-secondary)] md:grid-cols-3">
        <MetaCard label={expiresAtLabel} value={formatDate(gift.expiresAt)} />
        <MetaCard label={acceptedAtLabel} value={formatDate(gift.acceptedAt || null)} />
        <MetaCard label={rejectedAtLabel} value={formatDate(gift.rejectedAt || null)} />
      </div>

      {status === 'PENDING' && isReceiver ? (
        <Surface tone="card" className="mt-6 rounded-2xl bg-[var(--nimi-surface-panel)] p-4">
          <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">{pendingTitle}</div>
          <p className="mt-1 text-sm text-[var(--nimi-text-muted)]">{pendingDescription}</p>
          <label className="mt-4 block text-xs font-semibold uppercase tracking-[0.08em] text-[var(--nimi-text-muted)]" htmlFor="gift-inbox-reject-reason">
            {rejectReasonOptionalLabel}
          </label>
          <TextareaField
            id="gift-inbox-reject-reason"
            value={rejectReason}
            onChange={(event) => onRejectReasonChange(event.target.value)}
            rows={3}
            maxLength={160}
            placeholder={rejectReasonPlaceholder}
            className="mt-2 rounded-2xl"
            textareaClassName="resize-none px-4 py-3 text-sm"
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              tone="primary"
              disabled={pendingAction !== null}
              onClick={onAccept}
              className="rounded-2xl"
            >
              {pendingAction === 'accept' ? acceptingLabel : acceptLabel}
            </Button>
            <Button
              type="button"
              tone="secondary"
              disabled={pendingAction !== null}
              onClick={onReject}
              className="rounded-2xl"
            >
              {pendingAction === 'reject' ? rejectingLabel : rejectLabel}
            </Button>
          </div>
        </Surface>
      ) : null}

      {status === 'ACCEPTED' && isReceiver ? (
        <Surface className="mt-6 rounded-2xl border-[color-mix(in_srgb,var(--nimi-status-success)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-success)_10%,var(--nimi-surface-card))] p-4">
          <div className="text-sm font-semibold text-[var(--nimi-text-primary)]">{withdrawTitle}</div>
          <p className="mt-1 text-sm text-[var(--nimi-text-secondary)]">{withdrawDescription}</p>
          <Button type="button" tone="primary" onClick={onOpenWallet} className="mt-4 rounded-2xl">
            {openWalletLabel}
          </Button>
        </Surface>
      ) : null}

      {!isReceiver ? (
        <Surface tone="card" className="mt-6 rounded-2xl bg-[var(--nimi-surface-panel)] p-4 text-sm text-[var(--nimi-text-secondary)]">
          {senderReadonlyLabel}
        </Surface>
      ) : null}
    </Surface>
  );
}
