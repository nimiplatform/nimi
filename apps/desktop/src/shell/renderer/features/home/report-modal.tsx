import { useState } from 'react';
import type { PostDto } from '@nimiplatform/sdk/realm';
import { ReportReason } from '@nimiplatform/sdk/realm';

const REPORT_REASONS = [
  { value: ReportReason.SPAM, label: 'Spam' },
  { value: ReportReason.NSFW, label: 'NSFW content' },
  { value: ReportReason.HATE_SPEECH, label: 'Hate speech' },
  { value: ReportReason.SCAM, label: 'Scam or fraud' },
  { value: ReportReason.OTHER, label: 'Other' },
] as const;

export function ReportModal({
  post,
  onClose,
  onSubmit,
}: {
  post: PostDto;
  onClose: () => void;
  onSubmit: (payload: { reason: keyof typeof ReportReason; description?: string }) => Promise<void>;
}) {
  const [selectedReason, setSelectedReason] = useState<keyof typeof ReportReason | ''>('');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!selectedReason) {
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit({
        reason: selectedReason,
        description: description.trim() || undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative mx-4 max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Report Post</h3>
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
          Why are you reporting this post by <span className="font-medium text-gray-700">{post.author?.displayName || post.author?.handle}</span>?
        </p>

        <div className="mb-4 space-y-2">
          {REPORT_REASONS.map((reason) => (
            <button
              key={reason.value}
              type="button"
              onClick={() => setSelectedReason(reason.value)}
              className={`w-full rounded-xl border-2 px-4 py-3 text-left text-sm transition-colors ${
                selectedReason === reason.value
                  ? 'border-[#4ECCA3] bg-[#4ECCA3]/10 text-[#4ECCA3]'
                  : 'border-transparent bg-gray-50 text-gray-700 hover:bg-gray-100'
              }`}
            >
              {reason.label}
            </button>
          ))}
        </div>

        <div className="mb-6">
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Additional details (optional)
          </label>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Please provide more details about your report..."
            rows={3}
            className="w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm focus:border-[#4ECCA3] focus:outline-none focus:ring-1 focus:ring-[#4ECCA3]"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSubmit();
            }}
            disabled={!selectedReason || isSubmitting}
            className="flex-1 rounded-xl bg-[#4ECCA3] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3dbb92] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Report'}
          </button>
        </div>
      </div>
    </div>
  );
}
