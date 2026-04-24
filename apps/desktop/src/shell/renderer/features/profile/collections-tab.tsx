import { i18n } from '@renderer/i18n';
import { DesktopCardSurface } from '@renderer/components/surface';

type CollectionsTabProps = {
  profileId: string;
  layout?: 'grid' | 'masonry';
};

export function CollectionsTab({ layout = 'grid' }: CollectionsTabProps) {
  const layoutClass = layout === 'masonry' ? 'columns-1 sm:columns-2' : 'grid grid-cols-1 sm:grid-cols-2';

  return (
    <div className={`${layoutClass} items-start gap-6`}>
      <DesktopCardSurface kind="promoted-glass" as="div" className="rounded-[24px] p-8 text-center text-sm text-slate-500">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4l2 2h7A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
          </svg>
        </div>
        <p>{i18n.t('Profile.Collections.empty', { defaultValue: 'No collections yet' })}</p>
      </DesktopCardSurface>
    </div>
  );
}
