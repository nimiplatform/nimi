import { useDesktopI18nResource } from '../../i18n/i18n-context';

type CollectionsTabProps = {
  profileId: string;
  layout?: 'grid' | 'masonry';
};

export function CollectionsTab(_props: CollectionsTabProps) {
  const i18n = useDesktopI18nResource().instance;

  return (
    <div className="flex flex-col items-center justify-center py-16 text-sm text-[var(--nimi-text-muted)]">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mb-3 text-[var(--nimi-text-muted)]">
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2h7A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
      </svg>
      {i18n.t('Profile.Collections.empty', { defaultValue: 'No collections yet' })}
    </div>
  );
}
