import { useState } from 'react';
import { ReportReasonValues, type RealmModel, type ReportReason } from '@nimiplatform/sdk/realm/generated';
import { useTranslation } from 'react-i18next';
import { ScrollArea } from '@nimiplatform/kit/ui';

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
    if (!selectedReason) {
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-[var(--nimi-scrim-modal)]" onClick={onClose} />
      <ScrollArea
        className="relative mx-4 max-h-[80vh] w-full max-w-md rounded-2xl bg-white shadow-2xl"
        viewportClassName="max-h-[80vh]"
        contentClassName="p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">
            {t('Home.reportPost', { defaultValue: 'Report Post' })}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <p className="mb-4 text-sm text-gray-500">
          {t('Home.reportPrompt', {
            defaultValue: 'Why are you reporting this post by {{name}}?',
            name: post.author?.displayName || post.author?.handle || '',
          })}
        </p>

        <div className="mb-4 space-y-2">
          {reportReasons.map((reason) => (
            <button
              key={reason.value}
              type="button"
              onClick={() => setSelectedReason(reason.value)}
              className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm transition-colors ${
                selectedReason === reason.value
                  ? 'border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-action-primary-bg)]/10 text-[var(--nimi-action-primary-bg)]'
                  : 'border-transparent bg-gray-50 text-gray-700 hover:bg-gray-100'
              }`}
            >
              {reason.label}
            </button>
          ))}
        </div>

        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-gray-700">
            {t('Home.additionalDetailsOptional', { defaultValue: 'Additional details (optional)' })}
          </label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('Home.reportDetailsPlaceholder', {
              defaultValue: 'Please provide more details about your report...',
            })}
            rows={3}
            className="w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-[var(--nimi-field-focus)] focus:outline-none focus:ring-1 focus:ring-[var(--nimi-focus-ring-color)]"
          />
        </div>

        {submitError ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {submitError}
          </div>
        ) : null}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-200"
          >
            {t('Common.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!selectedReason || isSubmitting}
            className="flex-1 rounded-xl bg-[var(--nimi-action-primary-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--nimi-action-primary-text)] transition-colors hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting
              ? t('Home.submitting', { defaultValue: 'Submitting...' })
              : t('Home.submitReport', { defaultValue: 'Submit Report' })}
          </button>
        </div>
      </ScrollArea>
    </div>
  );
}
