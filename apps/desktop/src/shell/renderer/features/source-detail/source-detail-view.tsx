import { useTranslation } from 'react-i18next';
import type { SourceDetailData } from './source-detail-model.js';
import { SourceDetailSkeleton } from './source-detail-skeleton.js';
import { CharacterSourceDetailPage } from './source-detail-world-character-view.js';

type SourceDetailViewProps = {
  source: SourceDetailData;
  stats?: { friendsCount: number; postsCount: number; likesCount: number } | null;
  loading: boolean;
  error: boolean;
  primaryActionJoining?: boolean;
  onBack?: () => void;
  onOpenWorld: () => void;
  onPrimaryAction: () => void;
  onStartChat?: (initialComposerText?: string) => void;
};

export function SourceDetailView(props: SourceDetailViewProps) {
  const { t } = useTranslation();

  if (props.loading) {
    return <SourceDetailSkeleton />;
  }

  if (props.error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-[var(--nimi-status-danger)]">{t('SourceDetail.error')}</p>
        {props.onBack ? (
          <button
            type="button"
            onClick={props.onBack}
            className="rounded-[10px] bg-[var(--nimi-surface-panel)] px-4 py-2 text-sm font-medium text-[var(--nimi-text-secondary)] hover:bg-[var(--nimi-surface-active)]"
          >
            {t('Common.back')}
          </button>
        ) : null}
      </div>
    );
  }

  return <CharacterSourceDetailPage {...props} source={props.source} />;
}
