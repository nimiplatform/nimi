import type { ReactNode } from 'react';
import {
  Button,
  IconButton,
  InlineAlert,
  OverlayShell,
  StatusBadge,
  TextareaField,
} from '@nimiplatform/kit/ui';
import { FOCUS_RING_CLASS_NAME } from '@nimiplatform/kit/ui/a11y';
import { DEFAULT_COMMERCE_COPY } from '../copy.js';
import type { CommerceGiftRecipient } from '../types.js';
import type { UseSendGiftDialogResult } from '../hooks/use-send-gift-dialog.js';

function formatSparkCost(value: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function initials(name: string): string {
  const normalized = String(name || '').trim();
  if (!normalized) {
    return '?';
  }
  return normalized[0]?.toUpperCase() || '?';
}

export type SendGiftDialogProps = {
  open: boolean;
  state: UseSendGiftDialogResult;
  recipient: CommerceGiftRecipient;
  onClose: () => void;
  dataTestId?: string;
  panelClassName?: string;
  contentClassName?: string;
  renderRecipientAvatar?: ReactNode;
  title?: string;
  closeLabel?: string;
  selectGiftLabel?: string;
  sparkCostLabel?: string;
  sparkUnitLabel?: string;
  loadingCatalogLabel?: string;
  loadCatalogFailedLabel?: string;
  retryLoadCatalogLabel?: string;
  emptyCatalogLabel?: string;
  emptyCatalogDescription?: string;
  messageLabel?: string;
  messagePlaceholder?: string;
  recipientOnlyLabel?: string;
  sendGiftLabel?: string;
  sendingLabel?: string;
};

export function SendGiftDialog({
  open,
  state,
  recipient,
  onClose,
  dataTestId,
  panelClassName,
  contentClassName,
  renderRecipientAvatar,
  title = DEFAULT_COMMERCE_COPY.sendGiftDialog.title,
  closeLabel = DEFAULT_COMMERCE_COPY.sendGiftDialog.closeLabel,
  selectGiftLabel = DEFAULT_COMMERCE_COPY.sendGiftDialog.selectGiftLabel,
  sparkCostLabel = DEFAULT_COMMERCE_COPY.sendGiftDialog.sparkCostLabel,
  sparkUnitLabel = DEFAULT_COMMERCE_COPY.sendGiftDialog.sparkUnitLabel,
  loadingCatalogLabel = DEFAULT_COMMERCE_COPY.sendGiftDialog.loadingCatalogLabel,
  loadCatalogFailedLabel = DEFAULT_COMMERCE_COPY.sendGiftDialog.loadCatalogFailedLabel,
  retryLoadCatalogLabel = DEFAULT_COMMERCE_COPY.sendGiftDialog.retryLoadCatalogLabel,
  emptyCatalogLabel = DEFAULT_COMMERCE_COPY.sendGiftDialog.emptyCatalogLabel,
  emptyCatalogDescription = DEFAULT_COMMERCE_COPY.sendGiftDialog.emptyCatalogDescription,
  messageLabel = DEFAULT_COMMERCE_COPY.sendGiftDialog.messageLabel,
  messagePlaceholder = DEFAULT_COMMERCE_COPY.sendGiftDialog.messagePlaceholder,
  recipientOnlyLabel = DEFAULT_COMMERCE_COPY.sendGiftDialog.recipientOnlyLabel,
  sendGiftLabel = DEFAULT_COMMERCE_COPY.sendGiftDialog.sendGiftLabel,
  sendingLabel = DEFAULT_COMMERCE_COPY.sendGiftDialog.sendingLabel,
}: SendGiftDialogProps) {
  if (!open) {
    return null;
  }

  const sparkCostLabelText = state.selectedGift ? formatSparkCost(state.selectedGift.sparkCost) : '--';

  return (
    <OverlayShell
      open={open}
      kind="dialog"
      size="S"
      onClose={state.sending ? undefined : onClose}
      dataTestId={dataTestId}
      panelClassName={panelClassName}
      contentClassName={contentClassName}
      title={(
        <div className="flex items-center justify-between gap-4">
          <span>{title}</span>
          <IconButton
            type="button"
            size="sm"
            disabled={state.sending}
            onClick={onClose}
            aria-label={closeLabel}
            icon={(
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            )}
          />
        </div>
      )}
      footer={(
        <Button
          tone="primary"
          onClick={() => {
            void state.handleSend().then((didSend) => {
              if (didSend) {
                onClose();
              }
            });
          }}
          disabled={!state.canSend}
          fullWidth
          className="rounded-[var(--nimi-radius-lg)] py-3.5"
        >
          {state.sending ? (
            <>
              <LoadingSpinner className="h-4 w-4" />
              {sendingLabel}
            </>
          ) : state.selectedGift ? (
            <>
              <span>{sendGiftLabel}</span>
              <span className="opacity-60">|</span>
              <span>{sparkCostLabelText} {sparkUnitLabel}</span>
              <SendIcon className="h-4 w-4" />
            </>
          ) : (
            <>
              {sendGiftLabel}
              <SendIcon className="h-4 w-4" />
            </>
          )}
        </Button>
      )}
    >
      <div className="flex flex-col items-center pb-6">
        <div className="relative">
          {renderRecipientAvatar || (
            recipient.avatarUrl ? (
              <img src={recipient.avatarUrl} alt={recipient.name} className="h-20 w-20 rounded-full object-cover" />
            ) : (
              <div className={`flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold ${
                recipient.isSource
                  ? 'bg-[var(--nimi-surface-card)] text-[var(--nimi-text-secondary)]'
                  : 'bg-[color-mix(in_srgb,var(--nimi-status-success)_20%,transparent)] text-[var(--nimi-status-success)]'
              }`}>
                {initials(recipient.name)}
              </div>
            )
          )}
        </div>
        <h3 className="mt-3 text-lg font-semibold text-[var(--nimi-text-primary)]">{recipient.name}</h3>
        <p className="text-sm text-[var(--nimi-text-muted)]">{recipient.handle || ''}</p>
      </div>

      <div className="rounded-[var(--nimi-radius-lg)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{selectGiftLabel}</p>
            <p className="text-xs text-[var(--nimi-text-muted)]">{sparkCostLabel}</p>
          </div>
          <StatusBadge tone="success" className="gap-1">
            <SparkIcon className="h-3.5 w-3.5" />
            <span>{sparkUnitLabel}</span>
          </StatusBadge>
        </div>

        {state.catalogLoading ? (
          <div
            role="status"
            aria-live="polite"
            className="flex items-center justify-center gap-3 rounded-[var(--nimi-radius-lg)] border border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-8 text-sm text-[var(--nimi-text-muted)]"
          >
            <LoadingSpinner className="h-4 w-4 text-[var(--nimi-status-success)]" />
            <span>{loadingCatalogLabel}</span>
          </div>
        ) : null}

        {state.catalogError ? (
          <InlineAlert
            tone="danger"
            className="rounded-[var(--nimi-radius-lg)] p-4"
            action={(
              <Button
                type="button"
                tone="secondary"
                size="sm"
                onClick={() => {
                  state.clearError();
                  void state.refreshCatalog();
                }}
                className="rounded-full"
              >
                {retryLoadCatalogLabel}
              </Button>
            )}
          >
            {state.catalogError || loadCatalogFailedLabel}
          </InlineAlert>
        ) : null}

        {state.isCatalogEmpty ? (
          <div className="rounded-[var(--nimi-radius-lg)] border border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-8 text-center">
            <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">{emptyCatalogLabel}</p>
            <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
              {emptyCatalogDescription}
            </p>
          </div>
        ) : null}

        {!state.catalogLoading && !state.catalogError && !state.isCatalogEmpty ? (
          <div className="grid grid-cols-3 gap-3">
            {state.giftOptions.map((gift) => (
              <button
                key={gift.id}
                type="button"
                aria-pressed={gift.id === state.selectedGiftId}
                disabled={state.sending}
                onClick={() => {
                  state.setSelectedGiftId(gift.id);
                  state.clearError();
                }}
                className={`rounded-[var(--nimi-radius-lg)] border-2 bg-[var(--nimi-surface-panel)] px-3 py-4 text-left transition ${FOCUS_RING_CLASS_NAME} ${
                  gift.id === state.selectedGiftId
                    ? 'border-[var(--nimi-action-primary-bg)] ring-4 ring-[color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)]'
                    : 'border-transparent hover:border-[var(--nimi-border-subtle)]'
                }`}
              >
                <div className="flex justify-center">
                  {gift.iconUrl ? (
                    <img src={gift.iconUrl} alt={gift.name} className="h-10 w-10 rounded-[var(--nimi-radius-md)] object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-[var(--nimi-radius-md)] bg-[color-mix(in_srgb,var(--nimi-status-success)_15%,transparent)] text-2xl">
                      {gift.emoji}
                    </div>
                  )}
                </div>
                <p className="mt-3 text-center text-xs font-semibold leading-tight text-[var(--nimi-text-primary)]">{gift.name}</p>
                <p className="mt-1 text-center text-xs font-medium text-[var(--nimi-action-primary-bg)]">
                  {formatSparkCost(gift.sparkCost)} {sparkUnitLabel}
                </p>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-6">
        <span className="mb-2 block nimi-type-overline uppercase text-[var(--nimi-text-muted)]">
          {messageLabel}
        </span>
        <TextareaField
          value={state.message}
          onChange={(event) => state.setMessage(event.target.value)}
          rows={3}
          maxLength={200}
          disabled={state.sending}
          aria-label={messageLabel}
          placeholder={messagePlaceholder}
          className="rounded-[var(--nimi-radius-lg)]"
          textareaClassName="resize-none px-4 py-3 text-sm"
        />
        <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--nimi-text-muted)]">
          <LockIcon className="h-3.5 w-3.5" />
          <span>{recipientOnlyLabel}</span>
        </div>
      </div>

      {state.error ? (
        <InlineAlert tone="danger" className="mt-4">
          {state.error}
        </InlineAlert>
      ) : null}
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
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}
