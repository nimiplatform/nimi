import { useState } from 'react';
import { Button, IconButton, OverlayShell } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';

type VisibilityValue = 'PUBLIC' | 'FRIENDS' | 'PRIVATE';

export function EditVisibilityModal(props: {
  currentVisibility: VisibilityValue;
  pending: boolean;
  onClose: () => void;
  onSubmit: (visibility: VisibilityValue) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [selectedVisibility, setSelectedVisibility] = useState<VisibilityValue>(props.currentVisibility);
  const options = [
    {
      value: 'PUBLIC' as const,
      title: t('PrivacySettings.visibilityPublic', { defaultValue: 'Public' }),
      description: t('Home.visibilityPublicDescription', { defaultValue: 'Anyone can see this post.' }),
    },
    {
      value: 'FRIENDS' as const,
      title: t('PrivacySettings.visibilityFriends', { defaultValue: 'Friends' }),
      description: t('Home.visibilityFriendsDescription', { defaultValue: 'Only your friends can see this post.' }),
    },
    {
      value: 'PRIVATE' as const,
      title: t('PrivacySettings.visibilityPrivate', { defaultValue: 'Private' }),
      description: t('Home.visibilityPrivateDescription', { defaultValue: 'Only you can see this post.' }),
    },
  ];

  return (
    <OverlayShell
      open
      kind="dialog"
      onClose={props.pending ? undefined : props.onClose}
      title={(
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-[var(--nimi-text-primary)]">
            {t('Home.editPostVisibility', { defaultValue: 'Edit Post Visibility' })}
          </h2>
          <IconButton
            icon={(
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
            size="sm"
            disabled={props.pending}
            onClick={props.onClose}
            aria-label={t('Home.close', { defaultValue: 'Close' })}
          />
        </div>
      )}
      footer={(
        <div className="flex items-center gap-3">
          <Button tone="secondary" fullWidth onClick={props.onClose} disabled={props.pending}>
            {t('Common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            tone="primary"
            fullWidth
            onClick={() => {
              void props.onSubmit(selectedVisibility);
            }}
            disabled={props.pending || selectedVisibility === props.currentVisibility}
          >
            {props.pending
              ? t('runtimeConfig.cloud.saving', { defaultValue: 'Saving...' })
              : t('Home.save', { defaultValue: 'Save' })}
          </Button>
        </div>
      )}
    >
      <fieldset disabled={props.pending} className="space-y-2 py-2">
        <legend className="sr-only">
          {t('Home.editPostVisibility', { defaultValue: 'Edit Post Visibility' })}
        </legend>
        {options.map((option) => {
          const checked = selectedVisibility === option.value;
          return (
            <label
              key={option.value}
              className={`block w-full cursor-pointer rounded-xl border px-4 py-3 text-left transition-colors focus-within:ring-2 focus-within:ring-[var(--nimi-focus-ring-color)] ${
                checked
                  ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_10%,var(--nimi-surface-card))]'
                  : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] hover:border-[var(--nimi-action-primary-bg)]'
              }`}
            >
              <input
                type="radio"
                name="post-visibility"
                value={option.value}
                checked={checked}
                onChange={() => setSelectedVisibility(option.value)}
                className="sr-only"
              />
              <span className="block text-sm font-semibold text-[var(--nimi-text-primary)]">{option.title}</span>
              <span className="block text-xs text-[var(--nimi-text-muted)]">{option.description}</span>
            </label>
          );
        })}
      </fieldset>
    </OverlayShell>
  );
}
