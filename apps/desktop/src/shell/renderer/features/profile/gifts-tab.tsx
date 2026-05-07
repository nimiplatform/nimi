import { useState } from 'react';
import { OverlayShell, ScrollArea } from '@nimiplatform/nimi-kit/ui';
import { DesktopCompactAction } from '@renderer/components/action';
import { DesktopCardSurface } from '@renderer/components/surface';
import { i18n } from '@renderer/i18n';
import { E2E_IDS } from '@renderer/testability/e2e-ids';

const DATA_REQUIREMENTS = [
  'Profile.Gifts.requirementGiftFeed',
  'Profile.Gifts.requirementSupporters',
  'Profile.Gifts.requirementBalance',
] as const;

function GiftDataGlyph() {
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F0FAF7] text-[#28A77A]">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M20 12v8H4v-8"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M2.5 7.5h19v4.5h-19z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M12 20V7.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M12 7.5H8.25A2.25 2.25 0 1 1 10.5 5.25V7.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M12 7.5h3.75A2.25 2.25 0 1 0 13.5 5.25V7.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function TopSupportersModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <OverlayShell
      open={isOpen}
      kind="dialog"
      onClose={onClose}
      dataTestId={E2E_IDS.profileTopSupportersDialog}
      panelClassName="max-w-md overflow-hidden rounded-[28px] animate-in fade-in zoom-in duration-200"
      contentClassName="p-0"
      title={(
        <div className="px-1">
          <h2 className="text-lg font-bold text-gray-900">
            {i18n.t('Profile.Gifts.topSupporters', { defaultValue: 'Top Supporters' })}
          </h2>
          <p className="mt-0.5 text-xs text-gray-400">
            {i18n.t('Profile.Gifts.unavailableTitle', { defaultValue: 'Gift data unavailable' })}
          </p>
        </div>
      )}
    >
      <ScrollArea className="max-h-[360px]" viewportClassName="max-h-[360px]">
        <div className="space-y-4 px-6 py-5">
          <p className="text-sm leading-relaxed text-gray-600">
            {i18n.t('Profile.Gifts.unavailableDescription', {
              defaultValue: 'This profile has no admitted gift activity data source available.',
            })}
          </p>
          <div className="space-y-3">
            {DATA_REQUIREMENTS.map((key) => (
              <div key={key} className="rounded-xl border border-[#D8EFE6] bg-[#F8FCFA] px-4 py-3 text-sm text-gray-700">
                {i18n.t(key)}
              </div>
            ))}
          </div>
        </div>
      </ScrollArea>
      <div className="flex justify-end border-t border-gray-100 bg-gray-50 px-6 py-4">
        <DesktopCompactAction onClick={onClose} tone="primary">
          {i18n.t('Common.close', { defaultValue: 'Close' })}
        </DesktopCompactAction>
      </div>
    </OverlayShell>
  );
}

export function GiftsTab() {
  const [showSupportersModal, setShowSupportersModal] = useState(false);

  return (
    <div className="space-y-6">
      <DesktopCardSurface kind="promoted-glass" as="div" className="p-6">
        <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <GiftDataGlyph />
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900">
                {i18n.t('Profile.Gifts.unavailableTitle', { defaultValue: 'Gift data unavailable' })}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-600">
                {i18n.t('Profile.Gifts.unavailableDescription', {
                  defaultValue: 'This profile has no admitted gift activity data source available.',
                })}
              </p>
            </div>
          </div>
          <DesktopCompactAction
            onClick={() => setShowSupportersModal(true)}
            tone="primary"
          >
            {i18n.t('Profile.Gifts.viewDataStatus', { defaultValue: 'View data status' })}
          </DesktopCompactAction>
        </div>
      </DesktopCardSurface>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {DATA_REQUIREMENTS.map((key) => (
          <DesktopCardSurface key={key} kind="promoted-glass" as="div" className="p-5">
            <p className="text-sm leading-relaxed text-gray-700">{i18n.t(key)}</p>
          </DesktopCardSurface>
        ))}
      </div>

      <TopSupportersModal
        isOpen={showSupportersModal}
        onClose={() => setShowSupportersModal(false)}
      />
    </div>
  );
}
