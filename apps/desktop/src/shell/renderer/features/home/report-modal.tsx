import { useState } from 'react';
import { ReportReasonValues, type RealmModel, type ReportReason } from '@nimiplatform/sdk/realm/generated';
import { useTranslation } from 'react-i18next';
import { Button, IconButton, OverlayShell, ScrollArea } from '@nimiplatform/kit/ui';
import { InlineFeedback } from '../../ui/feedback/inline-feedback';

type PostDto = RealmModel<'PostDto'>;

export function ReportModal({
  post,
  onClose,
  onSubmit,
}: {
  post: PostDto;
  onClose: () => void;
  onSubmit: (payload: { reason: ReportReason; description?: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [selectedReason, setSelectedReason] = useState<ReportReason | ''>('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const reasonLabels = {
    SPAM: t('Home.reportReasons.spam', { defaultValue: 'Spam' }),
    NSFW: t('Home.reportReasons.nsfw', { defaultValue: 'NSFW content' }),
    HATE_SPEECH: t('Home.reportReasons.hateSpeech', { defaultValue: 'Hate speech' }),
    SCAM: t('Home.reportReasons.scam', { defaultValue: 'Scam or fraud' }),
    OTHER: t('Home.reportReasons.other', { defaultValue: 'Other' }),
  } satisfies Record<ReportReason, string>;
  const reportReasons = ReportReasonValues.map((value) => ({
    value,
    label: reasonLabels[value],
  }));

  const handleSubmit = async () => {
    if (!selectedReason || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onSubmit({
        reason: selectedReason,
        description: description.trim() || undefined,
      });
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : t('Home.reportSubmitFailed', { defaultValue: 'Failed to submit report' }),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={isSubmitting ? undefined : onClose}
      panelClassName="flex max-h-[80vh] flex-col overflow-hidden"
      contentClassName="flex min-h-0 flex-1 flex-col px-0 py-0"
      title={(
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-[var(--nimi-text-primary)]">
            {t('Home.reportPost', { defaultValue: 'Report Post' })}
          </h2>
          <IconButton
            icon={(
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            size="sm"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label={t('Home.close', { defaultValue: 'Close' })}
          />
        </div>
      )}
      footer={(
        <div className="flex items-center gap-3">
          <Button tone="secondary" fullWidth onClick={onClose} disabled={isSubmitting}>
            {t('Common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            tone="primary"
            fullWidth
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!selectedReason || isSubmitting}
          >
            {isSubmitting
              ? t('Home.submitting', { defaultValue: 'Submitting...' })
              : t('Home.submitReport', { defaultValue: 'Submit Report' })}
          </Button>
        </div>
      )}
    >
      <ScrollArea className="min-h-0 flex-1" viewportClassName="px-0" contentClassName="px-6 py-2">
        <p className="mb-4 text-sm text-[var(--nimi-text-muted)]">
          {t('Home.reportPrompt', {
            defaultValue: 'Why are you reporting this post by {{name}}?',
            name: post.author?.displayName || post.author?.handle || '',
          })}
        </p>

        <fieldset disabled={isSubmitting} className="mb-4 space-y-2">
          <legend className="sr-only">
            {t('Home.reportReasonLabel', { defaultValue: 'Report reason' })}
          </legend>
          {reportReasons.map((reason) => {
            const checked = selectedReason === reason.value;
            return (
              <label
                key={reason.value}
                className={`block w-full cursor-pointer rounded-xl border-2 px-4 py-3 text-left text-sm transition-colors focus-within:ring-2 focus-within:ring-[var(--nimi-focus-ring-color)] ${
                  checked
                    ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))] text-[var(--nimi-action-primary-bg)]'
                    : 'border-transparent bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-active)]'
                }`}
              >
                <input
                  type="radio"
                  name="report-reason"
                  value={reason.value}
                  checked={checked}
                  onChange={() => setSelectedReason(reason.value)}
                  className="sr-only"
                />
                {reason.label}
              </label>
            );
          })}
        </fieldset>

        <div className="mb-6">
          <label htmlFor="report-additional-details" className="mb-2 block text-sm font-medium text-[var(--nimi-text-secondary)]">
            {t('Home.additionalDetailsOptional', { defaultValue: 'Additional details (optional)' })}
          </label>
          <textarea
            id="report-additional-details"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('Home.reportDetailsPlaceholder', {
              defaultValue: 'Please provide more details about your report...',
            })}
            rows={3}
            disabled={isSubmitting}
            className="w-full resize-none rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-3 text-sm text-[var(--nimi-text-primary)] placeholder:text-[var(--nimi-text-muted)] focus:border-[var(--nimi-field-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nimi-focus-ring-color)]"
          />
        </div>

        {submitError ? (
          <InlineFeedback className="mb-4" feedback={{ kind: 'error', message: submitError }} />
        ) : null}
      </ScrollArea>
    </OverlayShell>
  );
}
