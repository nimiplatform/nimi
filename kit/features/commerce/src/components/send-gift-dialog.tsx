import type { ReactNode } from 'react';
import {
  Button,
  IconButton,
  OverlayShell,
  StatusBadge,
  TextareaField,
} from '@nimiplatform/nimi-kit/ui';
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
  title = 'Send Gift',
  closeLabel = 'Close',
  selectGiftLabel = 'Select Gift',
  sparkCostLabel = 'Spark Cost',
  sparkUnitLabel = 'SPARK',
  loadingCatalogLabel = 'Loading gifts...',
  loadCatalogFailedLabel = 'Failed to load gifts.',
  retryLoadCatalogLabel = 'Retry',
  emptyCatalogLabel = 'No gifts available',
  emptyCatalogDescription = 'Gift catalog is currently unavailable.',
  messageLabel = 'Message (Optional)',
  messagePlaceholder = 'Add a nice message...',
  recipientOnlyLabel = 'Only recipient can see',
  sendGiftLabel = 'Send Gift',
  sendingLabel = 'Sending...',
}: SendGiftDialogProps) {
  if (!open) {
    return null;
  }

  const sparkCostLabelText = state.selectedGift ? formatSparkCost(state.selectedGift.sparkCost) : '--';

  return (
    <OverlayShell
      open={open}
      kind="dialog"
      onClose={onClose}
      dataTestId={dataTestId}
      panelClassName={`max-w-sm rounded-3xl ${panelClassName || ''}`.trim()}
      contentClassName={`px-6 pb-6 pt-0 ${contentClassName || ''}`.trim()}
      title={(
        <div className="flex items-center justify-between px-1">
          <h2 className="text-lg font-semibold text-[var(--nimi-text-primary)]">{title}</h2>
          <IconButton
            icon={<CloseIcon className="h-5 w-5" />}
            onClick={onClose}
            aria-label={closeLabel}
            className="h-8 w-8 text-[var(--nimi-text-muted)] transition hover:bg-[var(--nimi-action-ghost-hover)] hover:text-[var(--nimi-text-secondary)]"
          />
        </div>
      )}
    >
      <div className="flex flex-col items-center pb-6">
        <div className="relative">
          {renderRecipientAvatar || (
            recipient.avatarUrl ? (
              <img src={recipient.avatarUrl} alt={recipient.name} className="h-20 w-20 rounded-full object-cover" />
            ) : (
              <div className={`flex h-20 w-20 items-center justify-center rounded-full text-2xl font-bold ${
                recipient.isAgent
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

      <div className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-5">
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
          <div className="flex items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-8 text-sm text-[var(--nimi-text-muted)]">
            <LoadingSpinner className="h-4 w-4 text-[var(--nimi-status-success)]" />
            <span>{loadingCatalogLabel}</span>
          </div>
        ) : null}

        {state.catalogError ? (
          <div className="rounded-2xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] p-4">
            <p className="text-sm font-medium text-[var(--nimi-status-danger)]">
              {state.catalogError || loadCatalogFailedLabel}
            </p>
            <Button
              type="button"
              tone="secondary"
              size="sm"
              onClick={() => {
                state.clearError();
                void state.refreshCatalog();
              }}
              className="mt-3 rounded-full"
            >
              {retryLoadCatalogLabel}
            </Button>
          </div>
        ) : null}

        {state.isCatalogEmpty ? (
          <div className="rounded-2xl border border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4 py-8 text-center">
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
                onClick={() => {
                  state.setSelectedGiftId(gift.id);
                  state.clearError();
                }}
                className={`rounded-2xl border-2 bg-[var(--nimi-surface-panel)] px-3 py-4 text-left transition ${
                  gift.id === state.selectedGiftId
                    ? 'border-[var(--nimi-action-primary-bg)] shadow-[0_0_0_4px_color-mix(in_srgb,var(--nimi-action-primary-bg)_12%,transparent)]'
                    : 'border-transparent hover:border-[var(--nimi-border-subtle)]'
                }`}
              >
                <div className="flex justify-center">
                  {gift.iconUrl ? (
                    <img src={gift.iconUrl} alt={gift.name} className="h-10 w-10 rounded-xl object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-status-success)_15%,transparent)] text-2xl">
                      {gift.emoji}
                    </div>
                  )}
                </div>
                <p className="mt-3 truncate text-center text-sm font-semibold text-[var(--nimi-text-primary)]">{gift.name}</p>
                <p className="mt-1 text-center text-xs font-medium text-[var(--nimi-action-primary-bg)]">
                  {formatSparkCost(gift.sparkCost)} {sparkUnitLabel}
                </p>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-6">
        <label className="mb-2 block text-xs font-semibold uppercase tracking-wider text-[var(--nimi-text-muted)]">
          {messageLabel}
        </label>
        <TextareaField
          value={state.message}
          onChange={(event) => state.setMessage(event.target.value.slice(0, 200))}
          rows={3}
          placeholder={messagePlaceholder}
          className="rounded-2xl"
          textareaClassName="resize-none px-4 py-3 text-sm"
        />
        <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--nimi-text-muted)]">
          <LockIcon className="h-3.5 w-3.5" />
          <span>{recipientOnlyLabel}</span>
        </div>
      </div>

      {state.error ? (
        <div className="mt-4 rounded-xl border border-[color-mix(in_srgb,var(--nimi-status-danger)_30%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-danger)_8%,transparent)] px-4 py-3 text-sm text-[var(--nimi-status-danger)]">
          {state.error}
        </div>
      ) : null}

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
        className="mt-6 rounded-2xl py-3.5"
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
