import { Button, Surface } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import { InlineFeedback, type InlineFeedbackState } from '../../ui/feedback/inline-feedback';
import { FILTER_TABS, type NotificationFilterTab } from './notification-panel-types.js';

type NotificationPanelHeaderProps = {
  activeFilter: NotificationFilterTab;
  feedback: InlineFeedbackState | null;
  markingAllRead: boolean;
  unreadCount: number;
  onDismissFeedback: () => void;
  onFilterChange: (filter: NotificationFilterTab) => void;
  onMarkAllRead: () => void;
};

export function NotificationPanelHeader({
  activeFilter,
  feedback,
  markingAllRead,
  unreadCount,
  onDismissFeedback,
  onFilterChange,
  onMarkAllRead,
}: NotificationPanelHeaderProps) {
  const { t } = useTranslation();
  return (
    <Surface
      tone="panel"
      material="glass-regular"
      padding="none"
      className="rounded-[1.75rem] border-white/60 px-5 py-4 shadow-[0_18px_44px_rgba(15,23,42,0.06)]"
    >
      <div className="flex h-14 shrink-0 items-center justify-between">
        <h1 className="nimi-type-page-title text-[color:var(--nimi-text-primary)]">
          {t('NotificationPanel.title', { defaultValue: 'Notifications' })}
        </h1>
        <Button
          tone="ghost"
          size="sm"
          disabled={markingAllRead || unreadCount <= 0}
          onClick={onMarkAllRead}
        >
          {markingAllRead
            ? t('NotificationPanel.markingAllRead', { defaultValue: 'Marking...' })
            : t('NotificationPanel.markAllRead', { defaultValue: 'Mark All Read' })}
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 pb-1">
        {FILTER_TABS.map((tab) => (
          <Button
            key={tab}
            onClick={() => onFilterChange(tab)}
            tone={activeFilter === tab ? 'primary' : 'secondary'}
            size="sm"
          >
            {t(`NotificationPanel.filters.${tab}`, {
              defaultValue: tab,
            })}
          </Button>
        ))}
      </div>
      {feedback ? (
        <div className="pt-4">
          <InlineFeedback feedback={feedback} onDismiss={onDismissFeedback} />
        </div>
      ) : null}
    </Surface>
  );
}
