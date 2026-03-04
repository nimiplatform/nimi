import { useState } from 'react';

type VisibilityValue = 'PUBLIC' | 'FRIENDS' | 'PRIVATE';

const OPTIONS: Array<{
  value: VisibilityValue;
  title: string;
  description: string;
}> = [
  {
    value: 'PUBLIC',
    title: 'Public',
    description: 'Anyone can see this post.',
  },
  {
    value: 'FRIENDS',
    title: 'Friends',
    description: 'Only your friends can see this post.',
  },
  {
    value: 'PRIVATE',
    title: 'Private',
    description: 'Only you can see this post.',
  },
];

export function EditVisibilityModal(props: {
  currentVisibility: VisibilityValue;
  pending: boolean;
  onClose: () => void;
  onSubmit: (visibility: VisibilityValue) => Promise<void>;
}) {
  const [selectedVisibility, setSelectedVisibility] = useState<VisibilityValue>(props.currentVisibility);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={props.onClose} />
      <div className="relative mx-4 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Edit Post Visibility</h3>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-full p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="mb-6 space-y-2">
          {OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setSelectedVisibility(option.value)}
              className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                selectedVisibility === option.value
                  ? 'border-mint-500 bg-mint-50'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <p className="text-sm font-semibold text-gray-900">{option.title}</p>
              <p className="text-xs text-gray-500">{option.description}</p>
            </button>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={props.onClose}
            disabled={props.pending}
            className="flex-1 rounded-xl bg-gray-100 px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-200 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void props.onSubmit(selectedVisibility);
            }}
            disabled={props.pending || selectedVisibility === props.currentVisibility}
            className="flex-1 rounded-xl bg-[#4ECCA3] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3dbb92] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {props.pending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
